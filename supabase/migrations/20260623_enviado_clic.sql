alter table pedidos
  add column if not exists enviado_clic    boolean   default false,
  add column if not exists enviado_clic_em timestamptz;
