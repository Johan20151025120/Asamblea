const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const crypto = require('crypto');

const EXCEL_FILE = path.join(__dirname, '..', 'COEFICIENTES.xlsx');
const DATA_DIR = path.join(__dirname, '..', 'data');
const APARTMENTS_FILE = path.join(DATA_DIR, 'apartments.json');
const EXPORT_PINS_FILE = path.join(__dirname, '..', 'PINS_ASAMBLEA.xlsx');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Generate a 4-digit PIN deterministically or randomly.
 * We use apartment ID + secret seed to ensure PINs are stable across restarts if regenerated,
 * but random-looking for security.
 */
function generatePIN(aptoId, seed = 'sopo-asamblea-2026') {
  const hash = crypto.createHash('sha256').update(`${aptoId}-${seed}`).digest('hex');
  const num = parseInt(hash.substring(0, 6), 16) % 9000 + 1000;
  return num.toString();
}

function generateToken(aptoId, pin) {
  return crypto.createHash('md5').update(`${aptoId}-${pin}-token`).digest('hex').substring(0, 10);
}

function loadAndProcessApartments(baseUrl = 'http://localhost:3000') {
  // If apartments.json already exists, load existing PINs to preserve them
  let existingPins = {};
  if (fs.existsSync(APARTMENTS_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(APARTMENTS_FILE, 'utf8'));
      for (const a of existing) {
        existingPins[a.id] = { pin: a.pin, token: a.token };
      }
    } catch (e) {
      console.warn('Could not read existing apartments.json:', e.message);
    }
  }

  if (!fs.existsSync(EXCEL_FILE)) {
    throw new Error(`Excel file not found at: ${EXCEL_FILE}`);
  }

  const wb = xlsx.readFile(EXCEL_FILE);
  const sheetName = wb.SheetNames.find(s => s.trim().toUpperCase() === 'TOTALES') || wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

  const apartments = [];
  let totalCoef = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const aptoRaw = row[2] ? String(row[2]).trim() : '';
    let areaRaw = row[3];
    let coefRaw = row[4];

    if (aptoRaw && aptoRaw.includes('-')) {
      const parts = aptoRaw.split('-');
      const torre = parseInt(parts[0], 10);
      const aptoNum = parts[1].trim();

      if (isNaN(torre)) continue;

      let coef = 0;
      if (typeof coefRaw === 'number') {
        coef = coefRaw;
      } else if (typeof coefRaw === 'string') {
        coef = parseFloat(coefRaw.trim().replace(',', '.'));
      }

      let area = 0;
      if (typeof areaRaw === 'number') {
        area = areaRaw;
      } else if (typeof areaRaw === 'string') {
        area = parseFloat(areaRaw.trim().replace(',', '.'));
      }

      if (!isNaN(coef) && coef > 0) {
        const id = `${torre}-${aptoNum}`;
        const pin = existingPins[id]?.pin || generatePIN(id);
        const token = existingPins[id]?.token || generateToken(id, pin);

        apartments.push({
          id,
          torre,
          apto: aptoNum,
          nombreCompleto: `Torre ${torre} - Apto ${aptoNum}`,
          area: Number(area.toFixed(2)),
          coeficiente: Number(coef.toFixed(4)),
          pin,
          token
        });

        totalCoef += coef;
      }
    }
  }

  // Sort by torre, then by apto
  apartments.sort((a, b) => {
    if (a.torre !== b.torre) return a.torre - b.torre;
    return parseInt(a.apto, 10) - parseInt(b.apto, 10);
  });

  // Save to JSON
  fs.writeFileSync(APARTMENTS_FILE, JSON.stringify(apartments, null, 2), 'utf8');
  console.log(`Successfully saved ${apartments.length} apartments to ${APARTMENTS_FILE}`);
  console.log(`Total Coeficiente sum: ${totalCoef.toFixed(4)}%`);

  // Export to Excel for administration
  exportPinsToExcel(apartments, baseUrl);

  return apartments;
}

function exportPinsToExcel(apartments, baseUrl = 'http://localhost:3000') {
  const excelData = apartments.map(a => ({
    'TORRE': a.torre,
    'APARTAMENTO': a.apto,
    'IDENTIFICADOR': a.id,
    'ÁREA (m²)': a.area,
    'COEFICIENTE (%)': a.coeficiente,
    'PIN DE ACCESO': a.pin,
    'ENLACE DIRECTO': `${baseUrl}/?token=${a.token}`
  }));

  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(excelData);

  // Set column widths for easy reading
  ws['!cols'] = [
    { wch: 8 },  // Torre
    { wch: 14 }, // Apartamento
    { wch: 16 }, // Identificador
    { wch: 12 }, // Area
    { wch: 16 }, // Coeficiente
    { wch: 16 }, // PIN
    { wch: 50 }  // Enlace Directo
  ];

  xlsx.utils.book_append_sheet(wb, ws, 'CREDENCIALES_ASAMBLEA');
  xlsx.writeFile(wb, EXPORT_PINS_FILE);
  console.log(`Exported credentials to ${EXPORT_PINS_FILE}`);
}

if (require.main === module) {
  loadAndProcessApartments();
}

module.exports = {
  loadAndProcessApartments,
  exportPinsToExcel,
  APARTMENTS_FILE,
  DATA_DIR
};
