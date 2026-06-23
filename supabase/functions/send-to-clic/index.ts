// Supabase Edge Function: send-to-clic
// Envia um pedido do sistema RM para o CLic, criando um pedido de venda
// no nome do cliente (código 34871) via API REST (JWT Bearer).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const AUTH_URL   = () => Deno.env.get("CLIC_AUTH_URL")        || "https://admfw.clictecnologia.com.br";
const BASE_URL   = () => Deno.env.get("CLIC_BASE_URL")        || "https://grupoello.clictecnologia.com.br";
const SUBDOMINIO = () => Deno.env.get("CLIC_SUBDOMINIO")      || "grupoello";
const COD_CLIENTE     = () => Deno.env.get("CLIC_COD_CLIENTE")     || "34871";
const DOC_CLIENTE     = () => Deno.env.get("CLIC_DOC_CLIENTE")     || "20645508000154";
const DOC_REP         = () => Deno.env.get("CLIC_DOC_REP")         || "79086306500";
const PREFIXO_COD     = () => Deno.env.get("CLIC_PREFIXO_COD")     || "10";
const TABELA_PRECO    = () => Deno.env.get("CLIC_TABELA_PRECO")    || "1001";

async function clicLogin(): Promise<string> {
  const res = await fetch(`${AUTH_URL()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      login: Deno.env.get("CLIC_USER"),
      senha: Deno.env.get("CLIC_PASS"),
      subdominio: SUBDOMINIO(),
    }),
  });
  if (!res.ok) throw new Error(`Login CLic falhou (HTTP ${res.status}): ${await res.text()}`);
  const data = await res.json() as any;
  if (!data?.accessToken) throw new Error("Login CLic não retornou accessToken.");
  return data.accessToken as string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Autentica usuário
    const authHeader = req.headers.get("Authorization") || "";
    const userToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!userToken) return json({ error: "Não autenticado" }, 401);

    const { data: { user }, error: userErr } = await supabase.auth.getUser(userToken);
    if (userErr || !user) return json({ error: "Sessão inválida" }, 401);

    const { data: perfil } = await supabase
      .from("perfis").select("role").eq("email", user.email).single();
    if (perfil?.role !== "admin") return json({ error: "Apenas administradores" }, 403);

    // Lê o pedido_id do body
    const body = await req.json() as any;
    const pedidoId = body?.pedido_id;
    if (!pedidoId) return json({ error: "pedido_id obrigatório" }, 400);

    // Busca o pedido e seus itens no Supabase
    const { data: pedido, error: pedErr } = await supabase
      .from("pedidos")
      .select("id, numero_pedido, status, observacoes")
      .eq("id", pedidoId)
      .single();
    if (pedErr || !pedido) return json({ error: "Pedido não encontrado" }, 404);

    const { data: itens, error: itErr } = await supabase
      .from("itens_pedido")
      .select("quantidade, preco_unitario, produtos(codigo_interno, nome)")
      .eq("pedido_id", pedidoId);
    if (itErr) throw itErr;

    if (!itens || itens.length === 0)
      return json({ error: "Pedido sem itens" }, 400);

    // Monta os itens para o CLic
    const itensClic = (itens as any[])
      .filter((i) => i.produtos?.codigo_interno && String(i.produtos.codigo_interno).trim() !== "0")
      .map((i) => ({
        codigoProduto:      `${PREFIXO_COD()}_${String(i.produtos.codigo_interno).trim()}`,
        codigoVariacao:     " ",
        codigoTabelaPreco:  TABELA_PRECO(),
        quantidade:    Number(i.quantidade),
        precoUnitario: Number(i.preco_unitario),
      }));

    if (itensClic.length === 0)
      return json({ error: "Nenhum item com código interno válido para enviar ao CLic" }, 400);

    const itensSemCodigo = (itens as any[])
      .filter((i) => !i.produtos?.codigo_interno || String(i.produtos.codigo_interno).trim() === "0")
      .map((i) => i.produtos?.nome || "?");

    // Login CLic e envio do pedido
    const clicToken = await clicLogin();
    const headers = {
      Authorization: `Bearer ${clicToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // Tenta POST /api/extpedidos (endpoint padrão para criação de pedidos)
    const payload = {
      codigoCliente: COD_CLIENTE(),
      numeroDocumentoCliente: DOC_CLIENTE(),
      numeroDocumentoRepresentante: DOC_REP(),
      observacao: pedido.observacoes || `RM-${pedido.numero_pedido}`,
      itens: itensClic,
    };

    const clicRes = await fetch(`${BASE_URL()}/api/extpedidos`, {
      method: "POST",
      headers,
      body: JSON.stringify([payload]),
    });

    const clicBody = await clicRes.text();
    let clicData: any;
    try { clicData = JSON.parse(clicBody); } catch { clicData = clicBody; }

    if (!clicRes.ok) {
      return json({
        error: `CLic recusou o pedido (HTTP ${clicRes.status})`,
        detalhe: clicData,
        payload_enviado: payload,
      }, 502);
    }

    // CLic retorna 200 mesmo com falhas — verifica totalFalhas
    const totalFalhas   = clicData?.totalFalhas   ?? 0;
    const totalSucessos = clicData?.totalSucessos ?? 0;
    if (totalFalhas > 0 && totalSucessos === 0) {
      const msg = clicData?.resultados?.[0]?.mensagem || clicData?.mensagem || "Falha no CLic";
      return json({ error: msg, detalhe: clicData, payload_enviado: payload }, 502);
    }

    // Sucesso — marca o pedido como enviado ao CLic
    await supabase
      .from("pedidos")
      .update({ enviado_clic: true, enviado_clic_em: new Date().toISOString() })
      .eq("id", pedidoId);

    return json({
      ok: true,
      pedido_clic: clicData,
      itens_enviados: itensClic.length,
      itens_sem_codigo: itensSemCodigo,
    });
  } catch (err) {
    return json({ error: (err as Error).message || "Erro desconhecido" }, 500);
  }
});
