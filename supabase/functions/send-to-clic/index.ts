import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const AUTH_URL      = () => Deno.env.get("CLIC_AUTH_URL")      || "https://admfw.clictecnologia.com.br";
const BASE_URL      = () => Deno.env.get("CLIC_BASE_URL")      || "https://grupoello.clictecnologia.com.br";
const SUBDOMINIO    = () => Deno.env.get("CLIC_SUBDOMINIO")    || "grupoello";
const TABELA_PRECO  = () => Deno.env.get("CLIC_TABELA_PRECO")  || "1001";
// IDs MongoDB (configuráveis via env var caso mudem)
const CLIENTE_ID       = () => Deno.env.get("CLIC_CLIENTE_ID")       || "6a19d4b90517dd217242358b";
const REP_ID_MONGO     = () => Deno.env.get("CLIC_REP_ID_MONGO")     || "6a19d43a0517dd2172423073";
const TIPO_VENDA_ID    = () => Deno.env.get("CLIC_TIPO_VENDA_ID")    || "6851cb7aa5c90ae42e45fad5";
// Dados cadastrais do cliente padrão (FM2C SERVICOS GERAIS LTDA.)
const CLIENTE_CODIGO   = () => Deno.env.get("CLIC_CLIENTE_CODIGO")   || "34871";
const CLIENTE_TIPO_DOC = () => Deno.env.get("CLIC_CLIENTE_TIPO_DOC") || "CNPJ";
const CLIENTE_NUM_DOC  = () => Deno.env.get("CLIC_CLIENTE_NUM_DOC")  || "20645508000154";
const CLIENTE_TAG      = () => Deno.env.get("CLIC_CLIENTE_TAG")      || "CLIENTE";
const CLIENTE_RAZAO    = () => Deno.env.get("CLIC_CLIENTE_RAZAO")    || "FM2C SERVICOS GERAIS LTDA.";
const REP_CODIGO       = () => Deno.env.get("CLIC_REP_CODIGO")       || "7";

const NUMERIC_FIELDS = new Set([
  'altura', 'largura', 'comprimento', 'profundidade', 'volume',
  'peso', 'pesoBruto', 'pesoLiquido',
  'ipi', 'multiplos',
  'estoque', 'estoqueMinimo', 'estoqueMaximo', 'prazoEntrega',
  'quantidade', 'desconto', 'preco',
]);

function fixProduto(obj: any): any {
  if (Array.isArray(obj)) return obj.map(fixProduto);
  if (obj && typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = NUMERIC_FIELDS.has(k) && typeof v === 'string' ? (Number(v) || 0) : fixProduto(v);
    }
    return out;
  }
  return obj;
}

