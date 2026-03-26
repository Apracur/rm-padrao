const fs = require('fs');
let content = fs.readFileSync('public/index.html', 'utf8');

// Pattern 1: WhatsApp in NovaRequisicao (showSuccess toast)
const p1 = /\{lastPedido && \(\s*<a\s[\s\S]*?<\/a>\s*\)\}/;
const r1 = `{lastPedido && (() => {
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
              })()}`;

const m1 = content.match(p1);
if (m1) {
  console.log('Pattern 1 found, length:', m1[0].length);
  content = content.replace(p1, r1);
  console.log('Fix 1 applied');
} else {
  console.log('Pattern 1 NOT found');
}

// Pattern 2: WhatsApp in MeusPedidos (expanded order)
const p2 = /\{\/\* WhatsApp Share Button \*\/\}\s*<div className="mb-4">[\s\S]*?<\/div>/;
const r2 = `{/* WhatsApp Share Button */}
                      <div className="mb-4">
                        <a
                          href={'https://wa.me/?text=Requisicao%20de%20Material%0A%0APedido:%20' + pedido.numero_pedido + '%0AData:%20' + formatDate(pedido.created_at) + '%0AMes:%20' + getMonthName(pedido.mes_referencia) + '%0AValor:%20' + formatCurrency(pedido.valor_total) + '%0AStatus:%20' + getStatusLabel(pedido.status)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg font-medium transition text-sm"
                        >
                          Compartilhar no WhatsApp
                        </a>
                      </div>`;

const m2 = content.match(p2);
if (m2) {
  console.log('Pattern 2 found, length:', m2[0].length);
  content = content.replace(p2, r2);
  console.log('Fix 2 applied');
} else {
  console.log('Pattern 2 NOT found');
}

fs.writeFileSync('public/index.html', content, 'utf8');
console.log('Done! New size:', content.length);
