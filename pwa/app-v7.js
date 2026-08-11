const CONFIG = {
  botPhone: '595994124451',
  brand: 'Miño Goup',
  ticketPrice: 1000,
  defaultCommission: 200
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let sellers = [];
let sales = [];
let leads = [];

function money(value) {
  return `${new Intl.NumberFormat('es-PY').format(Number(value) || 0)} Gs.`;
}

function cleanCode(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 14);
}

function sellerLink(seller) {
  const text = `Hola, quiero comprar boletas del sorteo ${CONFIG.brand}. Vendedor: ${seller.code}`;
  return `https://wa.me/${CONFIG.botPhone}?text=${encodeURIComponent(text)}`;
}

function toast(text) {
  $('#toast').textContent = text;
  $('#toast').classList.add('is-visible');
  setTimeout(() => $('#toast').classList.remove('is-visible'), 1900);
}

async function copyText(text, message) {
  await navigator.clipboard.writeText(text);
  toast(message);
}

function pick(row, names) {
  for (const name of names) {
    if (row[name] != null) return row[name];
  }
  return '';
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo completar');
  return data;
}

async function loadData() {
  const [sellerData, saleData, leadData] = await Promise.all([
    api('/api/sellers'),
    api('/api/sales'),
    api('/api/leads')
  ]);
  sellers = sellerData.sellers.filter((seller) => seller.code !== 'DEMO');
  sales = saleData.sales;
  leads = leadData.leads || [];
  renderAll();
}

function saleCode(sale) {
  return cleanCode(pick(sale, ['codigo_vendedor', 'Codigo vendedor', 'codigoVendedor']));
}

function sellerTotals(seller) {
  const code = cleanCode(seller.code);
  const rows = sales.filter((sale) => saleCode(sale) === code);
  const sellerLeads = leads.filter((lead) => cleanCode(pick(lead, ['codigo_vendedor'])) === code);
  return {
    leads: sellerLeads.length,
    tickets: rows.reduce((sum, sale) => sum + Number(pick(sale, ['cantidad', 'Cantidad'])), 0),
    revenue: rows.reduce((sum, sale) => sum + Number(pick(sale, ['total', 'Total Gs.'])), 0),
    commission: rows.reduce((sum, sale) => sum + Number(pick(sale, ['comision', 'Comision Gs.'])), 0)
  };
}

function renderMetrics() {
  const revenue = sales.reduce((sum, sale) => sum + Number(pick(sale, ['total', 'Total Gs.'])), 0);
  const tickets = sales.reduce((sum, sale) => sum + Number(pick(sale, ['cantidad', 'Cantidad'])), 0);
  const commission = sales.reduce((sum, sale) => sum + Number(pick(sale, ['comision', 'Comision Gs.'])), 0);
  $('#metricRevenue').textContent = money(revenue);
  $('#metricTickets').textContent = tickets;
  $('#metricCommission').textContent = money(commission);
}