async function clicLogin(): Promise<{ token: string; login: string }> {
  const login = Deno.env.get("CLIC_REP_USER") || Deno.env.get("CLIC_USER") || "";
  const senha = Deno.env.get("CLIC_REP_PASS") || Deno.env.get("CLIC_PASS") || "";
  const res = await fetch(`${AUTH_URL()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, senha, subdominio: SUBDOMINIO() }),
  });
  if (!res.ok) throw new Error(`Login CLic falhou (HTTP ${res.status}): ${await res.text()}`);
  const data = await res.json() as any;
  if (!data?.accessToken) throw new Error("Login CLic não retornou accessToken.");
  return { token: data.accessToken as string, login };
}

async function atualizarPrecosClic(
  headers: Record<string, string>,
  itens: { codigoInterno: string; precoUnitario: number }[],
): Promise<{ avisos: string[]; prodMap: Map<string, string> }> {
  const codigosNecessarios = new Set(itens.map((i) => i.codigoInterno));
  const mapa = new Map<string, any>();

  for (let skip = 0; mapa.size < codigosNecessarios.size; skip += 100) {
    const r = await fetch(`${BASE_URL()}/api/extprodutos?fetch=100&skip=${skip}`, { headers });
    if (!r.ok) break;
    const raw = await r.json() as any;
    const lista: any[] = raw?.dados ?? [];
    if (!lista.length) break;
    for (const p of lista) {
      if (codigosNecessarios.has(p.backoffice?.codigo)) {
        mapa.set(p.backoffice.codigo, p);
      }
    }
  }

  const atualizacoes: any[] = [];
  for (const item of itens) {
    const prod = mapa.get(item.codigoInterno);
    if (!prod) continue;
    const prodAtualizado = fixProduto(prod);
    for (const tp of prodAtualizado.precos ?? []) {
      if (tp.codigoTabela === TABELA_PRECO()) {
        tp.precos = [{ quantidade: 999999999, desconto: 0, preco: item.precoUnitario }];
      }
    }
    atualizacoes.push(prodAtualizado);
  }

  if (atualizacoes.length > 0) {
    const updateRes = await fetch(`${BASE_URL()}/api/extprodutos`, {
      method: "POST",
      headers,
      body: JSON.stringify(atualizacoes),
    });
    const updateData = await updateRes.json() as any;
    if ((updateData?.totalFalhas ?? 0) > 0) {
      const msg = updateData?.resultados?.[0]?.mensagem || "Erro ao atualizar preço CLic";
      throw new Error(`Falha ao atualizar preço no CLic: ${msg}`);
    }
  }

  const prodMap = new Map<string, string>();
  for (const [cod, prod] of mapa.entries()) {
    if (prod?._id) prodMap.set(cod, prod._id);
  }

  const avisos: string[] = [];
  for (const item of itens) {
    if (!mapa.has(item.codigoInterno)) {
      avisos.push(`Produto ${item.codigoInterno} não encontrado no CLic`);
    }
  }
  return { avisos, prodMap };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization") || "";
    const userToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!userToken) return json({ error: "Não autenticado" }, 401);

    const { data: { user }, error: userErr } = await supabase.auth.getUser(userToken);
    if (userErr || !user) return json({ error: "Sessão inválida" }, 401);

    const { data: perfil } = await supabase
      .from("perfis").select("role").eq("email", user.email).single();
    if (perfil?.role !== "admin") return json({ error: "Apenas administradores" }, 403);

    const body = await req.json() as any;
    const pedidoId = body?.pedido_id;
    if (!pedidoId) return json({ error: "pedido_id obrigatório" }, 400);

    const { data: pedido, error: pedErr } = await supabase
      .from("pedidos")
      .select("id, numero_pedido, status, observacoes")
      .eq("id", pedidoId)
      .single();
    if (pedErr || !pedido) return json({ error: "Pedido não encontrado" }, 404);

    const { data: itens, error: itErr } = await supabase
      .from("itens_pedido")
      .select("quantidade, preco_unitario, produtos(codigo_interno, nome, preco_clic)")
      .eq("pedido_id", pedidoId);
    if (itErr) throw itErr;

    if (!itens || itens.length === 0)
      return json({ error: "Pedido sem itens" }, 400);

    const itensClic = (itens as any[])
      .filter((i) => i.produtos?.codigo_interno && String(i.produtos.codigo_interno).trim() !== "0")
      .map((i) => ({
        _codigoInterno: String(i.produtos.codigo_interno).trim(),
        _precoUnitario: Number(i.preco_unitario) || Number(i.produtos?.preco_clic) || 0,
        quantidade:     Number(i.quantidade),
      }));

    if (itensClic.length === 0)
      return json({ error: "Nenhum item com código interno válido para enviar ao CLic" }, 400);

    const itensSemCodigo = (itens as any[])
      .filter((i) => !i.produtos?.codigo_interno || String(i.produtos.codigo_interno).trim() === "0")
      .map((i) => i.produtos?.nome || "?");

    const { token: clicToken, login: clicLoginUsuario } = await clicLogin();
    const headers = {
      Authorization: `Bearer ${clicToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // Passo 1: atualiza preços no catálogo e obtém _ids dos produtos
    const { avisos, prodMap } = await atualizarPrecosClic(
      headers,
      itensClic.map((i) => ({ codigoInterno: i._codigoInterno, precoUnitario: i._precoUnitario })),
    );

    const itensInternos = itensClic
      .filter((i) => prodMap.has(i._codigoInterno))
      .map((i) => ({
        produto:           { _id: prodMap.get(i._codigoInterno) },
        quantidade:        i.quantidade,
        codigoTabelaPreco: TABELA_PRECO(),
      }));

    const itensSemId = itensClic
      .filter((i) => !prodMap.has(i._codigoInterno))
      .map((i) => i._codigoInterno);

    // Passo 2: cria o cabeçalho do pedido (itens: []) — tabela de preço primeiro
    // CLic exige dados fiscais completos do cliente para tipo "Pedido de Venda"
    // e crasha se itens forem enviados junto com o cliente na mesma requisição.
    const headerPayload = {
      cliente: {
        _id:              CLIENTE_ID(),
        codigo:           CLIENTE_CODIGO(),
        tipoDocumento:    CLIENTE_TIPO_DOC(),
        numeroDocumento:  CLIENTE_NUM_DOC(),
        tagIdentificacao: CLIENTE_TAG(),
        razaoSocial:      CLIENTE_RAZAO(),
      },
      representante:     { _id: REP_ID_MONGO(), codigo: REP_CODIGO() },
      codigoTabelaPreco: TABELA_PRECO(),
      tipoVenda:         { _id: TIPO_VENDA_ID() },
      observacao:        pedido.observacoes || `RM-${pedido.numero_pedido}`,
      itens:             [],
    };

    const criarRes = await fetch(`${BASE_URL()}/api/pedidos`, {
      method: "POST",
      headers,
      body: JSON.stringify({ pedido: headerPayload }),
    });
    const criarText = await criarRes.text();
    let criarData: any;
    try { criarData = JSON.parse(criarText); } catch { criarData = criarText; }

    if (!criarRes.ok) {
      return json({
        error: `Falha ao criar pedido no CLic (HTTP ${criarRes.status})`,
        detalhe: criarData,
        login_usado: clicLoginUsuario,
      }, 502);
    }

    const pedidoClicId: string =
      criarData?._id || criarData?.objeto?._id || criarData?.id || "";
    if (!pedidoClicId) {
      return json({
        error: "CLic não retornou _id do pedido criado",
        resposta: criarData,
        login_usado: clicLoginUsuario,
      }, 502);
    }

    // Passo 3: adiciona os itens ao pedido criado
    const putRes = await fetch(`${BASE_URL()}/api/pedidos`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        id: pedidoClicId,
        pedido: { itens: itensInternos },
      }),
    });
    const putText = await putRes.text();
    let putData: any;
    try { putData = JSON.parse(putText); } catch { putData = putText; }

    if (!putRes.ok) {
      return json({
        error: `Falha ao adicionar itens ao pedido CLic (HTTP ${putRes.status})`,
        pedido_clic_id: pedidoClicId,
        detalhe: putData,
        login_usado: clicLoginUsuario,
      }, 502);
    }

    const numeroClic = criarData?.numero ?? criarData?.objeto?.numero
      ?? putData?.numero ?? putData?.objeto?.numero ?? pedidoClicId;

    await supabase
      .from("pedidos")
      .update({ enviado_clic: true, enviado_clic_em: new Date().toISOString() })
      .eq("id", pedidoId);

    return json({
      ok:               true,
      pedido_clic_id:   pedidoClicId,
      numero_clic:      numeroClic,
      itens_enviados:   itensInternos.length,
      itens_sem_id:     itensSemId,
      itens_sem_codigo: itensSemCodigo,
      avisos,
    });
  } catch (err) {
    return json({ error: (err as Error).message || "Erro desconhecido" }, 500);
  }
});
