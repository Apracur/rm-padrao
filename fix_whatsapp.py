import re

with open('public/index.html', encoding='utf-8') as f:
    content = f.read()

# ---- Fix 1: WhatsApp in NovaRequisicao (showSuccess toast) ----
# Lines 475-491: nested template literal with real newlines
pattern1 = re.compile(
    r'\{lastPedido && \(\s*<a\s+href=\{`https://wa\.me/\?text=\$\{encodeURIComponent\(`.*?`\)\}`\}.*?</a>\s*\)\}',
    re.DOTALL
)

replacement1 = """{lastPedido && (() => {
                const waMsgNR = 'Pedido: ' + lastPedido.numero + '%0AMes: ' + getMonthName(lastPedido.mes) + '%0AValor Total: ' + formatCurrency(lastPedido.valor) + '%0ACliente: FM2C%0A%0AAguardando aprovacao.';
                return (
                  <a
                    href={'https://wa.me/?text=Requisicao%20de%20Material%20-%20Ello%20Atacadao%0A%0A' + waMsgNR}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg font-medium transition text-sm"
                  >
                    Compartilhar no WhatsApp
                  </a>
                );
              })()}"""

count1 = len(pattern1.findall(content))
print(f"Pattern 1 matches: {count1}")
content = pattern1.sub(replacement1, content, count=1)

# ---- Fix 2: WhatsApp in MeusPedidos (expanded order view) ----
pattern2 = re.compile(
    r'\{/\* WhatsApp Share Button \*/\}\s*<div className="mb-4">\s*<a\s+href=\{`https://wa\.me/\?text=\$\{encodeURIComponent\(`.*?`\)\}`\}.*?</a>\s*</div>',
    re.DOTALL
)

replacement2 = """{/* WhatsApp Share Button */}
                      <div className="mb-4">
                        <a
                          href={'https://wa.me/?text=Requisicao%20de%20Material%0A%0APedido:%20' + pedido.numero_pedido + '%0AData:%20' + formatDate(pedido.created_at) + '%0AMes:%20' + getMonthName(pedido.mes_referencia) + '%0AValor:%20' + formatCurrency(pedido.valor_total) + '%0AStatus:%20' + getStatusLabel(pedido.status)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg font-medium transition text-sm"
                        >
                          Compartilhar no WhatsApp
                        </a>
                      </div>"""

count2 = len(pattern2.findall(content))
print(f"Pattern 2 matches: {count2}")
content = pattern2.sub(replacement2, content, count=1)

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done!")
