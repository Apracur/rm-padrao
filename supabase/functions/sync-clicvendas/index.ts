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

    // A API tem cap de 100 itens por chamada. Para trazer o catálogo
    // completo iteramos por prefixos alfanuméricos e deduplicamos.
    const CAP = 100;
    const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");

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
      { preco: number; imgId: string; nome: string }
    >();
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
        });
      }
    };

    // Fase 1: varredura por 1 char.
    const phase1 = await Promise.all(CHARS.map((c) => fetchFiltro(c)));
    phase1.forEach((items) => ingest(items));

    // Fase 2: onde a fase 1 bateu no cap, recurse com 2 chars.
    const truncated1 = CHARS.filter((_, i) => phase1[i].length >= CAP);
    const phase2Pairs: string[] = [];
    const phase2Calls: Promise<any[]>[] = [];
    for (const c1 of truncated1) {
      for (const c2 of CHARS) {
        phase2Pairs.push(c1 + c2);
        phase2Calls.push(fetchFiltro(c1 + c2));
      }
    }
    const phase2 = await Promise.all(phase2Calls);
    phase2.forEach((items) => ingest(items));

    // Fase 3: onde a fase 2 bateu no cap, recurse com 3 chars.
    const truncated2 = phase2Pairs.filter((_, i) => phase2[i].length >= CAP);
    const phase3Calls: Promise<any[]>[] = [];
    for (const pair of truncated2) {
      for (const c of CHARS) {
        phase3Calls.push(fetchFiltro(pair + c));
      }
    }
    const phase3 = await Promise.all(phase3Calls);
    phase3.forEach((items) => ingest(items));

    // Busca produtos do Supabase que têm codigo_interno.
    const { data: produtos, error: prodErr } = await supabase
      .from("produtos")
      .select(
        "id, codigo_interno, nome, preco_unitario, preco_clic, imagem_url",
      )
      .not("codigo_interno", "is", null);
    if (prodErr) throw prodErr;

    // Fase 4: para produtos do sistema ainda sem correspondência, busca
    // pelo nome (primeiros N chars) como filtro. Cobre produtos raros
    // que não saíram na varredura alfabética.
    const faltantesApos123 = (produtos || []).filter((p) => {
      const cod = String(p.codigo_interno ?? "").trim();
      return cod && cod !== "0" && !clicMap.has(cod);
    });
    const prefixosNome = Array.from(
      new Set(
        faltantesApos123
          .map((p) => (p.nome || "").trim().slice(0, 6).toUpperCase())
          .filter((s) => s.length >= 2),
      ),
    );
    const phase4 = await Promise.all(
      prefixosNome.map((pre) => fetchFiltro(pre)),
    );
    phase4.forEach((items) => ingest(items));

    let updated = 0;
    let notFound = 0;
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

      const { error: upErr } = await supabase
        .from("produtos")
        .update({
          preco_clic: clic.preco,
          imagem_url: novaImg,
          preco_clic_atualizado_em: new Date().toISOString(),
        })
        .eq("id", prod.id);

      if (upErr) {
        erros.push({ id: prod.id, nome: prod.nome, error: upErr.message });
        continue;
      }

      updated++;

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
      nao_encontrados: notFound,
      alertas_preco: alertasPreco,
      erros,
      amostra_codigos_clicvendas: amostraClic,
      amostra_codigos_sistema: amostraSistema,
      faltantes,
      chamadas: {
        fase1: phase1.length,
        fase2: phase2.length,
        fase3: phase3.length,
        fase4: phase4.length,
        total: phase1.length + phase2.length + phase3.length + phase4.length,
      },
    });
  } catch (err) {
    return jsonResponse(
      { error: (err as Error).message || "Erro desconhecido" },
      500,
    );
  }
});
