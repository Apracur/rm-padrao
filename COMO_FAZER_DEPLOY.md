# Como Fazer o Deploy do Sistema RM Padrão

## Dados do Supabase (já configurado)
- **URL:** https://vejkkbotkggviqjempop.supabase.co
- **Projeto:** RM Padrao - Requisicao de Material
- **Banco de dados:** ✅ Configurado com 176 produtos

## Opção 1 — Deploy no Vercel (Recomendado, gratuito)

### Passo 1: Criar repositório no GitHub
1. Acesse https://github.com/new
2. Nome do repositório: `rm-padrao`
3. Visibilidade: **Public**
4. Clique em **Create repository**

### Passo 2: Fazer upload dos arquivos
1. No repositório criado, clique em **"uploading an existing file"**
2. Faça upload de todos os arquivos da pasta `rm-padrao-sistema/`
   - `public/index.html`
   - `vercel.json`
3. Clique em **Commit changes**

### Passo 3: Deploy no Vercel
1. Acesse https://vercel.com/new
2. Clique em **"Import Git Repository"**
3. Selecione o repositório `rm-padrao`
4. Nas configurações de build, deixe tudo padrão (o vercel.json já cuida disso)
5. Clique em **Deploy**
6. Em ~2 minutos o sistema estará online!

---

## Opção 2 — Testar localmente agora
Abra o arquivo `public/index.html` diretamente no navegador.
O sistema já está conectado ao banco de dados Supabase e funciona imediatamente!

---

## Criar usuário administrador
Após o deploy, você precisará criar o primeiro usuário:

1. Acesse o painel do Supabase: https://supabase.com/dashboard/project/vejkkbotkggviqjempop
2. Vá em **Authentication > Users > Add User**
3. Preencha o email e senha
4. Depois vá em **Table Editor > perfis**
5. Altere o campo `role` do usuário para `admin`

---

## Funcionalidades do Sistema

### Para o Cliente (role: cliente)
- Login com email/senha
- Catálogo com 176 produtos e preços
- Busca por nome e filtro por marca
- Visualização do estoque disponível
- Carrinho de compras com total em tempo real
- Aviso quando ultrapassar orçamento de R$20.000
- Finalização do pedido com observações
- Botão de compartilhar resumo no WhatsApp
- Histórico de pedidos

### Para o Admin (role: admin)
- Tudo do cliente +
- Gerenciar estoque de todos os produtos
  - Edição manual (clique na quantidade para editar)
  - Importar planilha Excel (.xlsx) com colunas: Código + Quantidade
  - Exportar estoque atual para Excel
  - Alertas de estoque baixo (vermelho = zerado, amarelo = abaixo do mínimo)
- Ver e gerenciar pedidos de todos os clientes
- Alterar status dos pedidos (pendente → aprovado → entregue)

---

## Estrutura da Planilha para Importar Estoque
O sistema aceita planilhas Excel (.xlsx) com o seguinte formato:

| Código | Quantidade |
|--------|-----------|
| 19153  | 50        |
| 19788  | 20        |
| 14352  | 15        |

Onde "Código" é o código interno do produto (coluna Cód. Interno da tabela de preços).
