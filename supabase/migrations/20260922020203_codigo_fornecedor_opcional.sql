-- O campo "Cód. Fornecedor" saiu do sistema em 22/04/2026 (commit 1deac0a),
-- mas a coluna continuou NOT NULL e sem default: criar produto pela tela e
-- o "Importar produtos do CLic" falhavam com
-- 'null value in column "codigo_fornecedor" ... violates not-null constraint'.
-- A coluna é mantida (os valores antigos ficam), só deixa de ser obrigatória.
alter table public.produtos alter column codigo_fornecedor drop not null;
