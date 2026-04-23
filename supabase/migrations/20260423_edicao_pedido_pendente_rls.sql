-- Permite ao dono atualizar o pedido enquanto ainda esta pendente.
-- Admins ja sao cobertos pela policy "Admin gerencia pedidos" (FOR ALL).
CREATE POLICY "Owner edita pedido pendente" ON public.pedidos
  FOR UPDATE
  USING (usuario_id = auth.uid() AND status = 'pendente')
  WITH CHECK (usuario_id = auth.uid());

-- Reescreve a policy de INSERT em itens_pedido para tambem cobrir admins
-- e exigir status pendente quando o ator for o dono.
DROP POLICY IF EXISTS "Clientes adicionam itens" ON public.itens_pedido;
CREATE POLICY "Adicionar itens" ON public.itens_pedido
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pedidos
      WHERE pedidos.id = itens_pedido.pedido_id
        AND (
          (pedidos.usuario_id = auth.uid() AND pedidos.status = 'pendente')
          OR public.get_my_role() = 'admin'
        )
    )
  );

CREATE POLICY "Atualizar itens" ON public.itens_pedido
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.pedidos
      WHERE pedidos.id = itens_pedido.pedido_id
        AND (
          (pedidos.usuario_id = auth.uid() AND pedidos.status = 'pendente')
          OR public.get_my_role() = 'admin'
        )
    )
  );

CREATE POLICY "Remover itens" ON public.itens_pedido
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.pedidos
      WHERE pedidos.id = itens_pedido.pedido_id
        AND (
          (pedidos.usuario_id = auth.uid() AND pedidos.status = 'pendente')
          OR public.get_my_role() = 'admin'
        )
    )
  );
