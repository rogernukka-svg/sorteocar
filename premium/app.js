const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
let token = localStorage.getItem('minoPremiumToken') || '';
let currentUser = null;
let dashboard = { sales: [], sellers: [], scans: [] };
let stream = null;
let scanning = false;

function money(value) {
  return `${new Intl.NumberFormat('es-PY').format(Number(value) || 0)} Gs.`;
}

function toast(text) {
  $('#toast').textContent = text;
  $('#toast').classList.add('is-visible');
  setTimeout(() => $('#toast').classList.remove('is-visible'), 2200);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error del sistema');
  return data;
}

function setView(viewId) {
  $$('.view').forEach((view) => view.classList.toggle('is-visible', view.id === viewId));
  $$('.tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.view === viewId));
  if (viewId === 'control') loadDashboard();
}

function applyRole() {
  const isAdmin = currentUser?.role === 'admin';
  $$('.admin-only').forEach((el) => (el.hidden = !isAdmin));
  $('#userName').textContent = currentUser.name;
  $('#userRole').textContent = isAdmin ? 'Administrador' : `Vendedor ${currentUser.sellerCode}`;
}

function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  applyRole();
  loadDashboard();
}

function renderDashboard() {
  const total = dashboard.sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const tickets = dashboard.sales.reduce((sum, sale) => sum + Number(sale.cantidad || 0), 0);
  const commission = dashboard.sales.reduce((sum, sale) => sum + Number(sale.comision || 0), 0);
  $('#mTotal').textContent = money(total);
  $('#mTickets').textContent = tickets;
  $('#mCommission').textContent = money(commission);

  $('#saleSeller').innerHTML = dashboard.sellers
    .map((seller) => `<option value="${seller.code}">${seller.name} (${seller.code})</option>`)
    .join('');

  $('#sellerList').innerHTML = dashboard.sellers.length
    ? dashboard.sellers
        .map((seller) => {
          const sales = dashboard.sales.filter((sale) => sale.codigo_vendedor === seller.code);
          const count = sales.reduce((sum, sale) => sum + Number(sale.cantidad || 0), 0);
          const totalSeller = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
          return `<article class="item"><strong>${seller.name}</strong><span class="meta">Codigo ${seller.code} · ${count} boletas · ${money(totalSeller)}</span></article>`;
        })
        .join('')
    : '<article class="item"><strong>Sin vendedores</strong><span class="meta">Crea el primer acceso.</span></article>';

  $('#salesList').innerHTML = dashboard.sales.length
    ? dashboard.sales
        .slice()
        .reverse()
        .map((sale) => {
          const firstPdf = String(sale.boletas || '').split(' | ')[0];
          const pdf = firstPdf ? `/boletas/${firstPdf.split(/[\\/]/).pop()}` : '';
          return `<article class="item"><strong>${sale.nombre}</strong><span class="meta">${sale.vendedor} · ${sale.cantidad} boletas · ${money(sale.total)}</span><span class="meta">CI ${sale.ci} · ${sale.telefono}</span>${pdf ? `<a href="${pdf}" target="_blank">Abrir boleta</a>` : ''}</article>`;
        })
        .join('')
    : '<article class="item"><strong>Sin ventas</strong><span class="meta">Cuando vendas, aparecen aca.</span></article>';
}

async function loadDashboard() {
  dashboard = await api('/api/dashboard');
  renderDashboard();
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('#username').value, password: $('#password').value })
    });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('minoPremiumToken', token);
    showApp();
  } catch (error) {
    toast(error.message);
  }
});

$('#logout').addEventListener('click', () => {
  localStorage.removeItem('minoPremiumToken');
  location.reload();
});

$$('.tab').forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.view)));

$('#sellerName').addEventListener('input', () => {
  const code = $('#sellerName').value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  $('#sellerCode').value = code;
  $('#sellerUser').value = code.toLowerCase();
  $('#sellerPass').value = `${code.toLowerCase()}123`;
});

$('#sellerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/sellers', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#sellerName').value,
        code: $('#sellerCode').value,
        commission: $('#sellerCommission').value,
        username: $('#sellerUser').value,
        password: $('#sellerPass').value
      })
    });
    event.target.reset();
    toast(`Acceso creado: ${data.login.username}`);
    await loadDashboard();
  } catch (error) {
    toast(error.message);
  }
});

$('#saleForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/manual-sale', {
      method: 'POST',
      body: JSON.stringify({
        sellerCode: $('#saleSeller').value,
        customer: $('#customer').value,
        ci: $('#ci').value,
        phone: $('#phone').value,
        quantity: $('#quantity').value
      })
    });
    $('#saleResult').className = 'result ok';
    $('#saleResult').innerHTML = `<strong>Boletas generadas</strong><div class="meta">${data.numbers.join(', ')}</div>${data.pdfs.map((pdf) => `<a href="${pdf}" target="_blank">Abrir ${pdf.split('/').pop()}</a>`).join('<br>')}`;
    event.target.reset();
    $('#quantity').value = 1;
    await loadDashboard();
  } catch (error) {
    toast(error.message);
  }
});

async function verifyQr(qr) {
  try {
    const data = await api('/api/verify-ticket', { method: 'POST', body: JSON.stringify({ qr }) });
    $('#qrResult').className = `result ${data.scan.ok && !data.scan.duplicate ? 'ok' : 'bad'}`;
    $('#qrResult').innerHTML = `<strong>${data.scan.ok ? 'Boleta valida' : 'Boleta no encontrada'}</strong><div class="meta">Numero ${data.scan.number || 'sin numero'} · ${data.scan.seller || 'sin vendedor'}</div><div class="meta">${data.scan.duplicate ? 'ATENCION: este QR ya fue escaneado antes.' : 'Primer escaneo registrado.'}</div>`;
  } catch (error) {
    toast(error.message);
  }
}

$('#verifyManual').addEventListener('click', () => verifyQr($('#qrManual').value));

$('#startScanner').addEventListener('click', async () => {
  if (!('BarcodeDetector' in window)) {
    toast('Este navegador no tiene lector QR automatico. Usa el campo manual.');
    return;
  }
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  $('#qrVideo').srcObject = stream;
  await $('#qrVideo').play();
  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  scanning = true;
  const loop = async () => {
    if (!scanning) return;
    const codes = await detector.detect($('#qrVideo')).catch(() => []);
    if (codes[0]?.rawValue) {
      scanning = false;
      verifyQr(codes[0].rawValue);
      return;
    }
    requestAnimationFrame(loop);
  };
  loop();
});

$('#stopScanner').addEventListener('click', () => {
  scanning = false;
  if (stream) stream.getTracks().forEach((track) => track.stop());
});

if (token) {
  api('/api/me')
    .then((data) => {
      currentUser = data.user;
      showApp();
    })
    .catch(() => localStorage.removeItem('minoPremiumToken'));
}
