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

// 29 apartamentos no entregados que corresponden a la constructora (AR Construcciones)
const UNDELIVERED_SET = new Set([
  '2-401',
  '4-104',
  '8-102',
  '8-301',
  '8-404',
  '8-502',
  '9-204',
  '9-501',
  '10-101',
  '10-104',
  '10-203',
  '10-403',
  '10-603',
  '11-201',
  '11-302',
  '12-503',
  '12-602',
  '12-604',
  '13-104',
  '13-603',
  '14-302',
  '14-303',
  '15-203',
  '15-502',
  '15-504',
  '16-102',
  '16-204',
  '17-603',
  '19-103'
]);

function generatePIN(aptoId, seed = 'sopo-asamblea-2026') {
  const hash = crypto.createHash('sha256').update(`${aptoId}-${seed}`).digest('hex');
  const num = parseInt(hash.substring(0, 6), 16) % 9000 + 1000;
  return num.toString();
}

function generateToken(aptoId, pin) {
  return crypto.createHash('md5').update(`${aptoId}-${pin}-token`).digest('hex').substring(0, 10);
}

function loadAndProcessApartments(baseUrl = process.env.RENDER_EXTERNAL_URL || 'https://asamblea.onrender.com') {
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
  let arArea = 0;
  let arCoef = 0;
  let excludedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const aptoRaw = row[2] ? String(row[2]).trim() : '';
    let areaRaw = row[3];
    let coefRaw = row[4];

    // Detectar si la fila ya es el consolidado de AR Construcciones en el Excel
    if (aptoRaw.toUpperCase().includes('AR CONSTRUCCIONES') || String(row[0] || '').toUpperCase().includes('AR CONSTRUCCIONES')) {
      let parsedArea = 0;
      if (typeof areaRaw === 'number') parsedArea = areaRaw;
      else if (typeof areaRaw === 'string') parsedArea = parseFloat(areaRaw.trim().replace(',', '.'));

      let parsedCoef = 0;
      if (typeof coefRaw === 'number') parsedCoef = coefRaw;
      else if (typeof coefRaw === 'string') parsedCoef = parseFloat(coefRaw.trim().replace(',', '.'));

      if (parsedArea > 0) arArea = parsedArea;
      if (parsedCoef > 0) arCoef = parsedCoef;
      continue;
    }

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

        // Si corresponde a los no entregados, sumar a AR Construcciones y no agregar individual
        if (UNDELIVERED_SET.has(id)) {
          arArea += area;
          arCoef += coef;
          excludedCount++;
          continue;
        }

        const pin = existingPins[id]?.pin || generatePIN(id);
        const token = existingPins[id]?.token || generateToken(id, pin);

        apartments.push({
          id,
          torre: String(torre),
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

  console.log(`Apartamentos entregados individuales cargados: ${apartments.length}`);
  console.log(`Apartamentos no entregados unificados en AR Construcciones: ${excludedCount || 29} (Área acumulada: ${(arArea || 1473.19).toFixed(2)} m²)`);

  // Crear usuario consolidado para AR Construcciones
  const arId = 'AR-Construcciones';
  const arPin = existingPins[arId]?.pin || generatePIN(arId);
  const arToken = existingPins[arId]?.token || generateToken(arId, arPin);

  // Coeficiente según la suma del documento oficial: 6.0836% y área 1473.19 m²
  const arCoefFinal = arCoef > 0 ? Number(arCoef.toFixed(4)) : 6.0836;
  const arAreaFinal = arArea > 0 ? Number(arArea.toFixed(2)) : 1473.19;

  const arUser = {
    id: arId,
    torre: 'AR Construcciones',
    apto: 'AR Construcciones',
    nombreCompleto: 'AR Construcciones',
    area: arAreaFinal,
    coeficiente: arCoefFinal,
    pin: arPin,
    token: arToken
  };

  apartments.push(arUser);
  totalCoef += arCoefFinal;

  // Ordenar: torres numéricas primero, AR Construcciones al final
  apartments.sort((a, b) => {
    const isNumA = !isNaN(Number(a.torre));
    const isNumB = !isNaN(Number(b.torre));
    if (isNumA && isNumB) {
      if (Number(a.torre) !== Number(b.torre)) return Number(a.torre) - Number(b.torre);
      return parseInt(a.apto, 10) - parseInt(b.apto, 10);
    }
    if (isNumA && !isNumB) return -1;
    if (!isNumA && isNumB) return 1;
    return String(a.torre).localeCompare(String(b.torre));
  });

  // Guardar en data/apartments.json
  fs.writeFileSync(APARTMENTS_FILE, JSON.stringify(apartments, null, 2), 'utf8');
  console.log(`Total unidades votantes en el sistema: ${apartments.length} (439 propietarios + 1 AR Construcciones)`);
  console.log(`Suma total de coeficientes: ${totalCoef.toFixed(4)}%`);

  // Exportar a Excel
  exportPinsToExcel(apartments, baseUrl);

  return apartments;
}

function exportPinsToExcel(apartments, baseUrl = 'https://asamblea.onrender.com') {
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

  ws['!cols'] = [
    { wch: 18 }, // Torre (permite leer 'AR Construcciones')
    { wch: 18 }, // Apartamento
    { wch: 20 }, // Identificador
    { wch: 12 }, // Area
    { wch: 16 }, // Coeficiente
    { wch: 16 }, // PIN
    { wch: 55 }  // Enlace Directo
  ];

  xlsx.utils.book_append_sheet(wb, ws, 'CREDENCIALES_ASAMBLEA');
  xlsx.writeFile(wb, EXPORT_PINS_FILE);
  console.log(`Credenciales exportadas exitosamente a ${EXPORT_PINS_FILE}`);
}

if (require.main === module) {
  loadAndProcessApartments();
}

module.exports = {
  loadAndProcessApartments,
  exportPinsToExcel,
  UNDELIVERED_SET,
  APARTMENTS_FILE,
  DATA_DIR
};
