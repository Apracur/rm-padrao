-- Permite valores alfanuméricos em produtos.codigo_interno (antes INTEGER).
-- Alguns fornecedores usam códigos como "50E5106" que não cabem em INTEGER.

ALTER TABLE produtos
  ALTER COLUMN codigo_interno TYPE TEXT USING codigo_interno::text;
