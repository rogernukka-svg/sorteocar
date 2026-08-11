const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const port = Number(process.env.PANEL_PORT || 5176);
const vendedoresPath = path.join(root, 'vendedores.json');
const ventasCsvPath = path.join(root, 'ventas.csv');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const clean = decoded === '/' ? '/pwa/index.html' : decoded;
  const filePath = path.normalize(path.join(root, clean));
  return filePath.startsWith(root) ? filePath : null;
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

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error('Body too large'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function normalizarCodigo(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 18);
}

function leerVendedores() {
  if (!fs.existsSync(vendedoresPath)) {
    fs.writeFileSync(vendedoresPath, JSON.stringify({ sellers: [] }, null, 2), 'utf8');
  }

  try {
    const data = JSON.parse(fs.readFileSync(vendedoresPath, 'utf8'));
    return Array.isArray(data.sellers) ? data.sellers : [];
  } catch {
    return [];
  }
}

function guardarVendedores(sellers) {
  fs.writeFileSync(vendedoresPath, JSON.stringify({ sellers }, null, 2), 'utf8');
}

function leerVentas() {
  if (!fs.existsSync(ventasCsvPath)) return [];
  const lineas = fs.readFileSync(ventasCsvPath, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lineas.length < 2) return [];

  const headers = parseCsvLine(lineas[0]).map((header) => header.trim());
  const esFormatoViejo = !headers.includes('vendedor') && !headers.includes('Vendedor');

  if (esFormatoViejo) {
    return lineas.slice(1).map((linea) => {
      const columnas = parseCsvLine(linea);
      return {
        fecha: columnas[0] || '',
        vendedor: 'Venta directa',
        codigo_vendedor: 'DIRECTO',
        telefono: columnas[1] || '',
        nombre: columnas[2] || '',
        ci: columnas[3] || '',
        numeros: columnas[4] || '',
        cantidad: columnas[5] || '',
        total: columnas[6] || '',
        comision: '0',
        monto_pagado: columnas[7] || '',
        comprobante: columnas[8] || '',
        boletas: columnas[9] || ''
      };
    });
  }

  return lineas.slice(1).map((linea) => {
    const columnas = parseCsvLine(linea);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = columnas[index] || '';
    });
    return row;
  });
}

function vendedorPorCodigo(codigo) {
  const limpio = normalizarCodigo(codigo);
  return leerVendedores().find((seller) => normalizarCodigo(seller.code) === limpio) || null;
}

function promoHtml(req, seller) {
  const host = req.headers.host || `localhost:${port}`;
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const baseUrl = `${protocol}://${host}`;
  const sellerName = seller?.name || 'Miño Goup';
  const sellerCode = seller?.code || 'DIRECTO';
  const whatsappText = `Hola, quiero comprar boletas del sorteo Miño Goup. Vendedor: ${sellerCode}`;
  const whatsappUrl = `https://wa.me/595994124451?text=${encodeURIComponent(whatsappText)}`;
  const imageUrl = `${baseUrl}/assets/mino.png`;
  const logoUrl = `${baseUrl}/assets/logo.png`;

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Toyota Vitz 2013 | Miño Goup</title>
    <meta name="description" content="Compra tu boleta para el sorteo Toyota Vitz 2013 con Miño Goup. Vendedor: ${sellerName}" />
    <meta property="og:title" content="Toyota Vitz 2013 - Miño Goup" />
    <meta property="og:description" content="Boletas digitales con QR. Vendedor: ${sellerName}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:url" content="${baseUrl}/v/${sellerCode}" />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${imageUrl}" />
    <link rel="icon" href="${logoUrl}" />
    <meta http-equiv="refresh" content="1; url=${whatsappUrl}" />
    <style>
      body { margin:0; min-height:100vh; display:grid; place-items:center; font-family:Arial,sans-serif; background:#090909; color:white; }
      main { width:min(520px, calc(100% - 28px)); text-align:center; }
      img.hero { width:100%; border-radius:8px; display:block; margin-bottom:18px; }
      img.logo { width:74px; height:74px; object-fit:cover; border-radius:8px; margin-bottom:10px; }
      a { display:inline-grid; place-items:center; min-height:46px; padding:0 18px; border-radius:8px; background:#d8a72d; color:#17120a; text-decoration:none; font-weight:700; }
      p { color:#f4e9cf; }
    </style>
  </head>
  <body>
    <main>
      <img class="logo" src="${logoUrl}" alt="Miño Goup" />
      <img class="hero" src="${imageUrl}" alt="Toyota Vitz 2013" />
      <h1>Toyota Vitz 2013</h1>
      <p>Vendedor: ${sellerName}</p>
      <a href="${whatsappUrl}">Comprar por WhatsApp</a>
    </main>
  </body>
</html>`;
}

const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/v/') && req.method === 'GET') {
    const code = decodeURIComponent(req.url.split('/').pop().split('?')[0]);
    const seller = vendedorPorCodigo(code);
    send(res, 200, promoHtml(req, seller), 'text/html; charset=utf-8');
    return;
  }

  if (req.url === '/api/sellers' && req.method === 'GET') {
    json(res, 200, { sellers: leerVendedores() });
    return;
  }

  if (req.url === '/api/sellers' && req.method === 'POST') {
    readBody(req)
      .then((body) => {
        const data = JSON.parse(body || '{}');
        const name = String(data.name || '').trim();
        const code = normalizarCodigo(data.code || name);
        const commission = Math.max(0, Number(data.commission || 0));

        if (!name || !code) {
          json(res, 400, { error: 'Nombre y codigo son obligatorios' });
          return;
        }

        const sellers = leerVendedores().filter((seller) => seller.code !== 'DEMO');
        if (sellers.some((seller) => normalizarCodigo(seller.code) === code)) {
          json(res, 409, { error: 'Ese codigo ya existe' });
          return;
        }

        const seller = {
          id: crypto.randomUUID(),
          name,
          code,
          commission,
          createdAt: new Date().toISOString()
        };
        sellers.push(seller);
        guardarVendedores(sellers);
        json(res, 201, { seller });
      })
      .catch((error) => json(res, 400, { error: error.message }));
    return;
  }

  if (req.url?.startsWith('/api/sellers/') && req.method === 'DELETE') {
    const id = decodeURIComponent(req.url.split('/').pop());
    guardarVendedores(leerVendedores().filter((seller) => seller.id !== id));
    json(res, 200, { ok: true });
    return;
  }

  if (req.url === '/api/sales' && req.method === 'GET') {
    json(res, 200, { sales: leerVentas() });
    return;
  }

  const filePath = safePath(req.url);
  if (!filePath) {
    send(res, 403, 'Forbidden');
    return;
  }

  const finalPath = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
    ? path.join(filePath, 'index.html')
    : filePath;

  fs.readFile(finalPath, (error, data) => {
    if (error) {
      send(res, 404, 'Not found');
      return;
    }

    send(res, 200, data, types[path.extname(finalPath).toLowerCase()] || 'application/octet-stream');
  });
});

server.listen(port, () => {
  console.log(`Panel Miño Goup listo en http://localhost:${port}/pwa/`);
});
