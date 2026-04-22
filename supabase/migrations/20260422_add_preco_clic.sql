-- Adiciona coluna para armazenar o preço vindo do ClicVendas.
-- O campo preco_unitario continua sendo o preço de referência do sistema
-- (editado manualmente pelo admin). preco_clic é apenas para comparação.
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS preco_clic NUMERIC(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preco_clic_atualizado_em TIMESTAMPTZ;
