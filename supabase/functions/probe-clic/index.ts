// Probe v80: descobre formato correto para POST /api/extpedidos
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const AUTH_URL = "https://admfw.clictecnologia.com.br";
const BASE_URL = "https://grupoello.clictecnologia.com.br";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const authHeader = req.headers.get("Authorization") || "";
  const { data: { user } } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  if (!user) return json({ error: "Não autenticado" }, 401);
  const { data: perfil } = await supabase.from("perfis").select("role").eq("email", user.email).single();
  if (perfil?.role !== "admin") return json({ error: "Apenas admins" }, 403);

  const repToken = await (async () => {
    const r = await fetch(`${AUTH_URL}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: Deno.env.get("CLIC_REP_USER") || "REP107", senha: Deno.env.get("CLIC_REP_PASS") || "Ell@2020+", subdominio: "grupoello" }),
    });
    return (await r.json() as any)?.accessToken ?? null;
  })();
  if (!repToken) return json({ erro: "Login falhou" });

  const h = { Authorization: `Bearer ${repToken}`, "Content-Type": "application/json", Accept: "application/json" };

  // Pega extpedido existente para ver estrutura real
  const extR = await fetch(`${BASE_URL}/api/extpedidos?fetch=1&skip=0`, { headers: h });
  const extData = await extR.json() as any;
  const extEx = (extData?.dados ?? [])[0] ?? null;

  // Mostra backoffice do cliente e representante e estrutura de item
  const extClienteBackoffice = extEx?.cliente?.backoffice;
  const extRepBackoffice = extEx?.representante?.backoffice;
  const extItemAmostra = extEx?.itens?.[0]
    ? JSON.stringify(extEx.itens[0]).slice(0, 400)
    : null;

  async function tryExtPost(label: string, body: any) {
    const r = await fetch(`${BASE_URL}/api/extpedidos`, {
      method: "POST", headers: h, body: JSON.stringify(body),
    });
    let d: any;
    try { d = await r.json(); } catch { d = await r.text(); }
    return {
      status: r.status,
      sucesso: (d?.totalSucessos ?? 0) > 0,
      mensagem: (d?.resultados?.[0]?.mensagem ?? d?.mensagem ?? "").slice(0, 200),
      numero: d?.resultados?.[0]?.numero ?? null,
      resposta: JSON.stringify(d).slice(0, 300),
    };
  }

  const resultados: Record<string, any> = {};

  // A: numeroDocumentoCliente no topo (não dentro de cliente)
  resultados.A_numDoc_topo = await tryExtPost("A", [{
    codigoCliente: "34871",
    numeroDocumentoCliente: "20645508000154",
    codigoRepresentante: "7",
    codigoTabelaPreco: "1001",
    observacao: "PROBE-V80-A",
    itens: [{ codigoProduto: "16930", quantidade: 1 }],
  }]);

  // B: com backoffice.codigo para cliente
  resultados.B_backoffice = await tryExtPost("B", [{
    cliente: { backoffice: { codigo: "34871" }, numeroDocumentoCliente: "20645508000154" },
    representante: { backoffice: { codigo: "7" } },
    codigoTabelaPreco: "1001",
    observacao: "PROBE-V80-B",
    itens: [{ produto: { backoffice: { codigo: "16930" } }, quantidade: 1 }],
  }]);

  // C: estrutura tipo extprodutos — campo "backoffice" no topo do pedido?
  resultados.C_sem_cliente = await tryExtPost("C", [{
    numeroDocumentoCliente: "20645508000154",
    tipoDocumentoCliente: "CNPJ",
    codigoTabelaPreco: "1001",
    observacao: "PROBE-V80-C",
    itens: [{ produto: { codigo: "16930" }, quantidade: 1 }],
  }]);

  // D: só os campos de validação para ver próximo erro
  resultados.D_minimo = await tryExtPost("D", [{
    cliente: { codigo: "34871" },
    numeroDocumentoCliente: "20645508000154",
    codigoTabelaPreco: "1001",
    observacao: "PROBE-V80-D",
    itens: [{ produto: { codigo: "16930" }, quantidade: 1 }],
  }]);

  // E: usa _id do cliente + numeroDocumentoCliente fora
  resultados.E_id_fora = await tryExtPost("E", [{
    cliente: { _id: "6a19d4b90517dd217242358b", codigo: "34871" },
    numeroDocumentoCliente: "20645508000154",
    tipoDocumentoCliente: "CNPJ",
    representante: { codigo: "7" },
    codigoTabelaPreco: "1001",
    observacao: "PROBE-V80-E",
    itens: [{ produto: { codigo: "16930" }, quantidade: 1 }],
  }]);

  return json({
    ext_cliente_backoffice: extClienteBackoffice,
    ext_rep_backoffice: extRepBackoffice,
    ext_item_amostra: extItemAmostra,
    resultados,
  });
});