function renderSellers() {
  if (!sellers.length) {
    $('#sellerList').innerHTML = `
      <article class="seller-item">
        <strong>Agrega tu primer vendedor</strong>
        <div class="meta">Despues de guardar, aparece su link personal para compartir.</div>
      </article>
    `;
    return;
  }

  $('#sellerList').innerHTML = sellers
    .map((seller) => {
      const total = sellerTotals(seller);
      return `
        <article class="seller-item">
          <strong>${seller.name}</strong>
          <div class="meta">Codigo ${seller.code} · ${total.leads} interesados · ${total.tickets} boletas · ${money(total.commission)} comision</div>
          <div class="actions">
            <button class="primary" data-share="${seller.id}">Enviar por WhatsApp</button>
            <button class="soft" data-copy="${seller.id}">Copiar link</button>
            <button class="soft" data-remove="${seller.id}">Quitar</button>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderRanking() {
  const directRows = sales.filter((sale) => saleCode(sale) === 'DIRECTO' || !saleCode(sale));
  const direct = {
    seller: { name: 'Venta directa' },
    tickets: directRows.reduce((sum, sale) => sum + Number(pick(sale, ['cantidad', 'Cantidad'])), 0),
    revenue: directRows.reduce((sum, sale) => sum + Number(pick(sale, ['total', 'Total Gs.'])), 0),
    commission: 0
  };

  const rows = sellers
    .map((seller) => ({ seller, ...sellerTotals(seller) }))
    .sort((a, b) => b.revenue - a.revenue);

  if (direct.tickets > 0) rows.push(direct);

  $('#rankingList').innerHTML = rows.length
    ? rows
        .map((row, index) => {
          return `
            <article class="rank-item">
              <strong>${index + 1}. ${row.seller.name}</strong>
              <div class="meta">${row.tickets} boletas · ${money(row.revenue)} vendido · ${money(row.commission)} comision</div>
            </article>
          `;
        })
        .join('')
    : `<article class="rank-item"><strong>Sin ventas todavia</strong><div class="meta">Cuando el bot venda, aparece aca.</div></article>`;
}

function renderSales() {
  $('#salesList').innerHTML = sales.length
    ? sales
        .slice()
        .reverse()
        .map((sale) => {
          const vendedor = pick(sale, ['vendedor', 'Vendedor']) || 'Venta directa';
          const cliente = pick(sale, ['nombre', 'Nombre y apellido']) || 'Cliente';
          const cantidad = pick(sale, ['cantidad', 'Cantidad']);
          const total = pick(sale, ['total', 'Total Gs.']);
          const telefono = pick(sale, ['telefono', 'Telefono']);
          const ci = pick(sale, ['ci', 'CI']);
          const fecha = pick(sale, ['fecha', 'Fecha']);
          return `
            <article class="sale-item">
              <strong>${cliente}</strong>
              <div class="meta">${vendedor} · ${cantidad} boletas · ${money(total)}</div>
              <div class="meta">${telefono || 'Sin telefono'} · CI ${ci || 'sin CI'} · ${fecha}</div>
            </article>
          `;
        })
        .join('')
    : `<article class="sale-item"><strong>No hay ventas registradas</strong><div class="meta">Las ventas entran desde el bot de WhatsApp.</div></article>`;
}

function renderAll() {
  renderMetrics();
  renderSellers();
  renderRanking();
  renderSales();
}

function setView(viewId) {
  $$('.view').forEach((view) => view.classList.toggle('is-visible', view.id === viewId));
  $$('.step').forEach((step) => step.classList.toggle('is-active', step.dataset.view === viewId));
  if (viewId === 'control') loadData().catch((error) => toast(error.message));
}

function exportCsv() {
  const rows = [['fecha', 'vendedor', 'codigo', 'cliente', 'telefono', 'ci', 'boletas', 'total', 'comision']];
  for (const sale of sales) {
    rows.push([
      pick(sale, ['fecha', 'Fecha']),
      pick(sale, ['vendedor', 'Vendedor']),
      pick(sale, ['codigo_vendedor', 'Codigo vendedor']),
      pick(sale, ['nombre', 'Nombre y apellido']),
      pick(sale, ['telefono', 'Telefono']),
      pick(sale, ['ci', 'CI']),
      pick(sale, ['cantidad', 'Cantidad']),
      pick(sale, ['total', 'Total Gs.']),
      pick(sale, ['comision', 'Comision Gs.'])
    ]);
  }

  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ventas-mino-goup.csv';
  link.click();
  URL.revokeObjectURL(url);
}

$$('.step').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));

$('#sellerName').addEventListener('input', (event) => {
  if ($('#sellerCode').dataset.touched === '1') return;
  $('#sellerCode').value = cleanCode(event.target.value);
});

$('#sellerCode').addEventListener('input', (event) => {
  event.target.dataset.touched = '1';
  event.target.value = cleanCode(event.target.value);
});

$('#sellerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/sellers', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#sellerName').value.trim(),
        code: cleanCode($('#sellerCode').value),
        commission: Number($('#sellerCommission').value) || CONFIG.defaultCommission
      })
    });
    event.target.reset();
    $('#sellerCommission').value = CONFIG.defaultCommission;
    $('#sellerCode').dataset.touched = '0';
    await loadData();
    toast('Vendedor guardado');
  } catch (error) {
    toast(error.message);
  }
});

document.addEventListener('click', async (event) => {
  const sellerId = event.target.dataset.copy || event.target.dataset.share || event.target.dataset.remove;
  if (!sellerId) return;

  const seller = sellers.find((item) => item.id === sellerId);
  if (!seller) return;

  if (event.target.dataset.copy) copyText(sellerLink(seller), 'Link copiado');
  if (event.target.dataset.share) window.open(sellerLink(seller), '_blank', 'noopener');
  if (event.target.dataset.remove) {
    await api(`/api/sellers/${encodeURIComponent(seller.id)}`, { method: 'DELETE' });
    await loadData();
    toast('Vendedor quitado');
  }
});

$('#copyCampaign').addEventListener('click', () => {
  copyText(
    `Toyota Vitz 2013 en sorteo con ${CONFIG.brand}\n\n` +
      `Boleta: ${money(CONFIG.ticketPrice)}\n` +
      `Compra por WhatsApp: https://wa.me/${CONFIG.botPhone}\n\n` +
      `Participan solo mayores de 18 anos.`,
    'Texto copiado'
  );
});

$('#exportCsv').addEventListener('click', exportCsv);

let installPrompt;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  $('#installButton').hidden = false;
});

$('#installButton').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('#installButton').hidden = true;
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/pwa/sw.js');
}

loadData().catch((error) => toast(error.message));
setInterval(() => loadData().catch(() => {}), 15000);
