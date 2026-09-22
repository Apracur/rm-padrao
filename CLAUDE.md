# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos essenciais

**Frontend (visualizar localmente):**
```bash
npx serve public --listen 3000
# Abre http://localhost:3000
```

**Deploy do frontend:** push para branch `main` no GitHub → Vercel faz deploy automático.

**Deploy de Edge Function:**
```bash
cd rm-padrao-sistema
npx supabase functions deploy send-to-clic
npx supabase functions deploy sync-clicvendas
```
Se der 403, o CLI está logado na conta errada. Rode `npx supabase login` antes.

**Rodar migração SQL:** aplique via Supabase Dashboard → SQL Editor, ou pelo CLI:
```bash
npx supabase db push
```

## Arquitetura

Sistema de Requisição de Material (RM Padrão) para Grupo Ello / Ello Atacadão.

```
Vercel (estático)          Supabase (BaaS)           CLic Vendas (ERP externo)
public/index.html   ←→    PostgreSQL + Auth    ←→    grupoello.clictecnologia.com.br
(app React bundled)        Edge Functions
```

**Frontend:** `public/index.html` — app React inteiro em um único arquivo HTML (244 KB). Sem build step. O que está no arquivo é o que vai para produção. Usa Lucide icons via UMD (`window.lucide`).

**Backend:** Supabase (projeto `vejkkbotkggviqjempop`).
- Autenticação: email/senha via Supabase Auth
- Autorização: coluna `role` na tabela `perfis` — valores `cliente` ou `admin`
- Edge Functions em Deno (TypeScript) em `supabase/functions/`

**Tabelas principais:**
| Tabela | Descrição |
|---|---|
| `produtos` | 176 itens; campo `codigo_interno` (TEXT) mapeia para código interno do CLic |
| `pedidos` | Pedidos dos clientes; `enviado_clic` marca quando foi enviado ao ERP |
| `itens_pedido` | Itens de cada pedido; `preco_unitario` pode ser nulo → fallback para `produtos.preco_clic` |
| `estoque` | Quantidade por local (tabela `locais`) |
| `perfis` | Email + role do usuário |

## Edge Functions

### `send-to-clic`
Envia um pedido do RM para o CLic. Fluxo em 4 passos:
1. Atualiza preços dos produtos no catálogo CLic via `POST /api/extprodutos`
2. Busca o `_id` MongoDB do tipo de venda "Pedido de Venda" via `GET /api/tiposvenda`
3. Cria o cabeçalho do pedido com `tabelaPrecoPedido` via `POST /api/pedidos` (**tabela de preço DEVE vir antes dos itens**)
4. Adiciona os itens com `PUT /api/pedidos` usando `_id` MongoDB dos produtos

Usa a API **interna** do CLic (`/api/pedidos`), não a externa (`/api/extpedidos`). A API interna exige IDs MongoDB para todas as referências.

**IDs MongoDB fixos (hardcoded com fallback por env var):**
- `CLIC_TABELA_PRECO_ID` = `6a19d3520517dd2172421a52` (tabela 1001 - ELLO Padrão)
- `CLIC_CLIENTE_ID` = `6a19d4b90517dd217242358b`
- `CLIC_REP_ID_MONGO` = `6a19d43a0517dd2172423073`

### `sync-clicvendas`
Sincroniza catálogo do CLic → Supabase. Atualiza `preco_clic`, `imagem_url`, `marca` e estoque. Roda sem verificação JWT (`verify_jwt = false` no `config.toml`). Suporta sync completo ou de um único produto.

**Espelhamento de imagens (obrigatório para o PDF funcionar).** O host de fotos do CLic não envia `Access-Control-Allow-Origin`. Um `<img src>` funciona (o navegador só exibe), mas o `fetch()` que o gerador de PDF usa para converter a foto em base64 é bloqueado — e a coluna "Foto" sai em branco. Por isso o sync **baixa a foto do CLic e regrava no bucket `produtos-imagens`** (que responde CORS `*`), gravando em `imagem_url` a URL do Storage, nunca a do CLic.

Regras do espelhamento:
- Fotos subidas à mão pelo admin (path sem o prefixo `clic/`) **nunca** são sobrescritas.
- O que já foi espelhado é pulado nas rodadas seguintes — é idempotente e barato repetir.
- O formato sai dos *magic bytes*, não do `content-type`: o CLic serve PNG rotulado como `image/jpeg`. Isso também barra a página HTML que ele devolve com status 200 quando a foto não existe.
- Orçamento de 90s por execução. Se a resposta trouxer `imagens.pendentes > 0`, rode de novo até zerar.

Modos (via body do POST):
| Body | Efeito |
|---|---|
| `{}` | Sync completo: preço, marca, estoque **e** imagens |
| `{"mode":"sync_imagens"}` | Só as fotos, sem tocar em preço/estoque |
| `{"mode":"import_produtos"}` | Cria no Supabase os produtos que só existem no CLic |
| `{"force_imagens":true}` | Re-baixa as fotos já espelhadas (use quando mudarem no CLic) |
| `{"produto_id":"..."}` | Restringe a um produto |

**Atenção ao host das imagens:** as fotos ficam em `grupoello.clicvenda.com.br` (env `CLIC_IMG_BASE_URL`), **não** em `clictecnologia.com.br` — este último responde 200 com uma página HTML no lugar do JPEG.

### `probe-clic`
Função de diagnóstico para testar a integração com o CLic. Não é chamada pelo frontend.

## Integração CLic Vendas

- **Auth:** `POST https://admfw.clictecnologia.com.br/auth/login` → retorna `accessToken`
- **API base:** `https://grupoello.clictecnologia.com.br`
- Produtos no CLic são identificados por `backoffice.codigo` (= `codigo_interno` no Supabase)
- Campos numéricos retornados como string pelo CLic precisam ser convertidos com `fixProduto()` antes de enviar de volta
- O preço do item em `itens_pedido.preco_unitario` pode ser nulo → usar `produtos.preco_clic` como fallback

## Variáveis de ambiente (Supabase Secrets)

```
CLIC_USER / CLIC_PASS       # Credenciais de acesso ao CLic
CLIC_AUTH_URL               # https://admfw.clictecnologia.com.br
CLIC_BASE_URL               # https://grupoello.clictecnologia.com.br
CLIC_SUBDOMINIO             # grupoello
CLIC_TABELA_PRECO           # 1001
CLIC_TABELA_PRECO_ID        # _id MongoDB da tabela de preço
CLIC_CLIENTE_ID             # _id MongoDB do cliente padrão
CLIC_REP_ID_MONGO           # _id MongoDB do representante
SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  # Injetadas automaticamente
```

## Deploy

- **GitHub:** `https://github.com/Apracur/rm-padrao`
- **Vercel:** deploy automático no push para `main` — projeto `rm-padrao`, produção em **`https://rm-padrao.vercel.app`**. O antigo `rm-padrao-sistema.vercel.app` foi apagado e responde `DEPLOYMENT_NOT_FOUND`; o `.vercel/project.json` local ainda aponta para ele (rode `npx vercel link` se for usar a CLI).
- **Supabase:** `vejkkbotkggviqjempop.supabase.co`
- Primeiro usuário admin: criar via Supabase Dashboard (Authentication → Users) e inserir `role = 'admin'` na tabela `perfis`
