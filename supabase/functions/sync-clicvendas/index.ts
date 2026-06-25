// Supabase Edge Function: sync-clicvendas
// Migrado para a nova API CLic (clictecnologia.com.br):
//   - Auth: POST /auth/login em admfw.clictecnologia.com.br → JWT Bearer
//   - Dados: GET /api/extprodutos em grupoello.clictecnologia.com.br (paginado)
// Atualiza preco_clic, imagem_url, marca e estoque no Supabase.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// ─── Configuração da nova API CLic ───────────────────────────────────────────
// Auth fica em admfw; os dados no subdomínio do cliente.
const AUTH_URL    = () => Deno.env.get("CLIC_AUTH_URL")   || "https://admfw.clictecnologia.com.br";
const BASE_URL    = () => Deno.env.get("CLIC_BASE_URL")   || "https://grupoello.clictecnologia.com.br";
const SUBDOMINIO  = () => Deno.env.get("CLIC_SUBDOMINIO") || "grupoello";
const DEPOSITO    = () => Deno.env.get("CLIC_DEPOSITO")   || "001";

// ─── Login → obtém accessToken (JWT) ─────────────────────────────────────────
async function clicLogin(user: string, pass: string): Promise<string> {
  const res = await fetch(`${AUTH_URL()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ login: user, senha: pass, subdominio: SUBDOMINIO() }),
  });
  if (!res.ok) {
    let detalhe = "";
    try { detalhe = JSON.stringify(await res.json()); } catch { /* ignora */ }
    throw new Error(`Falha no login CLic (HTTP ${res.status}). ${detalhe}`);
  }
  const data = await res.json() as any;
  if (!data?.accessToken) throw new Error("Login CLic não retornou accessToken.");
  return data.accessToken as string;
}

// ─── Busca todos os produtos via /api/extprodutos (paginado) ─────────────────
// Retorna também a estrutura bruta da primeira página para diagnóstico.
async function fetchTodosProdutos(
  token: string,
): Promise<{ produtos: any[]; primeiraResposta: any }> {
  const PAGE = 100;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const all: any[] = [];
  let primeiraResposta: any = null;

  for (let skip = 0; skip < 100_000; skip += PAGE) {
    const url = `${BASE_URL()}/api/extprodutos?fetch=${PAGE}&skip=${skip}&sortBy=codigo&sortDescAsc=ASC`;
    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) throw new Error(`Falha ao buscar produtos CLic (HTTP ${res.status}).`);
    const data = await res.json() as any;

    if (skip === 0) primeiraResposta = data;

    // Tenta as chaves mais comuns de resposta paginada.
    let dados: any[] = [];
    if (Array.isArray(data))          dados = data;
    else if (Array.isArray(data?.dados))    dados = data.dados;
    else if (Array.isArray(data?.produtos)) dados = data.produtos;
    else if (Array.isArray(data?.items))    dados = data.items;
    else if (Array.isArray(data?.data))     dados = data.data;
    else if (Array.isArray(data?.result))   dados = data.result;

    all.push(...dados);
    if (dados.length < PAGE) break; // última página
  }
  return { produtos: all, primeiraResposta };
}

// ─── Extrai preço do produto ──────────────────────────────────────────────────
function precoDoProduto(p: any): number | null {
  for (const tabela of p?.precos ?? []) {
    for (const faixa of tabela?.precos ?? []) {
      const preco = Number(faixa?.preco);
      if (isFinite(preco) && preco > 0) return preco;
    }
  }
  return null;
}

// ─── Extrai saldo do depósito configurado ────────────────────────────────────
function estoqueDoProduto(p: any): number | null {
  const arr = Array.isArray(p?.estoques) ? p.estoques : null;
  if (!arr) return null;
  const dep = arr.find((e: any) => String(e?.codigoDeposito ?? "").trim() === DEPOSITO());
  if (!dep) return 0;
  const q = Number(dep.quantidade);
  return isFinite(q) ? q : 0;
}

// ─── Variações de código do produto para matching ────────────────────────────
function codigosDoProduto(p: any): string[] {
  const out = new Set<string>();
  const add = (v: any) => {
    const s = String(v ?? "").trim();
    if (s) out.add(s);
  };
  add(p?.backoffice?.codigo);                                  // "11166"
  add(p?.codigo);                                             // "10_11166"
  if (p?.codigo) add(String(p.codigo).replace(/^\d+_/, "")); // remove prefixo "10_"
  return [...out];
}

// ─── Extrai URL da imagem (melhor candidato disponível) ──────────────────────
function imagemDoProduto(p: any): string | null {
  // A API pode fornecer a imagem em diferentes campos dependendo da versão.
  const imgId =
    String(p?.imgProduto || p?.imagem || p?.imagemId || "").trim();
  if (!imgId) return null;
  // Monta URL no mesmo padrão da API anterior.
  return `${BASE_URL()}/clicvenda/produtos/${SUBDOMINIO()}/${imgId}.jpg`;
}

// ─── Extrai marca ─────────────────────────────────────────────────────────────
function marcaDoProduto(p: any): string {
  const candidates = [p?.marca, p?.nomeMarca, p?.descricaoMarca, p?.marca?.nome];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Valida usuário autenticado e papel admin.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "Não autenticado" }, 401);

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonResponse(
        { error: "Sessão inválida", detail: userErr?.message || "usuário não encontrado" },
        401,
      );
    }

    const { data: perfil } = await supabase
      .from("perfis")
      .select("role")
      .eq("email", userData.user.email)
      .single();
    if (perfil?.role !== "admin") {
      return jsonResponse({ error: "Apenas administradores" }, 403);
    }

    // Credenciais da nova API CLic.
    // Suporta tanto os nomes antigos (CLICVENDAS_*) quanto os novos (CLIC_*).
    const clicUser =
      Deno.env.get("CLIC_USER") || Deno.env.get("CLICVENDAS_USER");
    const clicPass =
      Deno.env.get("CLIC_PASS") || Deno.env.get("CLICVENDAS_PASS");

    if (!clicUser || !clicPass) {
      return jsonResponse(
        { error: "Credenciais do CLic não configuradas (CLIC_USER / CLIC_PASS)" },
        500,
      );
    }

    // Parâmetros opcionais do body.
    let produtoIdAlvo: string | null = null;
    let mode: string | null = null;
    try {
      const body = await req.json();
      if (body?.produto_id) produtoIdAlvo = String(body.produto_id);
      if (body?.mode)       mode           = String(body.mode);
    } catch {
      // body vazio ou não-JSON — sync completo.
    }

    // 1) Login → JWT  2) Baixa todos os produtos da nova API.
    const clicToken  = await clicLogin(clicUser, clicPass);
    const { produtos: produtosClic, primeiraResposta } = await fetchTodosProdutos(clicToken);

    // Monta mapa código → dados (indexando todas as variações de código).
    const clicMap = new Map<string, {
      preco: number;
      imagem: string | null;
      marca: string;
      estoque: number | null;
      nome: string;
    }>();

    for (const p of produtosClic) {
      const preco   = precoDoProduto(p);
      const estoque = estoqueDoProduto(p);
      const imagem  = imagemDoProduto(p);
      const marca   = marcaDoProduto(p);
      const nome    = String(p?.nome || "");

      for (const cod of codigosDoProduto(p)) {
        if (clicMap.has(cod)) continue;
        clicMap.set(cod, {
          preco:   preco ?? 0,
          imagem,
          marca,
          estoque,
          nome,
        });
      }
    }

    // ── Mode: import_produtos — cria no Supabase produtos que existem no CLic mas ainda não estão cadastrados ──
    if (mode === "import_produtos") {
      const { data: existentes } = await supabase
        .from("produtos")
        .select("codigo_interno")
        .not("codigo_interno", "is", null);

      const codigosExistentes = new Set(
        (existentes || []).map((p: any) => String(p.codigo_interno ?? "").trim()),
      );

      const aInserir: Array<{
        nome: string; codigo_interno: string; marca: string | null;
        preco_unitario: number; imagem_url: string | null; ativo: boolean; unidade: string;
      }> = [];
      let jaExistem = 0;

      for (const p of produtosClic) {
        const codigo = String(p?.backoffice?.codigo ?? "").trim();
        if (!codigo || codigo === "0") continue;
        if (codigosExistentes.has(codigo)) { jaExistem++; continue; }
        const nome = String(p?.nome ?? "").trim();
        if (!nome) continue;
        aInserir.push({
          nome,
          codigo_interno: codigo,
          marca: marcaDoProduto(p) || null,
          preco_unitario: precoDoProduto(p) ?? 0,
          imagem_url: imagemDoProduto(p),
          ativo: true,
          unidade: "UN",
        });
      }

      let importados = 0;
      const errosImport: string[] = [];
      const LOTE = 50;
      for (let i = 0; i < aInserir.length; i += LOTE) {
        const { error } = await supabase.from("produtos").insert(aInserir.slice(i, i + LOTE));
        if (error) errosImport.push(error.message);
        else importados += Math.min(LOTE, aInserir.length - i);
      }

      return jsonResponse({
        mode: "import_produtos",
        total_clic: produtosClic.length,
        ja_existem: jaExistem,
        importados,
        erros: errosImport,
      });
    }

    // Busca produtos do Supabase que têm codigo_interno válido.
    let produtosQuery = supabase
      .from("produtos")
      .select("id, codigo_interno, nome, preco_unitario, preco_clic, imagem_url, ativo")
      .not("codigo_interno", "is", null);

    if (produtoIdAlvo) {
      produtosQuery = produtosQuery.eq("id", produtoIdAlvo);
    } else {
      produtosQuery = produtosQuery.eq("ativo", true);
    }

    const { data: produtos, error: prodErr } = await produtosQuery;
    if (prodErr) throw prodErr;
    if (produtoIdAlvo && (!produtos || produtos.length === 0)) {
      return jsonResponse({ error: "Produto não encontrado ou sem código interno" }, 404);
    }

    // Pega o local padrão para upsert de estoque.
    const { data: localPadraoRow } = await supabase
      .from("locais")
      .select("id")
      .eq("ativo", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const localPadraoId: string | null = localPadraoRow?.id ?? null;

    let updated = 0;
    let notFound = 0;
    let estoquesAtualizados = 0;
    const alertasPreco: Array<{
      id: string; codigo: string; nome: string;
      preco_sistema: number; preco_clic: number; diferenca: number;
    }> = [];
    const erros: Array<{ id: string; nome: string; error: string }> = [];
    const faltantes: Array<{ cod: string; nome: string }> = [];

    for (const prod of produtos || []) {
      const cod = String(prod.codigo_interno ?? "").trim();
      if (!cod || cod === "0") {
        notFound++;
        faltantes.push({ cod: cod || "0", nome: prod.nome });
        continue;
      }

      const clic = clicMap.get(cod);
      if (!clic) {
        notFound++;
        faltantes.push({ cod, nome: prod.nome });
        continue;
      }

      const updatePayload: Record<string, unknown> = {
        preco_clic: clic.preco,
        preco_clic_atualizado_em: new Date().toISOString(),
      };
      // Atualiza imagem apenas se a nova API forneceu uma.
      if (clic.imagem) updatePayload.imagem_url = clic.imagem;
      if (clic.marca)  updatePayload.marca = clic.marca;

      const { error: upErr } = await supabase
        .from("produtos")
        .update(updatePayload)
        .eq("id", prod.id);

      if (upErr) {
        erros.push({ id: prod.id, nome: prod.nome, error: upErr.message });
        continue;
      }

      updated++;

      // Upsert de estoque no local padrão.
      if (localPadraoId && clic.estoque !== null) {
        const { data: estExist } = await supabase
          .from("estoque")
          .select("id")
          .eq("produto_id", prod.id)
          .eq("local_id", localPadraoId)
          .maybeSingle();

        if (estExist?.id) {
          const { error: estErr } = await supabase
            .from("estoque")
            .update({ quantidade: clic.estoque, updated_at: new Date().toISOString() })
            .eq("id", estExist.id);
          if (!estErr) estoquesAtualizados++;
        } else {
          const { error: estErr } = await supabase
            .from("estoque")
            .insert({ produto_id: prod.id, local_id: localPadraoId, quantidade: clic.estoque });
          if (!estErr) estoquesAtualizados++;
        }
      }

      const precoSistema = Number(prod.preco_unitario) || 0;
      if (precoSistema > 0 && precoSistema < clic.preco) {
        alertasPreco.push({
          id: prod.id, codigo: cod, nome: prod.nome,
          preco_sistema: precoSistema, preco_clic: clic.preco,
          diferenca: +(clic.preco - precoSistema).toFixed(2),
        });
      }
    }

    // Amostras para diagnóstico de mismatch.
    const amostraClic = Array.from(clicMap.entries())
      .slice(0, 10)
      .map(([cod, v]) => ({ cod, nome: v.nome, preco: v.preco }));
    const amostraSistema = (produtos || [])
      .filter((p) => p.codigo_interno)
      .slice(0, 10)
      .map((p) => ({ cod: String(p.codigo_interno), nome: p.nome }));

    return jsonResponse({
      total_clic: clicMap.size,
      total_sistema: produtos?.length || 0,
      atualizados: updated,
      estoques_atualizados: estoquesAtualizados,
      nao_encontrados: notFound,
      alertas_preco: alertasPreco,
      erros,
      amostra_codigos_clicvendas: amostraClic,
      amostra_codigos_sistema: amostraSistema,
      faltantes,
      // Inclui estrutura bruta da 1ª página quando não há produtos (diagnóstico).
      ...(clicMap.size === 0 && {
        debug_primeira_resposta: typeof primeiraResposta === "object"
          ? { chaves: Object.keys(primeiraResposta ?? {}), amostra: JSON.stringify(primeiraResposta).slice(0, 500) }
          : { tipo: typeof primeiraResposta, valor: String(primeiraResposta).slice(0, 200) },
      }),
    });
  } catch (err) {
    return jsonResponse(
      { error: (err as Error).message || "Erro desconhecido" },
      500,
    );
  }
});
