// Edge Function temporária para descobrir a estrutura do endpoint de pedidos CLic.
// Faz login, sonda GET e POST no /api/extpedidos e retorna as respostas brutas.

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

  // Login CLic
  const loginRes = await fetch(`${AUTH_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      login: Deno.env.get("CLIC_USER"),
      senha: Deno.env.get("CLIC_PASS"),
      subdominio: "grupoello",
    }),
  });
  const loginData = await loginRes.json() as any;
  const token = loginData?.accessToken;
  if (!token) return json({ error: "Login falhou", detalhe: loginData });

  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };

  // Sonda vários endpoints candidatos
  const endpoints = [
    { method: "GET",  path: "/api/extpedidos" },
    { method: "GET",  path: "/api/extpedidos?fetch=1&skip=0" },
    { method: "GET",  path: "/api/extorcamentos" },
    { method: "GET",  path: "/api/extcompras" },
    { method: "GET",  path: "/api/pedidos" },
  ];

  const resultados: Record<string, any> = {};

  for (const ep of endpoints) {
    try {
      const r = await fetch(`${BASE_URL}${ep.path}`, { method: ep.method, headers: h });
      const body = await r.text();
      let parsed: any;
      try { parsed = JSON.parse(body); } catch { parsed = body.slice(0, 300); }
      resultados[`${ep.method} ${ep.path}`] = {
        status: r.status,
        chaves: parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? Object.keys(parsed).slice(0, 20)
          : Array.isArray(parsed)
          ? `array[${parsed.length}] chaves_item: ${Object.keys(parsed[0] ?? {}).slice(0, 20).join(", ")}`
          : String(parsed).slice(0, 200),
        amostra: JSON.stringify(parsed).slice(0, 400),
      };
    } catch (e) {
      resultados[`${ep.method} ${ep.path}`] = { erro: (e as Error).message };
    }
  }

  return json({ resultados });
});
