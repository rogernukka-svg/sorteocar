const {
  default: makeWASocket,
  downloadMediaMessage,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const P = require('pino');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { recognize } = require('tesseract.js');
const ExcelJS = require('exceljs');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const CONFIG = {
  telefonoBot: '595994124451',
  sorteo: 'Toyota Vitz 2013 rojo candy metalico - Edicion unica',
  precio: 1000,
  aliasRuc: '0994124451',
  titular: 'Mi\u00f1o Goup',
  tiempoPagoMin: 10,
  logoBoleta: path.join(__dirname, 'assets', 'logo.png'),
  imagenesMarketing: [
    path.join(__dirname, 'assets', 'mino.png'),
    path.join(__dirname, 'assets', 'vitz.jpg'),
    path.join(__dirname, 'assets', 'vitz.jpeg'),
    path.join(__dirname, 'assets', 'vitz.png'),
    path.join(__dirname, 'assets', 'vitz.webp')
  ]
};

const GMAIL_CONFIG = {
  user: process.env.GMAIL_USER || '',
  pass: process.env.GMAIL_APP_PASSWORD || '',
  mailboxes: (process.env.GMAIL_MAILBOXES || 'INBOX')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
  lookbackMinutes: Number.parseInt(process.env.GMAIL_LOOKBACK_MINUTES || '90', 10)
};

const clientes = new Map();
const numerosVendidos = new Set();
const boletasDir = path.join(__dirname, 'boletas');
const comprobantesDir = path.join(__dirname, 'comprobantes');
const ventasCsvPath = path.join(__dirname, 'ventas.csv');
const leadsCsvPath = path.join(__dirname, 'leads.csv');
const ventasXlsxPath = path.join(__dirname, 'ventas.xlsx');
const comprobantesUsadosPath = path.join(__dirname, 'comprobantes-usados.json');
const vendedoresPath = path.join(__dirname, 'vendedores.json');
const APP_SECRET = process.env.APP_SECRET || 'cambia-este-secreto-mino-goup';
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const tieneSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

for (const dir of [boletasDir, comprobantesDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

if (!fs.existsSync(ventasCsvPath)) {
  fs.writeFileSync(
    ventasCsvPath,
    'fecha,telefono,nombre,ci,numeros,cantidad,total,monto_pagado,comprobante,boletas\n',
    'utf8'
  );
}

if (!fs.existsSync(comprobantesUsadosPath)) {
  fs.writeFileSync(
    comprobantesUsadosPath,
    JSON.stringify({ hashes: [], comprobantes: [], textos: [], gmail: [] }, null, 2),
    'utf8'
  );
}

if (!fs.existsSync(vendedoresPath)) {
  fs.writeFileSync(vendedoresPath, JSON.stringify({ sellers: [] }, null, 2), 'utf8');
}

if (!fs.existsSync(leadsCsvPath)) {
  fs.writeFileSync(
    leadsCsvPath,
    'fecha,vendedor,codigo_vendedor,telefono,mensaje,estado\n',
    'utf8'
  );
}

function parseCsvLine(linea) {
  const columnas = [];
  let actual = '';
  let entreComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const char = linea[i];
    const siguiente = linea[i + 1];

    if (char === '"' && entreComillas && siguiente === '"') {
      actual += '"';
      i++;
      continue;
    }

    if (char === '"') {
      entreComillas = !entreComillas;
      continue;
    }

    if (char === ',' && !entreComillas) {
      columnas.push(actual);
      actual = '';
      continue;
    }

    actual += char;
  }

  columnas.push(actual);
  return columnas;
}

function asegurarEncabezadoVentasCsv() {
  if (!fs.existsSync(ventasCsvPath)) return;

  const contenido = fs.readFileSync(ventasCsvPath, 'utf8');
  const lineas = contenido.split(/\r?\n/);
  const header = parseCsvLine(lineas[0] || '').map((item) => item.trim().toLowerCase());

  if (header.includes('vendedor') && header.includes('codigo_vendedor')) return;

  const nuevoHeader =
    'fecha,vendedor,codigo_vendedor,telefono,nombre,ci,numeros,cantidad,total,comision,monto_pagado,comprobante,boletas';
  const nuevasLineas = [nuevoHeader];

  for (const linea of lineas.slice(1).filter(Boolean)) {
    const columnas = parseCsvLine(linea);
    const migrada = [
      columnas[0] || '',
      'Venta directa',
      'DIRECTO',
      columnas[1] || '',
      columnas[2] || '',
      columnas[3] || '',
      columnas[4] || '',
      columnas[5] || '',
      columnas[6] || '',
      '0',
      columnas[7] || '',
      columnas[8] || '',
      columnas[9] || ''
    ];
    nuevasLineas.push(migrada.map(csv).join(','));
  }

  fs.writeFileSync(ventasCsvPath, nuevasLineas.join('\n') + '\n', 'utf8');
}

function cargarNumerosVendidosDesdeCsv() {
  if (!fs.existsSync(ventasCsvPath)) return;

  const lineas = fs
    .readFileSync(ventasCsvPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean);

  if (lineas.length < 2) return;

  const headers = parseCsvLine(lineas[0]).map((header) => header.trim().toLowerCase());
  const numerosIndex = headers.indexOf('numeros');
  if (numerosIndex === -1) return;

  for (const linea of lineas.slice(1)) {
    const columnas = parseCsvLine(linea);
    const numeros = String(columnas[numerosIndex] || '').match(/\b\d{5}\b/g) || [];
    for (const numero of numeros) {
      numerosVendidos.add(numero);
    }
  }

  console.log(`Numeros vendidos cargados: ${numerosVendidos.size}`);
}

async function cargarNumerosVendidosDesdeSupabase() {
  if (!tieneSupabase) return;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/sales?select=numeros`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    });
    if (!response.ok) throw new Error(await response.text());
    const rows = await response.json();
    for (const row of rows) {
      const numeros = String(row.numeros || '').match(/\b\d{5}\b/g) || [];
      numeros.forEach((numero) => numerosVendidos.add(numero));
    }
    console.log(`Numeros vendidos sincronizados con Supabase: ${numerosVendidos.size}`);
  } catch (error) {
    console.error('No se pudieron cargar numeros desde Supabase:', error.message);
  }
}

function guaranies(valor) {
  return new Intl.NumberFormat('es-PY').format(valor) + ' Gs.';
}

function telefonoVisible(telefono) {
  const limpio = String(telefono || '').replace(/\D/g, '');
  return limpio ? `+${limpio}` : '';
}

function normalizarCodigo(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 18);
}

function firmaBoleta({ nro, ci, codigoVendedor }) {
  return crypto
    .createHmac('sha256', APP_SECRET)
    .update(`${nro}|${ci}|${normalizarCodigo(codigoVendedor || 'DIRECTO')}`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
}

function cargarVendedores() {
  try {
    const data = JSON.parse(fs.readFileSync(vendedoresPath, 'utf8'));
    return Array.isArray(data.sellers) ? data.sellers : [];
  } catch (error) {
    console.error('No se pudo leer vendedores.json:', error.message);
    return [];
  }
}

function buscarVendedorPorCodigo(codigo) {
  const limpio = normalizarCodigo(codigo);
  if (!limpio) return null;
  const vendedores = cargarVendedores();
  return (
    vendedores.find((seller) => normalizarCodigo(seller.code) === limpio) ||
    vendedores.find((seller) => {
      const code = normalizarCodigo(seller.code);
      return code && (limpio.startsWith(code) || code.startsWith(limpio));
    }) ||
    null
  );
}

function detectarVendedor(texto) {
  const contenido = String(texto || '');
  const patrones = [
    /vendedor\s*:\s*([a-zA-Z0-9_-]+)/i,
    /codigo\s*:\s*([a-zA-Z0-9_-]+)/i,
    /cod\s*:\s*([a-zA-Z0-9_-]+)/i
  ];

  for (const patron of patrones) {
    const match = contenido.match(patron);
    if (match) {
      const vendedor = buscarVendedorPorCodigo(match[1]);
      if (vendedor) return vendedor;
    }
  }

  const vendedores = cargarVendedores();
  return (
    vendedores.find((seller) => {
      const code = normalizarCodigo(seller.code);
      return code && new RegExp(`\\b${code}\\b`, 'i').test(contenido);
    }) || null
  );
}

function vendedorVenta(cliente) {
  return cliente?.vendedor?.name || 'Venta directa';
}

function codigoVendedorVenta(cliente) {
  return cliente?.vendedor?.code || 'DIRECTO';
}

function comisionVenta(cliente) {
  const comision = Number(cliente?.vendedor?.commission || 0);
  return Math.max(0, comision) * Number(cliente?.cantidad || 0);
}

async function registrarLead(jid, vendedor, mensaje, estado = 'INICIO') {
  if (!vendedor) return;
  const fecha = new Date().toLocaleString('es-PY');
  const row = {
    id: crypto.randomUUID(),
    fecha,
    vendedor: vendedor.name || '',
    codigo_vendedor: vendedor.code || '',
    telefono: telefonoVisible(jid.split('@')[0]),
    mensaje: String(mensaje || '').slice(0, 240),
    estado
  };
  const linea = [
    row.fecha,
    row.vendedor,
    row.codigo_vendedor,
    row.telefono,
    row.mensaje,
    row.estado
  ]
    .map(csv)
    .join(',');
  fs.appendFileSync(leadsCsvPath, linea + '\n', 'utf8');
  try {
    await supabaseInsert('leads', row);
  } catch (error) {
    console.error('No se pudo guardar lead en Supabase:', error.message);
  }
}

function generarNumero() {
  let numero;
  let intentos = 0;
  do {
    if (intentos++ > 100000) {
      throw new Error('No quedan numeros disponibles para vender.');
    }
    numero = Math.floor(10000 + Math.random() * 90000).toString();
  } while (numerosVendidos.has(numero));
  numerosVendidos.add(numero);
  return numero;
}

function textoMensaje(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    ''
  ).trim();
}

function esChatPrivado(jid = '') {
  return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid');
}

function fechaArchivo() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function csv(valor) {
  const texto = String(valor ?? '');
  return `"${texto.replace(/"/g, '""')}"`;
}

