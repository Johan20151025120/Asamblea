const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const EXCEL_FILE = path.join(__dirname, '..', 'COEFICIENTES.xlsx');
const BACKUP_FILE = path.join(__dirname, '..', 'COEFICIENTES_ORIGINAL.xlsx');

if (!fs.existsSync(BACKUP_FILE)) {
  fs.copyFileSync(EXCEL_FILE, BACKUP_FILE);
  console.log('Copia de respaldo creada en COEFICIENTES_ORIGINAL.xlsx');
}

const wb = xlsx.readFile(BACKUP_FILE);
const sheetName = 'TOTALES ';
const ws = wb.Sheets[sheetName];
const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });

const UNDELIVERED_SET = new Set([
  '2-401', '4-104', '8-102', '8-301', '8-404', '8-502',
  '9-204', '9-501', '10-101', '10-104', '10-203', '10-403', '10-603',
  '11-201', '11-302', '12-503', '12-602', '12-604', '13-104', '13-603',
  '14-302', '14-303', '15-203', '15-502', '15-504', '16-102', '16-204',
  '17-603', '19-103'
]);

const newRows = [];
const noEntregadosRows = [
  ['LISTADO DE APARTAMENTOS NO ENTREGADOS - AR CONSTRUCCIONES'],
  ['NO.', 'TORRE', 'UNIDAD', 'AREA (m²)', 'COEFICIENTE (%)']
];

let noCounter = 1;
let sumExcludedArea = 0;
let sumExcludedCoef = 0;

for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  if (!row) continue;
  const aptoRaw = row[2] ? String(row[2]).trim() : '';

  if (aptoRaw && UNDELIVERED_SET.has(aptoRaw)) {
    const parts = aptoRaw.split('-');
    const area = row[3];
    const coef = row[4];
    noEntregadosRows.push([noCounter++, parts[0], parts[1], area, coef]);
    const numArea = typeof area === 'number' ? area : parseFloat(String(area).replace(',', '.'));
    const numCoef = typeof coef === 'number' ? coef : parseFloat(String(coef).replace(',', '.'));
    sumExcludedArea += numArea;
    sumExcludedCoef += numCoef;
    continue;
  }

  if (aptoRaw === 'TOTAL') {
    newRows.push(['AR CONSTRUCCIONES', null, 'AR Construcciones', '1473,19', '        6,0836 ']);
  }

  newRows.push(row);
}

noEntregadosRows.push([]);
noEntregadosRows.push(['TOTAL', null, (noCounter - 1) + ' APTOS', sumExcludedArea.toFixed(2), '6,0836']);

// Update TOTALES sheet
const updatedWs = xlsx.utils.aoa_to_sheet(newRows);
wb.Sheets[sheetName] = updatedWs;

// Add new sheet for audit
const auditWs = xlsx.utils.aoa_to_sheet(noEntregadosRows);
auditWs['!cols'] = [{ wch: 6 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
xlsx.utils.book_append_sheet(wb, auditWs, 'NO_ENTREGADOS_CONSTRUCTORA');

xlsx.writeFile(wb, EXCEL_FILE);
console.log('COEFICIENTES.xlsx actualizado exitosamente con la consolidación.');
console.log('Total aptos no entregados registrados en hoja de auditoría:', noCounter - 1);
