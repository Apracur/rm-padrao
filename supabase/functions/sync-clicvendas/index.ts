// Supabase Edge Function: sync-clicvendas
// Busca produtos no portal ClicVendas via API REST e atualiza preco_clic
// e imagem_url dos produtos correspondentes no Supabase (matching por
// codigo_interno == codExterno).

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Valida usuário autenticado e papel admin.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonResponse({ error: "Não autenticado" }, 401);

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: userData, error: userErr } = await supabase.auth.getUser(
      token,
    );
    if (userErr || !userData?.user) {
      return jsonResponse(
        {
          error: "Sessão inválida",
          detail: userErr?.message || "usuário não encontrado",
        },
        401,
      );
    }
    const user = userData.user;

    const { data: perfil } = await supabase
      .from("perfis")
      .select("role")
      .eq("email", user.email)
      .single();
    if (perfil?.role !== "admin") {
      return jsonResponse({ error: "Apenas administradores" }, 403);
    }

    // Credenciais e parâmetros do ClicVendas (armazenados como secrets).
    const clicUser = Deno.env.get("CLICVENDAS_USER");
    const clicPass = Deno.env.get("CLICVENDAS_PASS");
    const cnpjId = Deno.env.get("CLICVENDAS_CNPJ_ID") || "76";
    const listaPrecoId = Deno.env.get("CLICVENDAS_LISTA_PRECO_ID") || "96686";
    const subdominio = Deno.env.get("CLICVENDAS_SUBDOMINIO") || "grupoello";
    const baseUrl =
      Deno.env.get("CLICVENDAS_BASE_URL") ||
      "https://grupoello.clicvenda.com.br";

    if (!clicUser || !clicPass) {
      return jsonResponse(
        { error: "Credenciais do ClicVendas não configuradas" },
        500,
      );
    }

    const basicAuth = btoa(`${clicUser}:${clicPass}`);
    const url = `${baseUrl}/clicVendas/rest/Listas/produtosPedido`;

    const fetchFiltro = async (filtro: string): Promise<any[]> => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          Accept: "application/json, text/plain, */*",
          Authorization: `Basic ${basicAuth}`,
        },
        body: JSON.stringify({
          filtro,
          idCvTccnpj: cnpjId,
          idCvTolistapreco: Number(listaPrecoId),
        }),
      });
      if (!res.ok) return [];
      try {
        return (await res.json()) as any[];
      } catch {
        return [];
      }
    };

    const clicMap = new Map<
      string,
      {
        preco: number;
        imgId: string;
        nome: string;
        marca: string;
        estoque: number | null;
      }
    >();
    const pickMarca = (p: any, item: any): string => {
      const candidates = [
        p?.marca,
        p?.nomeMarca,
        p?.descricaoMarca,
        p?.marca?.nome,
        p?.marca?.descricao,
        item?.marca,
        item?.marca?.nome,
      ];
      for (const c of candidates) {
        if (typeof c === "string" && c.trim()) return c.trim();
      }
      return "";
    };
    const pickEstoque = (p: any, item: any): number | null => {
      // No endpoint /produtosPedido do ClicVendas, o saldo do estoque
      // principal vem em produto.qtdeEstoque.
      const candidates = [
        p?.qtdeEstoque,
        p?.estoque,
        p?.saldo,
        p?.saldoEstoque,
        p?.quantidadeEstoque,
        item?.qtdeEstoque,
        item?.estoque,
        item?.saldo,
        item?.saldoEstoque,
        item?.quantidade,
        item?.quantidadeEstoque,
      ];
      for (const c of candidates) {
        if (c === null || c === undefined || c === "") continue;
        const n = Number(c);
        if (!Number.isNaN(n)) return n;
      }
      return null;
    };
    const ingest = (items: any[]) => {
      for (const item of items) {
        const p = item?.produto;
        if (!p) continue;
        const codigo = p.codExterno ?? p.codigo ?? p.codInterno ?? p.id;
        if (codigo === undefined || codigo === null || codigo === "") continue;
        const key = String(codigo).trim();
        if (clicMap.has(key)) continue;
        clicMap.set(key, {
          preco: Number(item.preco) || 0,
          imgId: String(p.imgProduto || "").trim(),
          nome: String(p.nome || ""),
          marca: pickMarca(p, item),
          estoque: pickEstoque(p, item),
        });
      }
    };

    // Executa tarefas em paralelo limitado a `concurrency` por vez.
    const runBatched = async <T>(
      tasks: (() => Promise<T>)[],
      concurrency: number,
    ): Promise<T[]> => {
      const results: T[] = new Array(tasks.length);
      let next = 0;
      const workers = Array.from({ length: concurrency }, async () => {
        while (true) {
          const i = next++;
          if (i >= tasks.length) break;
          results[i] = await tasks[i]();
        }
      });
      await Promise.all(workers);
      return results;
    };

    // Lê parâmetros opcionais do body. produto_id permite sincronizar
    // apenas um item específico (útil pra reaproveitar o mesmo endpoint
    // sem rodar a fila inteira).
    let produtoIdAlvo: string | null = null;
    try {
      const body = await req.json();
      if (body?.produto_id) produtoIdAlvo = String(body.produto_id);
    } catch {
      // body vazio ou não-JSON — ok, segue com sync completo dos ativos.
    }

    // Busca produtos do Supabase que têm codigo_interno válido.
    // - Sync completo: apenas itens ativos.
    // - Sync individual: traz mesmo se inativo (admin escolheu o item).
    let produtosQuery = supabase
      .from("produtos")
      .select(
        "id, codigo_interno, nome, preco_unitario, preco_clic, imagem_url, ativo",
      )
      .not("codigo_interno", "is", null);

    if (produtoIdAlvo) {
      produtosQuery = produtosQuery.eq("id", produtoIdAlvo);
    } else {
      produtosQuery = produtosQuery.eq("ativo", true);
    }

    const { data: produtos, error: prodErr } = await produtosQuery;
    if (prodErr) throw prodErr;
    if (produtoIdAlvo && (!produtos || produtos.length === 0)) {
      return jsonResponse(
        { error: "Produto não encontrado ou sem código interno" },
        404,
      );
    }

    const produtosComCodigo = (produtos || []).filter((p) => {
      const cod = String(p.codigo_interno ?? "").trim();
      return cod && cod !== "0";
    });

    // Fase 1: 1 chamada por codigo_interno do sistema, usando o código
    // como filtro. Executa em lotes de 15 em paralelo.
    const codigos = Array.from(
      new Set(produtosComCodigo.map((p) => String(p.codigo_interno).trim())),
    );
    const phase1 = await runBatched(
      codigos.map((cod) => () => fetchFiltro(cod)),
      15,
    );
    phase1.forEach((items) => ingest(items));

    // Fase 2: para produtos que ainda não bateram (caso o filtro não
    // indexe por código), busca pelo início do nome.
    const faltantesApos1 = produtosComCodigo.filter(
      (p) => !clicMap.has(String(p.codigo_interno).trim()),
    );
    const prefixosNome = Array.from(
      new Set(
        faltantesApos1
          .map((p) => (p.nome || "").trim().slice(0, 6).toUpperCase())
          .filter((s) => s.length >= 2),
      ),
    );
    const phase2 = await runBatched(
      prefixosNome.map((pre) => () => fetchFiltro(pre)),
      15,
    );
    phase2.forEach((items) => ingest(items));

    // Pega o local padrão (o sistema hoje opera com 1 local ativo).
    // Usado pra fazer upsert do saldo de estoque vindo do ClicVendas.
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
      id: string;
      codigo: string;
      nome: string;
      preco_sistema: number;
      preco_clic: number;
      diferenca: number;
    }> = [];
    const erros: Array<{ id: string; nome: string; error: string }> = [];
    const faltantes: Array<{ cod: string; nome: string }> = [];

    for (const prod of produtos || []) {
      const cod = String(prod.codigo_interno).trim();
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

      const novaImg = clic.imgId
        ? `${baseUrl}/clicvenda/produtos/${subdominio}/${clic.imgId}.jpg`
        : prod.imagem_url;

      const updatePayload: Record<string, unknown> = {
        preco_clic: clic.preco,
        imagem_url: novaImg,
        preco_clic_atualizado_em: new Date().toISOString(),
      };
      if (clic.marca) updatePayload.marca = clic.marca;

      const { error: upErr } = await supabase
        .from("produtos")
        .update(updatePayload)
        .eq("id", prod.id);

      if (upErr) {
        erros.push({ id: prod.id, nome: prod.nome, error: upErr.message });
        continue;
      }

      updated++;

      // Upsert do saldo de estoque no local padrão.
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
            .update({
              quantidade: clic.estoque,
              updated_at: new Date().toISOString(),
            })
            .eq("id", estExist.id);
          if (!estErr) estoquesAtualizados++;
        } else {
          const { error: estErr } = await supabase
            .from("estoque")
            .insert({
              produto_id: prod.id,
              local_id: localPadraoId,
              quantidade: clic.estoque,
            });
          if (!estErr) estoquesAtualizados++;
        }
      }

      const precoSistema = Number(prod.preco_unitario) || 0;
      if (precoSistema > 0 && precoSistema < clic.preco) {
        alertasPreco.push({
          id: prod.id,
          codigo: cod,
          nome: prod.nome,
          preco_sistema: precoSistema,
          preco_clic: clic.preco,
          diferenca: +(clic.preco - precoSistema).toFixed(2),
        });
      }
    }

    // Amostras pra diagnosticar mismatch de códigos quando nada é atualizado.
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
      chamadas: {
        fase1_codigos: phase1.length,
        fase2_prefixos_nome: phase2.length,
        total: phase1.length + phase2.length,
      },
    });
  } catch (err) {
    return jsonResponse(
      { error: (err as Error).message || "Erro desconhecido" },
      500,
    );
  }
});
