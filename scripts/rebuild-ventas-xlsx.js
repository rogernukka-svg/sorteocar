const ExcelJS = require('exceljs');
const { parseFile } = require('@fast-csv/parse');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const csvPath = path.join(root, 'ventas.csv');
const xlsxPath = path.join(root, 'ventas.xlsx');

function configurarHojaVentas(sheet) {
  sheet.columns = [
    { header: 'Fecha', key: 'fecha', width: 22 },
    { header: 'Telefono', key: 'telefono', width: 18 },
    { header: 'Nombre y apellido', key: 'nombre', width: 28 },
    { header: 'CI', key: 'ci', width: 14 },
    { header: 'Numeros', key: 'numeros', width: 28 },
    { header: 'Cantidad', key: 'cantidad', width: 10 },
    { header: 'Total Gs.', key: 'total', width: 14 },
    { header: 'Monto pagado Gs.', key: 'monto_pagado', width: 18 },
    { header: 'Comprobante', key: 'comprobante', width: 55 },
    { header: 'Boletas', key: 'boletas', width: 55 }
  ];
}

function configurarHojaNumeros(sheet) {
  sheet.columns = [
    { header: 'Numero', key: 'numero', width: 12 },
    { header: 'Fecha venta', key: 'fecha', width: 22 },
    { header: 'Nombre y apellido', key: 'nombre', width: 28 },
    { header: 'CI', key: 'ci', width: 14 },
    { header: 'Telefono', key: 'telefono', width: 18 },
    { header: 'Monto pagado Gs.', key: 'monto_pagado', width: 18 },
    { header: 'Comprobante', key: 'comprobante', width: 55 },
    { header: 'Boleta', key: 'boleta', width: 55 }
  ];
}

function aplicarFormato(workbook) {
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
      sheet.getColumn('G').numFmt = '#,##0';
      sheet.getColumn('H').numFmt = '#,##0';
    }

    if (sheet.name === 'Numeros para sorteo') {
      sheet.getColumn('F').numFmt = '#,##0';
    }
  }
}

async function leerVentas() {
  if (!fs.existsSync(csvPath)) return [];

  return new Promise((resolve, reject) => {
    const rows = [];
    parseFile(csvPath, { headers: true, ignoreEmpty: true })
      .on('error', reject)
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows));
  });
}

async function main() {
  const ventasCsv = await leerVentas();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Miño Goup';
  workbook.created = new Date();
  workbook.modified = new Date();

  const ventas = workbook.addWorksheet('Ventas');
  const numeros = workbook.addWorksheet('Numeros para sorteo');
  configurarHojaVentas(ventas);
  configurarHojaNumeros(numeros);

  for (const venta of ventasCsv) {
    const ventaNormalizada = {
      fecha: venta.fecha,
      telefono: venta.telefono,
      nombre: venta.nombre,
      ci: venta.ci,
      numeros: venta.numeros,
      cantidad: Number(venta.cantidad || 0),
      total: Number(venta.total || 0),
      monto_pagado: Number(venta.monto_pagado || venta.total || 0),
      comprobante: venta.comprobante,
      boletas: venta.boletas
    };

    ventas.addRow(ventaNormalizada);

    const listaNumeros = String(venta.numeros || '').split(/\s+/).filter(Boolean);
    const listaBoletas = String(venta.boletas || '').split(' | ');
    listaNumeros.forEach((numero, index) => {
      numeros.addRow({
        numero,
        fecha: venta.fecha,
        nombre: venta.nombre,
        ci: venta.ci,
        telefono: venta.telefono,
        monto_pagado: ventaNormalizada.monto_pagado,
        comprobante: venta.comprobante,
        boleta: listaBoletas[index] || ''
      });
    });
  }

  aplicarFormato(workbook);
  await workbook.xlsx.writeFile(xlsxPath);
  console.log(`Excel actualizado: ${xlsxPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
