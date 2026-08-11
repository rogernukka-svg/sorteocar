const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const root = path.join(__dirname, '..');
const port = Number(process.env.PORT || process.env.ONLINE_PORT || 3000);
const secret = process.env.APP_SECRET || 'cambia-este-secreto-mino-goup';

const CONFIG = {
  telefonoBot: '595994124451',
  titular: 'Miño Goup',
  sorteo: 'Toyota Vitz 2013 rojo candy metalico',
  precio: 1000,
  alias: '0994124451',
  logo: path.join(root, 'assets', 'logo.png'),
  marketing: path.join(root, 'assets', 'mino.png')
};

const paths = {
  users: path.join(root, 'usuarios.json'),
  sellers: path.join(root, 'vendedores.json'),
  sales: path.join(root, 'ventas.csv'),
  leads: path.join(root, 'leads.csv'),
  scans: path.join(root, 'qr-scans.json'),
  tickets: path.join(root, 'boletas'),
  receipts: path.join(root, 'comprobantes')
};

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf'
};

for (const dir of [paths.tickets, paths.receipts]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) reject(new Error('Contenido muy grande'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function csv(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function parseCsvLine(line) {
  const cols = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      cols.push(cur);
      cur = '';
      continue;
    }
    cur += char;
  }
  cols.push(cur);
  return cols;
}

function ensureFiles() {
  if (!fs.existsSync(paths.users)) {
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    writeJson(paths.users, {
      users: [
        {
          id: crypto.randomUUID(),
          name: 'Administrador',
          username: adminUser,
          role: 'admin',
          passwordHash: sha(adminPassword),
          sellerCode: ''
        }
      ]
    });
  }

  if (!fs.existsSync(paths.sellers)) writeJson(paths.sellers, { sellers: [] });
  if (!fs.existsSync(paths.scans)) writeJson(paths.scans, { scans: [] });

  if (!fs.existsSync(paths.sales)) {
    fs.writeFileSync(
      paths.sales,
      'fecha,vendedor,codigo_vendedor,telefono,nombre,ci,numeros,cantidad,total,comision,monto_pagado,comprobante,boletas\n',
      'utf8'
    );
  }

  const sellers = readJson(paths.sellers, { sellers: [] }).sellers || [];
  const usersData = readJson(paths.users, { users: [] });
  let changed = false;
  for (const seller of sellers) {
    const code = normalizeCode(seller.code);
    if (!code) continue;
    const exists = usersData.users.some(
      (user) => user.role === 'seller' && normalizeCode(user.sellerCode) === code
    );
    if (!exists) {
      usersData.users.push({
        id: crypto.randomUUID(),
        name: seller.name,
        username: code.toLowerCase(),
        role: 'seller',
        passwordHash: sha(`${code.toLowerCase()}123`),
        sellerCode: code
      });
      changed = true;
    }
  }
  if (changed) writeJson(paths.users, usersData);
}

ensureFiles();

function normalizeCode(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 18);
}

function money(value) {
  return `${new Intl.NumberFormat('es-PY').format(Number(value) || 0)} Gs.`;
}

function sign(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (payload.exp < Date.now()) return null;
  return payload;
}

function getAuth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) return null;
  return readJson(paths.users, { users: [] }).users.find((user) => user.id === payload.id) || null;
}

function requireAuth(req, res, role = null) {
  const user = getAuth(req);
  if (!user) {
    json(res, 401, { error: 'Inicia sesion de nuevo' });
    return null;
  }
  if (role && user.role !== role) {
    json(res, 403, { error: 'No tenes permiso para esta accion' });
    return null;
  }
  return user;
}

function readSellers() {
  return readJson(paths.sellers, { sellers: [] }).sellers || [];
}

function writeSellers(sellers) {
  writeJson(paths.sellers, { sellers });
}

function readSales() {
  const lines = fs.readFileSync(paths.sales, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((header, i) => {
      row[header] = cols[i] || '';
    });
    return row;
  });
}

function appendSale(row) {
  const line = [
    row.fecha,
    row.vendedor,
    row.codigo_vendedor,
    row.telefono,
    row.nombre,
    row.ci,
    row.numeros,
    row.cantidad,
    row.total,
    row.comision,
    row.monto_pagado,
    row.comprobante,
    row.boletas
  ]
    .map(csv)
    .join(',');
  fs.appendFileSync(paths.sales, `${line}\n`, 'utf8');
}