async function supabaseInsert(table, row) {
  if (!tieneSupabase) return;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify([row])
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Supabase ${response.status}`);
  }
}

function totalEsperado(cliente) {
  return CONFIG.precio * cliente.cantidad;
}

function leerMonto(texto) {
  const montos = extraerMontos(texto);
  return montos[0] || null;
}

function textoTieneMonto(texto, montoEsperado) {
  const esperado = String(montoEsperado);
  const conPuntos = new Intl.NumberFormat('es-PY').format(montoEsperado);
  const contenido = String(texto || '').replace(/\s+/g, ' ');
  const digitos = contenido.replace(/\D/g, '');

  return (
    contenido.includes(conPuntos) ||
    contenido.includes(conPuntos.replace(/\./g, ',')) ||
    digitos.includes(esperado)
  );
}

function extraerMontos(texto) {
  const contenido = String(texto || '')
    .replace(/\s+/g, ' ')
    .replace(/[OQ]/g, '0')
    .replace(/[lI]/g, '1');
  const montos = [];
  const patrones = [
    /(?:Gs\.?|G\.?|Cs\.?|C\.?|PYG|₲|¢)\s*([0-9]{1,3}(?:[.,]\s?[0-9]{3})+|[0-9]{4,7})/gi,
    /([0-9]{1,3}(?:[.,]\s?[0-9]{3})+|[0-9]{4,7})\s*(?:Gs\.?|G\.?|Cs\.?|C\.?|PYG|₲|¢)/gi,
    /(?:envio|enviado|transferencia|importe|monto|total|valor|pago)\D{0,30}([0-9]{1,3}(?:[.,]\s?[0-9]{3})+|[0-9]{4,7})/gi,
    /([0-9]{1,3}(?:[.,]\s?[0-9]{3})+)/g
  ];

  for (const patron of patrones) {
    for (const match of contenido.matchAll(patron)) {
      const monto = normalizarMonto(match[1]);
      if (monto && monto >= CONFIG.precio && monto <= 1000000 && !montos.includes(monto)) {
        montos.push(monto);
      }
    }
  }

  return montos;
}

function extraerIdComprobante(texto) {
  const contenido = String(texto || '').replace(/\s+/g, ' ');
  const patrones = [
    /(?:nro\.?|n[°º]\.?|numero)\s*(?:de\s*)?(?:comprobante|operacion|operación|transaccion|transacción)\D{0,25}([0-9]{6,})/i,
    /(?:comprobante|operacion|operación|transaccion|transacción)\D{0,25}([0-9]{6,})/i
  ];

  for (const patron of patrones) {
    const match = contenido.match(patron);
    if (match?.[1]) return match[1];
  }

  return null;
}

function normalizarTexto(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n');
}

function huellaTextoComprobante(texto) {
  const normalizado = String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const tokens = normalizado
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !['para', 'por', 'del', 'las', 'los', 'una', 'con'].includes(token));

  return [...new Set(tokens)].sort();
}

function similitudTexto(a, b) {
  const setA = new Set(a || []);
  const setB = new Set(b || []);
  if (setA.size < 6 || setB.size < 6) return 0;

  let interseccion = 0;
  for (const token of setA) {
    if (setB.has(token)) interseccion++;
  }

  return interseccion / Math.min(setA.size, setB.size);
}

async function leerMontoComprobante(filePath) {
  const baseOptions = {
    tessedit_pageseg_mode: '6',
    preserve_interword_spaces: '1'
  };
  const result = await recognize(filePath, 'eng', baseOptions);
  let texto = result?.data?.text || '';

  if (!leerMonto(texto)) {
    const retry = await recognize(filePath, 'eng', {
      ...baseOptions,
      tessedit_char_whitelist:
        '0123456789.,:GsPYgspyMontoTotalImporteEnvioEnviadoTransferenciaComprobanteNroOperacion '
    });
    texto += '\n' + (retry?.data?.text || '');
  }

  fs.writeFileSync(filePath + '.ocr.txt', texto, 'utf8');
  return {
    texto,
    monto: leerMonto(texto),
    comprobanteId: extraerIdComprobante(texto),
    textoHuella: huellaTextoComprobante(texto)
  };
}

function cargarComprobantesUsados() {
  try {
    const data = JSON.parse(fs.readFileSync(comprobantesUsadosPath, 'utf8'));
    return {
      hashes: Array.isArray(data.hashes) ? data.hashes : [],
      comprobantes: Array.isArray(data.comprobantes) ? data.comprobantes : [],
      textos: Array.isArray(data.textos) ? data.textos : [],
      gmail: Array.isArray(data.gmail) ? data.gmail : []
    };
  } catch {
    return { hashes: [], comprobantes: [], textos: [], gmail: [] };
  }
}

function guardarComprobantesUsados(data) {
  fs.writeFileSync(comprobantesUsadosPath, JSON.stringify(data, null, 2), 'utf8');
}

function hashArchivo(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function comprobanteYaUsado({ hash, comprobanteId, textoHuella }) {
  const usados = cargarComprobantesUsados();
  return (
    (hash && usados.hashes.includes(hash)) ||
    (comprobanteId && usados.comprobantes.includes(comprobanteId)) ||
    (textoHuella && usados.textos.some((textoGuardado) => similitudTexto(textoHuella, textoGuardado) >= 0.72))
  );
}

function marcarComprobanteUsado({ hash, comprobanteId, textoHuella }) {
  const usados = cargarComprobantesUsados();
  if (hash && !usados.hashes.includes(hash)) usados.hashes.push(hash);
  if (comprobanteId && !usados.comprobantes.includes(comprobanteId)) {
    usados.comprobantes.push(comprobanteId);
  }
  if (textoHuella?.length >= 6 && !comprobanteYaUsado({ textoHuella })) {
    usados.textos.push(textoHuella);
  }
  guardarComprobantesUsados(usados);
}

function gmailPagoYaUsado(gmailId) {
  if (!gmailId) return false;
  return cargarComprobantesUsados().gmail.includes(gmailId);
}

function marcarGmailPagoUsado(gmailId) {
  if (!gmailId) return;
  const usados = cargarComprobantesUsados();
  if (!usados.gmail.includes(gmailId)) usados.gmail.push(gmailId);
  guardarComprobantesUsados(usados);
}

function gmailConfigurado() {
  return Boolean(GMAIL_CONFIG.user && GMAIL_CONFIG.pass);
}

function htmlATexto(html = '') {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extraerIdTransaccion(texto) {
  const contenido = String(texto || '').replace(/\s+/g, ' ');
  const patrones = [
    /(?:nro\.?|n[°º]\.?|numero)\s*(?:de\s*)?(?:transacci[oó]n|comprobante|operaci[oó]n)\D{0,35}([A-Z0-9-]{5,})/i,
    /(?:transacci[oó]n|comprobante|operaci[oó]n)\D{0,35}([A-Z0-9-]{5,})/i
  ];

  for (const patron of patrones) {
    const match = contenido.match(patron);
    if (match?.[1]) return match[1].replace(/[^A-Z0-9-]/gi, '');
  }

  return null;
}

function emailPareceBanco({ from, subject, texto }) {
  const contenido = normalizarTexto(`${from} ${subject} ${texto}`);
  return (
    contenido.includes('ueno') ||
    contenido.includes('banco') ||
    contenido.includes('transferencia') ||
    contenido.includes('monto gs') ||
    contenido.includes('titular cuenta debito')
  );
}

async function buscarPagoEnMailbox(client, mailbox, { esperado, desde, comprobanteId }) {
  const lock = await client.getMailboxLock(mailbox);
  try {
    const total = client.mailbox.exists || 0;
    if (!total) return null;

    const inicio = Math.max(1, total - 120);
    const rango = `${inicio}:*`;

    for await (const message of client.fetch(rango, {
      uid: true,
      envelope: true,
      source: true
    })) {
      const fecha = message.envelope?.date ? new Date(message.envelope.date) : null;
      if (fecha && fecha < desde) continue;

      const parsed = await simpleParser(message.source);
      const from = parsed.from?.text || '';
      const subject = parsed.subject || '';
      const texto = `${parsed.text || ''}\n${htmlATexto(parsed.html || '')}`;

      if (!emailPareceBanco({ from, subject, texto })) continue;

      const monto = leerMonto(texto) || (textoTieneMonto(texto, esperado) ? esperado : null);
      if (monto !== esperado) continue;

      const transaccion = extraerIdTransaccion(texto) || parsed.messageId || `${mailbox}:${message.uid}`;
      const gmailId = `gmail:${transaccion}`;
      if (gmailPagoYaUsado(gmailId)) continue;

      if (comprobanteId && texto.includes(comprobanteId)) {
        return { ok: true, monto, gmailId, transaccion, subject, from, fecha };
      }

      return { ok: true, monto, gmailId, transaccion, subject, from, fecha };
    }
  } finally {
    lock.release();
  }

  return null;
}

async function validarPagoPorGmail({ esperado, reservadoAt, comprobanteId }) {
  if (!gmailConfigurado()) {
    return { enabled: false, ok: false, reason: 'Gmail no configurado' };
  }

  const desdeReserva = reservadoAt ? new Date(reservadoAt) : new Date();
  const desdeLookback = new Date(
    Date.now() - Math.max(10, GMAIL_CONFIG.lookbackMinutes || 90) * 60 * 1000
  );
  const desde = new Date(Math.min(desdeReserva.getTime(), desdeLookback.getTime()));

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: GMAIL_CONFIG.user,
      pass: GMAIL_CONFIG.pass
    },
    logger: false
  });

  await client.connect();
  try {
    for (const mailbox of GMAIL_CONFIG.mailboxes) {
      try {
        const match = await buscarPagoEnMailbox(client, mailbox, {
          esperado,
          desde,
          comprobanteId
        });
        if (match) return { enabled: true, ...match };
      } catch (error) {
        console.error(`No se pudo revisar Gmail mailbox ${mailbox}:`, error.message);
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return { enabled: true, ok: false, reason: 'No se encontro correo bancario compatible' };
}

async function guardarComprobante(m, cliente) {
  const extension = m.message?.imageMessage?.mimetype?.includes('png') ? 'png' : 'jpg';
  const nombreArchivo = `comprobante-${fechaArchivo()}-${cliente.telefono}.${extension}`;
  const outPath = path.join(comprobantesDir, nombreArchivo);
  const buffer = await downloadMediaMessage(m, 'buffer', {});

  fs.writeFileSync(outPath, buffer);
  return outPath;
}

async function registrarVenta(cliente, boletas) {
  const total = totalEsperado(cliente);
  const fecha = new Date().toLocaleString('es-PY');
  const row = {
    id: crypto.randomUUID(),
    fecha,
    vendedor: vendedorVenta(cliente),
    codigo_vendedor: codigoVendedorVenta(cliente),
    telefono: telefonoVisible(cliente.telefono),
    nombre: cliente.nombre,
    ci: cliente.ci,
    numeros: cliente.numeros.join(' '),
    cantidad: cliente.cantidad,
    total,
    comision: comisionVenta(cliente),
    monto_pagado: cliente.montoPagado || total,
    comprobante: cliente.comprobantePath || '',
    boletas: boletas.join(' | ')
  };
  const linea = [
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

  fs.appendFileSync(ventasCsvPath, linea + '\n', 'utf8');
  try {
    await supabaseInsert('sales', row);
  } catch (error) {
    console.error('No se pudo guardar venta en Supabase:', error.message);
  }
}

function configurarHojaVentas(sheet) {
  sheet.columns = [
    { header: 'Fecha', key: 'fecha', width: 22 },
    { header: 'Vendedor', key: 'vendedor', width: 24 },
    { header: 'Codigo vendedor', key: 'codigoVendedor', width: 18 },
    { header: 'Telefono', key: 'telefono', width: 18 },
    { header: 'Nombre y apellido', key: 'nombre', width: 28 },
    { header: 'CI', key: 'ci', width: 14 },
    { header: 'Numeros', key: 'numeros', width: 28 },
    { header: 'Cantidad', key: 'cantidad', width: 10 },
    { header: 'Total Gs.', key: 'total', width: 14 },
    { header: 'Comision Gs.', key: 'comision', width: 14 },
    { header: 'Monto pagado Gs.', key: 'montoPagado', width: 18 },
    { header: 'Comprobante', key: 'comprobante', width: 55 },
    { header: 'Boletas', key: 'boletas', width: 55 }
  ];
}

function configurarHojaNumeros(sheet) {
  sheet.columns = [
    { header: 'Numero', key: 'numero', width: 12 },
    { header: 'Fecha venta', key: 'fecha', width: 22 },
    { header: 'Vendedor', key: 'vendedor', width: 24 },
    { header: 'Codigo vendedor', key: 'codigoVendedor', width: 18 },
    { header: 'Nombre y apellido', key: 'nombre', width: 28 },
    { header: 'CI', key: 'ci', width: 14 },
    { header: 'Telefono', key: 'telefono', width: 18 },
    { header: 'Comision Gs.', key: 'comision', width: 14 },
    { header: 'Monto pagado Gs.', key: 'montoPagado', width: 18 },
    { header: 'Comprobante', key: 'comprobante', width: 55 },
    { header: 'Boleta', key: 'boleta', width: 55 }
  ];
}

function aplicarFormatoControl(workbook) {
  for (const sheet of workbook.worksheets) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
      from: 'A1',
      to: sheet.getRow(1).getCell(sheet.columnCount).address
    };

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF111827' }
    };
    header.alignment = { vertical: 'middle', horizontal: 'center' };
    header.height = 24;

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.alignment = { vertical: 'middle', wrapText: true };
    });

    if (sheet.name === 'Ventas') {
      sheet.getColumn('I').numFmt = '#,##0';
      sheet.getColumn('J').numFmt = '#,##0';
      sheet.getColumn('K').numFmt = '#,##0';
    }

    if (sheet.name === 'Numeros para sorteo') {
      sheet.getColumn('H').numFmt = '#,##0';
      sheet.getColumn('I').numFmt = '#,##0';
    }
  }
}

async function cargarWorkbookControl() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = CONFIG.titular;
  workbook.created = new Date();
  workbook.modified = new Date();

  if (fs.existsSync(ventasXlsxPath)) {
    await workbook.xlsx.readFile(ventasXlsxPath);
  }

  let ventas = workbook.getWorksheet('Ventas');
  if (!ventas) {
    ventas = workbook.addWorksheet('Ventas');
    configurarHojaVentas(ventas);
  }

  let numeros = workbook.getWorksheet('Numeros para sorteo');
  if (!numeros) {
    numeros = workbook.addWorksheet('Numeros para sorteo');
    configurarHojaNumeros(numeros);
  }

  return { workbook, ventas, numeros };
}

async function registrarVentaExcel(cliente, boletas) {
  const fecha = new Date().toLocaleString('es-PY');
  const total = totalEsperado(cliente);
  const { workbook, ventas, numeros } = await cargarWorkbookControl();

  configurarHojaVentas(ventas);
  configurarHojaNumeros(numeros);

  ventas.addRow({
    fecha,
    vendedor: vendedorVenta(cliente),
    codigoVendedor: codigoVendedorVenta(cliente),
    telefono: telefonoVisible(cliente.telefono),
    nombre: cliente.nombre,
    ci: cliente.ci,
    numeros: cliente.numeros.join(' '),
    cantidad: cliente.cantidad,
    total,
    comision: comisionVenta(cliente),
    montoPagado: cliente.montoPagado || '',
    comprobante: cliente.comprobantePath || '',
    boletas: boletas.join(' | ')
  });

  cliente.numeros.forEach((numero, index) => {
    numeros.addRow({
      numero,
      fecha,
      vendedor: vendedorVenta(cliente),
      codigoVendedor: codigoVendedorVenta(cliente),
      nombre: cliente.nombre,
      ci: cliente.ci,
      telefono: telefonoVisible(cliente.telefono),
      comision: Number(cliente?.vendedor?.commission || 0),
      montoPagado: cliente.montoPagado || '',
      comprobante: cliente.comprobantePath || '',
      boleta: boletas[index] || ''
    });
  });

  aplicarFormatoControl(workbook);
  await workbook.xlsx.writeFile(ventasXlsxPath);
}

function limpiarCliente(jid) {
  const cliente = clientes.get(jid);
  if (cliente?.timeout) clearTimeout(cliente.timeout);
  if (cliente && cliente.step !== 'FINALIZADO') {
    for (const numero of cliente.numeros || []) {
      numerosVendidos.delete(numero);
    }
  }
  clientes.delete(jid);
}

async function enviarMarketing(sock, jid, textoExtra = '') {
  const imagenMarketing = CONFIG.imagenesMarketing.find((filePath) =>
    fs.existsSync(filePath)
  );
  const caption =
    `🚗🔥 *${CONFIG.titular}* 🔥🚗\n\n` +
    `🏆 Premio: *${CONFIG.sorteo}*\n` +
    `🎟️ Valor por numero: *${guaranies(CONFIG.precio)}*\n` +
    `🔞 Participan solo mayores de 18 años.\n\n` +
    textoExtra;

  if (imagenMarketing) {
    await sock.sendMessage(jid, {
      image: fs.readFileSync(imagenMarketing),
      caption
    });
    return;
  }

  await sock.sendMessage(jid, { text: caption });
}

async function generarBoletaPdf({ cliente, ci, tel, nro, vendedor, codigoVendedor }) {
  const telVisible = telefonoVisible(tel);
  const vendedorVisible = vendedor || 'Venta directa';
  const codigoVisible = normalizarCodigo(codigoVendedor || 'DIRECTO');
  const sig = firmaBoleta({ nro, ci, codigoVendedor: codigoVisible });
  const qrData = `MINO-GOUP|NRO:${nro}|CI:${ci}|TEL:${telVisible}|VENDEDOR:${codigoVisible}|SIG:${sig}`;
  const qrPng = await QRCode.toBuffer(qrData, { width: 260, margin: 1 });
  const outPath = path.join(boletasDir, `boleta-${nro}.pdf`);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [420, 640], margin: 0 });
    const stream = fs.createWriteStream(outPath);

    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.pipe(stream);

    const W = doc.page.width;
    const H = doc.page.height;
    const black = '#101010';
    const deepBlack = '#050505';
    const gold = '#d9a928';
    const lightGold = '#f5dc8a';
    const paper = '#fbfaf6';
    const ink = '#202020';
    const muted = '#6f6f6f';

    const money = guaranies(CONFIG.precio);
    const drawRule = (y, x = 42, width = 176) => {
      doc
        .moveTo(x, y)
        .lineTo(x + width, y)
        .lineWidth(1)
        .strokeColor('#e4d6aa')
        .stroke();
    };
    const label = (text, x, y, width) => {
      doc
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor(muted)
        .text(text.toUpperCase(), x, y, { width, characterSpacing: 0.7 });
    };
    const value = (text, x, y, width, size = 11) => {
      doc
        .font('Helvetica-Bold')
        .fontSize(size)
        .fillColor(ink)
        .text(String(text || '').toUpperCase(), x, y, { width, lineGap: 2 });
    };

    doc.rect(0, 0, W, H).fill(paper);

    doc.rect(0, 0, W, 132).fill(deepBlack);
    doc.rect(0, 122, W, 10).fill(gold);

    if (fs.existsSync(CONFIG.logoBoleta)) {
      doc.image(CONFIG.logoBoleta, (W - 128) / 2, 14, {
        fit: [128, 74],
        align: 'center',
        valign: 'center'
      });
    } else {
      doc
        .fillColor(gold)
        .fontSize(34)
        .font('Helvetica-Bold')
        .text('MINO', 0, 28, { width: W, align: 'center' });
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(gold)
      .text('BOLETA OFICIAL', 0, 86, { width: W, align: 'center' })
      .fontSize(8)
      .fillColor(lightGold)
      .text('MIÑO GOUP - SORTEO EXCLUSIVO', 0, 108, {
        width: W,
        align: 'center'
      });

    doc
      .roundedRect(26, 148, W - 52, 100, 10)
      .fillAndStroke('#ffffff', '#ead9a2');
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(gold)
      .text('LA JOYA DEL SORTEO', 0, 162, { width: W, align: 'center' });
    doc
      .fontSize(13)
      .fillColor(black)
      .text('TOYOTA VITZ 2013 ROJO CANDY', 46, 181, {
        width: W - 92,
        align: 'center'
      });
    doc
      .fontSize(8)
      .fillColor(muted)
      .text('Edicion unica - Participacion registrada', 46, 202, {
        width: W - 92,
        align: 'center'
      });
    doc
      .roundedRect(112, 218, 196, 44, 22)
      .fillAndStroke(black, gold);
    doc
      .fontSize(8)
      .fillColor(lightGold)
      .text('NUMERO DE LA SUERTE', 0, 226, { width: W, align: 'center' });
    doc
      .fontSize(24)
      .fillColor('#ffffff')
      .text(`#${nro}`, 0, 237, { width: W, align: 'center' });

    doc.roundedRect(26, 288, 214, 184, 8).fillAndStroke('#ffffff', '#ece2c3');
    label('Cliente', 42, 306, 170);
    value(cliente, 42, 319, 176, 10);
    drawRule(346);
    label('Cedula', 42, 360, 80);
    value(ci, 42, 373, 82, 11);
    label('Telefono', 138, 360, 88);
    value(telVisible, 138, 373, 86, 10);
    drawRule(400);
    label('Vendedor', 42, 410, 170);
    value(vendedorVisible, 42, 423, 176, 9);
    drawRule(444);
    label('Valor de la boleta', 42, 452, 170);
    value(money, 42, 464, 170, 10);

    doc.roundedRect(258, 288, 136, 174, 8).fillAndStroke('#ffffff', '#ece2c3');
    doc.image(qrPng, 278, 309, { width: 96 });
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(muted)
      .text('ESCANEAR PARA VERIFICAR', 268, 414, {
        width: 116,
        align: 'center'
      });
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#777777')
      .text('Codigo unico de participacion', 270, 436, {
        width: 112,
        align: 'center'
      });

    doc.roundedRect(26, 480, W - 52, 74, 8).fillAndStroke(black, gold);
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(gold)
      .text('IMPORTANTE', 44, 496, { width: W - 88, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#ffffff')
      .text(
        'Conserva esta boleta. Sera requerida para controlar tu participacion el dia del sorteo.',
        48,
        516,
        { width: W - 96, align: 'center', lineGap: 2 }
      );

    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(black)
      .text('Participan solo mayores de 18 anos.', 0, 574, {
        width: W,
        align: 'center'
      });
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(muted)
      .text(`Emitido por ${CONFIG.titular} | Alias ${CONFIG.aliasRuc}`, 0, 592, {
        width: W,
        align: 'center'
      });

    doc.end();
  });

  return outPath;
}

