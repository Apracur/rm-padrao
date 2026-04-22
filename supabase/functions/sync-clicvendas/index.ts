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
    const clicRes = await fetch(
      `${baseUrl}/clicVendas/rest/Listas/produtosPedido`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          Accept: "application/json, text/plain, */*",
          Authorization: `Basic ${basicAuth}`,
        },
        body: JSON.stringify({
          filtro: "",
          idCvTccnpj: cnpjId,
          idCvTolistapreco: Number(listaPrecoId),
        }),
      },
    );

    if (!clicRes.ok) {
      const text = await clicRes.text();
      return jsonResponse(
        { error: `ClicVendas respondeu ${clicRes.status}: ${text.slice(0, 200)}` },
        502,
      );
    }

    const items = (await clicRes.json()) as any[];

    // Constrói índice por codExterno.
    const clicMap = new Map<
      string,
      { preco: number; imgId: string; nome: string }
    >();
    for (const item of items) {
      const p = item?.listaPreco?.produto;
      if (!p?.codExterno) continue;
      clicMap.set(String(p.codExterno).trim(), {
        preco: Number(item.listaPreco.preco) || 0,
        imgId: String(p.imgProduto || "").trim(),
        nome: String(p.nome || ""),
      });
    }

    // Busca produtos do Supabase que têm codigo_interno.
    const { data: produtos, error: prodErr } = await supabase
      .from("produtos")
      .select(
        "id, codigo_interno, nome, preco_unitario, preco_clic, imagem_url",
      )
      .not("codigo_interno", "is", null);
    if (prodErr) throw prodErr;

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

    for (const prod of produtos || []) {
      const cod = String(prod.codigo_interno).trim();
      if (!cod || cod === "0") {
        notFound++;
        continue;
      }
      const clic = clicMap.get(cod);
      if (!clic) {
        notFound++;
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
      total_clic: items.length,
      total_sistema: produtos?.length || 0,
      atualizados: updated,
      nao_encontrados: notFound,
      alertas_preco: alertasPreco,
      erros,
      amostra_codigos_clicvendas: amostraClic,
      amostra_codigos_sistema: amostraSistema,
    });
  } catch (err) {
    return jsonResponse(
      { error: (err as Error).message || "Erro desconhecido" },
      500,
    );
  }
});