function soldNumbers() {
  const set = new Set();
  for (const sale of readSales()) {
    const numbers = String(sale.numeros || '').match(/\b\d{5}\b/g) || [];
    numbers.forEach((number) => set.add(number));
  }
  return set;
}

function generateNumber(used) {
  for (let i = 0; i < 100000; i++) {
    const number = Math.floor(10000 + Math.random() * 90000).toString();
    if (!used.has(number)) {
      used.add(number);
      return number;
    }
  }
  throw new Error('No quedan numeros disponibles');
}

function filterByRole(user, rows) {
  if (user.role === 'admin') return rows;
  const code = normalizeCode(user.sellerCode);
  return rows.filter((row) => normalizeCode(row.codigo_vendedor) === code);
}

async function generateTicketPdf({ number, customer, ci, phone, sellerName, sellerCode }) {
  const outPath = path.join(paths.tickets, `boleta-${number}.pdf`);
  const tel = String(phone || '').replace(/[^\d+]/g, '');
  const qrData = `MINO-GOUP|NRO:${number}|CI:${ci}|TEL:${tel}|VENDEDOR:${sellerCode}`;
  const qr = await QRCode.toBuffer(qrData, { width: 260, margin: 1 });

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [420, 640], margin: 0 });
    const stream = fs.createWriteStream(outPath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.pipe(stream);

    const W = doc.page.width;
    const black = '#080808';
    const gold = '#d8a72d';
    const paper = '#fbfaf6';
    doc.rect(0, 0, W, 640).fill(paper);
    doc.rect(0, 0, W, 128).fill(black);
    doc.rect(0, 120, W, 8).fill(gold);

    if (fs.existsSync(CONFIG.logo)) {
      doc.image(CONFIG.logo, (W - 126) / 2, 14, { fit: [126, 70] });
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(gold)
      .text('BOLETA OFICIAL', 0, 84, { width: W, align: 'center' })
      .fontSize(8)
      .fillColor('#f7df8c')
      .text('MIÑO GOUP - SORTEO EXCLUSIVO', 0, 106, { width: W, align: 'center' });

    doc.roundedRect(26, 150, W - 52, 98, 10).fillAndStroke('#ffffff', '#ead9a2');
    doc.font('Helvetica-Bold').fontSize(9).fillColor(gold).text('LA JOYA DEL SORTEO', 0, 164, { width: W, align: 'center' });
    doc.fontSize(13).fillColor('#111').text('TOYOTA VITZ 2013 ROJO CANDY', 46, 184, { width: W - 92, align: 'center' });
    doc.fontSize(8).fillColor('#777').text('Edicion unica - Participacion registrada', 46, 205, { width: W - 92, align: 'center' });
    doc.roundedRect(112, 220, 196, 44, 22).fillAndStroke(black, gold);
    doc.fontSize(8).fillColor('#f7df8c').text('NUMERO DE LA SUERTE', 0, 228, { width: W, align: 'center' });
    doc.fontSize(24).fillColor('#fff').text(`#${number}`, 0, 239, { width: W, align: 'center' });

    const label = (text, x, y) => doc.font('Helvetica-Bold').fontSize(7).fillColor('#777').text(text, x, y);
    const value = (text, x, y, width, size = 10) =>
      doc.font('Helvetica-Bold').fontSize(size).fillColor('#111').text(String(text || '').toUpperCase(), x, y, { width, lineGap: 2 });
    const rule = (y) => doc.moveTo(44, y).lineTo(218, y).strokeColor('#e6d5a7').lineWidth(1).stroke();

    doc.roundedRect(26, 290, 214, 182, 8).fillAndStroke('#fff', '#ece2c3');
    label('CLIENTE', 44, 308);
    value(customer, 44, 322, 176);
    rule(350);
    label('CEDULA', 44, 364);
    value(ci, 44, 378, 78, 10);
    label('TELEFONO', 138, 364);
    value(tel, 138, 378, 84, 9);
    rule(406);
    label('VENDEDOR', 44, 420);
    value(sellerName, 44, 434, 176, 9);
    rule(458);

    doc.roundedRect(258, 290, 136, 174, 8).fillAndStroke('#fff', '#ece2c3');
    doc.image(qr, 278, 310, { width: 96 });
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#777').text('ESCANEAR PARA VERIFICAR', 268, 416, { width: 116, align: 'center' });
    doc.font('Helvetica').fontSize(7).fillColor('#777').text('Codigo unico de participacion', 270, 438, { width: 112, align: 'center' });

    doc.roundedRect(26, 500, W - 52, 70, 8).fillAndStroke(black, gold);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(gold).text('IMPORTANTE', 44, 516, { width: W - 88, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor('#fff').text('Conserva esta boleta. El QR confirma si esta boleta es valida y si ya fue escaneada.', 48, 536, { width: W - 96, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#111').text('Participan solo mayores de 18 anos.', 0, 598, { width: W, align: 'center' });
    doc.end();
  });

  return outPath;
}

function parseTicketQr(qr) {
  const text = String(qr || '');
  const number = text.match(/NRO:([0-9]{5})/i)?.[1] || text.match(/\b([0-9]{5})\b/)?.[1] || '';
  const ci = text.match(/CI:([^|]+)/i)?.[1] || '';
  const seller = text.match(/VENDEDOR:([^|]+)/i)?.[1] || '';
  return { text, number, ci, seller };
}

function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const target = clean === '/' ? '/premium/index.html' : clean;
  const filePath = path.normalize(path.join(root, target));
  return filePath.startsWith(root) ? filePath : null;
}

async function route(req, res) {
  try {
    if (req.url === '/api/login' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      const users = readJson(paths.users, { users: [] }).users;
      const user = users.find((item) => item.username.toLowerCase() === String(body.username || '').toLowerCase());
      if (!user || user.passwordHash !== sha(body.password || '')) {
        json(res, 401, { error: 'Usuario o contraseña incorrectos' });
        return;
      }
      const token = sign({ id: user.id, exp: Date.now() + 1000 * 60 * 60 * 12 });
      json(res, 200, { token, user: { id: user.id, name: user.name, role: user.role, sellerCode: user.sellerCode } });
      return;
    }

    if (req.url === '/api/me' && req.method === 'GET') {
      const user = requireAuth(req, res);
      if (!user) return;
      json(res, 200, { user: { id: user.id, name: user.name, role: user.role, sellerCode: user.sellerCode } });
      return;
    }

    if (req.url === '/api/dashboard' && req.method === 'GET') {
      const user = requireAuth(req, res);
      if (!user) return;
      const sales = filterByRole(user, readSales());
      const sellers = user.role === 'admin' ? readSellers() : readSellers().filter((seller) => normalizeCode(seller.code) === normalizeCode(user.sellerCode));
      const scans = readJson(paths.scans, { scans: [] }).scans || [];
      json(res, 200, { sales, sellers, scans: user.role === 'admin' ? scans.slice(-80) : [] });
      return;
    }

    if (req.url === '/api/sellers' && req.method === 'POST') {
      const user = requireAuth(req, res, 'admin');
      if (!user) return;
      const body = JSON.parse(await readBody(req) || '{}');
      const code = normalizeCode(body.code || body.name);
      const name = String(body.name || '').trim();
      const username = String(body.username || code.toLowerCase()).trim().toLowerCase();
      const password = String(body.password || `${code.toLowerCase()}123`);
      const commission = Math.max(0, Number(body.commission || 0));
      if (!name || !code || !username) {
        json(res, 400, { error: 'Completa vendedor, codigo y usuario' });
        return;
      }

      const sellers = readSellers();
      if (sellers.some((seller) => normalizeCode(seller.code) === code)) {
        json(res, 409, { error: 'Ese codigo ya existe' });
        return;
      }

      const usersData = readJson(paths.users, { users: [] });
      if (usersData.users.some((item) => item.username.toLowerCase() === username)) {
        json(res, 409, { error: 'Ese usuario ya existe' });
        return;
      }

      const seller = { id: crypto.randomUUID(), name, code, commission, createdAt: new Date().toISOString() };
      sellers.push(seller);
      usersData.users.push({ id: crypto.randomUUID(), name, username, role: 'seller', passwordHash: sha(password), sellerCode: code });
      writeSellers(sellers);
      writeJson(paths.users, usersData);
      json(res, 201, { seller, login: { username, password } });
      return;
    }

    if (req.url === '/api/manual-sale' && req.method === 'POST') {
      const user = requireAuth(req, res);
      if (!user) return;
      const body = JSON.parse(await readBody(req) || '{}');
      const sellers = readSellers();
      const sellerCode = user.role === 'admin' ? normalizeCode(body.sellerCode) : normalizeCode(user.sellerCode);
      const seller = sellers.find((item) => normalizeCode(item.code) === sellerCode);
      if (!seller) {
        json(res, 400, { error: 'Vendedor no encontrado' });
        return;
      }
      const customer = String(body.customer || '').trim();
      const ci = String(body.ci || '').replace(/\D/g, '');
      const phone = String(body.phone || '').trim();
      const quantity = Math.min(100, Math.max(1, Number(body.quantity || 1)));
      if (!customer || ci.length < 5) {
        json(res, 400, { error: 'Carga nombre del cliente y CI valido' });
        return;
      }

      const used = soldNumbers();
      const numbers = Array.from({ length: quantity }, () => generateNumber(used));
      const pdfs = [];
      for (const number of numbers) {
        pdfs.push(await generateTicketPdf({ number, customer, ci, phone, sellerName: seller.name, sellerCode: seller.code }));
      }

      const total = CONFIG.precio * quantity;
      appendSale({
        fecha: new Date().toLocaleString('es-PY'),
        vendedor: seller.name,
        codigo_vendedor: seller.code,
        telefono: phone,
        nombre: customer,
        ci,
        numeros: numbers.join(' '),
        cantidad: quantity,
        total,
        comision: Number(seller.commission || 0) * quantity,
        monto_pagado: total,
        comprobante: 'Venta cargada en sistema',
        boletas: pdfs.join(' | ')
      });

      json(res, 201, { numbers, pdfs: pdfs.map((file) => `/boletas/${path.basename(file)}`) });
      return;
    }

    if (req.url === '/api/verify-ticket' && req.method === 'POST') {
      const user = requireAuth(req, res, 'admin');
      if (!user) return;
      const body = JSON.parse(await readBody(req) || '{}');
      const parsed = parseTicketQr(body.qr);
      const sale = readSales().find((row) => String(row.numeros || '').split(/\s+/).includes(parsed.number));
      const scansData = readJson(paths.scans, { scans: [] });
      const previous = scansData.scans.filter((scan) => scan.number === parsed.number);
      const scan = {
        id: crypto.randomUUID(),
        number: parsed.number,
        seller: sale?.vendedor || parsed.seller || '',
        ci: sale?.ci || parsed.ci || '',
        ok: Boolean(sale),
        duplicate: previous.length > 0,
        date: new Date().toISOString(),
        by: user.name
      };
      scansData.scans.push(scan);
      writeJson(paths.scans, scansData);
      json(res, 200, { scan, sale: sale || null, previous });
      return;
    }

    if (req.url === '/vendor/jsqr.js' && req.method === 'GET') {
      const filePath = path.join(root, 'node_modules', 'jsqr', 'dist', 'jsQR.js');
      fs.readFile(filePath, (error, data) => {
        if (error) {
          send(res, 404, 'No encontrado');
          return;
        }
        send(res, 200, data, 'application/javascript; charset=utf-8');
      });
      return;
    }

    const filePath = safePath(req.url);
    if (!filePath) {
      send(res, 403, 'No permitido');
      return;
    }
    const finalPath = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory() ? path.join(filePath, 'index.html') : filePath;
    fs.readFile(finalPath, (error, data) => {
      if (error) {
        send(res, 404, 'No encontrado');
        return;
      }
      send(res, 200, data, mime[path.extname(finalPath).toLowerCase()] || 'application/octet-stream');
    });
  } catch (error) {
    json(res, 500, { error: error.message });
  }
}

const server = http.createServer(route);

server.listen(port, () => {
  console.log(`Sistema premium listo en http://localhost:${port}/premium/`);
  console.log(`Usuario admin inicial: ${process.env.ADMIN_USER || 'admin'} / ${process.env.ADMIN_PASSWORD || 'admin123'}`);
});