async function enviarInicio(sock, jid) {
  await enviarMarketing(
    sock,
    jid,
    `✨ *Tu Vitz puede estar a un numero de distancia.*\n\n` +
      `👇 Responde con la cantidad que queres reservar:\n` +
      `*1* = 1 numero\n` +
      `*2* = 2 numeros\n` +
      `*3* = 3 numeros\n\n` +
      `Tambien podes escribir otra cantidad, ejemplo: *5*`
  );
}

async function startBot() {
  cargarNumerosVendidosDesdeCsv();
  await cargarNumerosVendidosDesdeSupabase();

  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' }),
    browser: ['Mi\u00f1o Goup Bot', 'Chrome', '1.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log(`Escanea este QR con WhatsApp ${CONFIG.telefonoBot}:`);
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const loggedOut =
        lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut;
      if (!loggedOut) startBot();
      else console.log('Sesion cerrada. Borra auth_info y vuelve a escanear el QR.');
    }

    if (connection === 'open') {
      console.log(`Bot conectado en wa.me/${CONFIG.telefonoBot}`);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const m of messages) {
      if (!m.message || m.key.fromMe) continue;

      const jid = m.key.remoteJid;
      if (!esChatPrivado(jid)) {
        console.log(`Ignorado chat no privado: ${jid}`);
        continue;
      }

      const text = textoMensaje(m.message);
      const image = m.message?.imageMessage;
      const vendedorDetectado = detectarVendedor(text);

      if (vendedorDetectado && text) {
        await registrarLead(jid, vendedorDetectado, text, 'LINK_RECIBIDO');
      }

      if (!clientes.has(jid)) {
        clientes.set(jid, {
          step: 'NUEVO',
          telefono: jid.split('@')[0],
          vendedor: vendedorDetectado || null
        });
      }

      const cliente = clientes.get(jid);
      if (vendedorDetectado && ['FINALIZADO', 'NUEVO', 'INICIO'].includes(cliente.step)) {
        limpiarCliente(jid);
        clientes.set(jid, {
          step: 'INICIO',
          telefono: jid.split('@')[0],
          vendedor: vendedorDetectado
        });
        await enviarInicio(sock, jid);
        continue;
      }

      if (vendedorDetectado) cliente.vendedor = vendedorDetectado;
      console.log(`[${cliente.step}] ${jid}: ${text || image ? 'mensaje recibido' : 'sin texto'}`);

      if (['hola', 'menu', 'inicio', 'cancelar'].includes(text.toLowerCase())) {
        const vendedorActual = cliente.vendedor || vendedorDetectado || null;
        limpiarCliente(jid);
        clientes.set(jid, {
          step: 'INICIO',
          telefono: jid.split('@')[0],
          vendedor: vendedorActual
        });
        await enviarInicio(sock, jid);
        continue;
      }

      if (cliente.step === 'NUEVO') {
        cliente.step = 'INICIO';
        await enviarInicio(sock, jid);
        continue;
      }

      if (cliente.step === 'INICIO') {
        const cantidad = Number.parseInt(text, 10);

        if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50) {
          await enviarInicio(sock, jid);
          continue;
        }

        cliente.cantidad = cantidad;
        try {
          cliente.numeros = Array.from({ length: cantidad }, generarNumero);
        } catch (error) {
          await sock.sendMessage(jid, {
            text: '⚠️ No quedan suficientes numeros disponibles para esa cantidad.'
          });
          cliente.step = 'INICIO';
          continue;
        }
        cliente.reservadoAt = new Date().toISOString();
        cliente.step = 'ESPERANDO_COMPROBANTE';
        cliente.timeout = setTimeout(async () => {
          await sock.sendMessage(jid, {
            text:
              'Se vencio el tiempo de reserva. Tus numeros fueron liberados. ' +
              'Escribi una cantidad para reservar de nuevo.'
          });
          limpiarCliente(jid);
        }, CONFIG.tiempoPagoMin * 60 * 1000);

        await enviarMarketing(
          sock,
          jid,
          `✅ *Numeros reservados correctamente*\n\n` +
            `🙋 Vendedor: *${vendedorVenta(cliente)}*\n` +
            `🎟️ Tus numeros: *${cliente.numeros.join(', ')}*\n` +
            `💰 Total a pagar: *${guaranies(CONFIG.precio * cantidad)}*\n\n` +
            `🏦 *Datos para el pago:*\n` +
            `Alias: *${CONFIG.aliasRuc}*\n` +
            `Titular: *${CONFIG.titular}*\n\n` +
            `⏳ Tenes *${CONFIG.tiempoPagoMin} minutos* para enviar la foto del comprobante.\n` +
            `🔞 Prohibida la venta a menores de 18 años.\n\n` +
            `📸 Envia ahora la captura del comprobante para registrar tu compra.`
        );
        continue;
      }

      if (cliente.step === 'ESPERANDO_COMPROBANTE') {
        if (!image) {
          await sock.sendMessage(jid, {
            text: 'Por favor envia la foto o captura del comprobante de transferencia.'
          });
          continue;
        }

        await sock.sendMessage(jid, { text: '🔎 Procesando comprobante...' });
        await sock.sendMessage(jid, { text: '🧾 Comprobante recibido. Registrando tu compra...' });
        cliente.comprobantePath = await guardarComprobante(m, cliente);
        cliente.montoPagado = totalEsperado(cliente);
        console.log(`Comprobante guardado: ${cliente.comprobantePath}`);

        clearTimeout(cliente.timeout);
        cliente.timeout = null;
        cliente.step = 'PIDE_NOMBRE';
        await sock.sendMessage(jid, {
          text:
            `✅ *Compra registrada!*\n\n` +
            `Total: *${guaranies(cliente.montoPagado)}*\n` +
            `Ahora pasamos a emitir tu boleta.\n\n` +
            `👤 Cual es tu nombre y apellido?`
        });
        continue;
      }

      if (cliente.step === 'PIDE_NOMBRE') {
        if (text.length < 3) {
          await sock.sendMessage(jid, { text: '👤 Enviame tu nombre y apellido completo.' });
          continue;
        }

        cliente.nombre = text;
        cliente.step = 'PIDE_CI';
        await sock.sendMessage(jid, {
          text: `🙌 Gracias *${cliente.nombre}*.\n\n🪪 Cual es tu numero de documento?`
        });
        continue;
      }

      if (cliente.step === 'PIDE_CI') {
        const ci = text.replace(/\D/g, '');
        if (ci.length < 5) {
          await sock.sendMessage(jid, { text: '⚠️ Ese CI parece muy corto. Enviame solo numeros.' });
          continue;
        }

        cliente.ci = ci;
        cliente.step = 'CONFIRMAR';
        await sock.sendMessage(jid, {
          text:
            `📋 *Revisemos tus datos:*\n\n` +
            `👤 Titular: *${cliente.nombre}*\n` +
            `🪪 Documento CI: *${cliente.ci}*\n` +
            `📱 Telefono: *${telefonoVisible(cliente.telefono)}*\n` +
            `🙋 Vendedor: *${vendedorVenta(cliente)}*\n` +
            `🎟️ Numeros: *${cliente.numeros.join(', ')}*\n\n` +
            `Responde *SI* para emitir la boleta o *NO* para corregir.`
        });
        continue;
      }

      if (cliente.step === 'CONFIRMAR') {
        const respuesta = text.toLowerCase();

        if (respuesta.includes('no')) {
          cliente.step = 'PIDE_NOMBRE';
          await sock.sendMessage(jid, {
            text: '👌 Ok, corrijamos.\n\n👤 Cual es tu nombre y apellido correcto?'
          });
          continue;
        }

        if (!respuesta.includes('si')) {
          await sock.sendMessage(jid, { text: 'Responde *SI* para finalizar o *NO* para corregir.' });
          continue;
        }

        cliente.step = 'FINALIZADO';
        await sock.sendMessage(jid, {
          text: '🧾 Registrando tu compra y generando tus boletas. Por favor aguarda...'
        });

        const boletasGeneradas = [];
        for (const nro of cliente.numeros) {
          const boleta = await generarBoletaPdf({
            cliente: cliente.nombre,
            ci: cliente.ci,
            tel: cliente.telefono,
            nro,
            vendedor: vendedorVenta(cliente),
            codigoVendedor: codigoVendedorVenta(cliente)
          });
          boletasGeneradas.push(boleta);

          await sock.sendMessage(jid, {
            document: fs.readFileSync(boleta),
            fileName: `boleta-${nro}.pdf`,
            mimetype: 'application/pdf',
            caption: `Boleta #${nro}`
          });
        }

        await registrarVenta(cliente, boletasGeneradas);
        await registrarVentaExcel(cliente, boletasGeneradas);

        await sock.sendMessage(jid, {
          text:
            `🎉 *Venta completada!*\n\n` +
            `Tus numeros ya quedaron registrados para el sorteo.\n` +
            `🍀 Mucha suerte y gracias por participar con *${CONFIG.titular}*.`
        });
        limpiarCliente(jid);
      }
    }
  });
}

if (process.env.PREVIEW_BOLETA === '1') {
  generarBoletaPdf({
    cliente: 'Cliente Demo',
    ci: '1234567',
    tel: '595994124451',
    nro: '12345',
    vendedor: 'Vendedor Prueba',
    codigoVendedor: 'PRUEBA'
  })
    .then((outPath) => {
      console.log(`Boleta de prueba generada: ${outPath}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('No se pudo generar la boleta de prueba:', error);
      process.exit(1);
    });
} else {
  asegurarEncabezadoVentasCsv();

  startBot().catch((error) => {
    console.error('No se pudo iniciar el bot:', error);
    process.exit(1);
  });

  console.log('Iniciando bot...');
}
