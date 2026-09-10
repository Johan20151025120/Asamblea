const assert = require('assert');
const { loadAndProcessApartments } = require('../server/data_loader');
const AssemblyStore = require('../server/store');
const { generarReporteExcel } = require('../server/export_report');

console.log('--- INICIANDO PRUEBAS DEL SISTEMA DE VOTACIÓN ---');

// 1. Validar carga de apartamentos
const apartments = loadAndProcessApartments();
assert.strictEqual(apartments.length, 440, 'Debe haber exactamente 440 unidades (439 aptos + AR Construcciones)');
console.log('✔ Carga de apartamentos validada: 440 unidades encontradas.');

// 2. Validar suma de coeficientes
const store = new AssemblyStore(apartments);
const quorumInit = store.getQuorumInfo();
console.log(`✔ Coeficiente general de la copropiedad: ${quorumInit.totalCoeficienteGeneral}%`);
assert.ok(quorumInit.totalCoeficienteGeneral > 99.9 && quorumInit.totalCoeficienteGeneral <= 100.0, 'Suma de coeficientes debe ser ~100%');

// 3. Validar autenticación
const sampleApt = apartments[0]; // Torre 1 - Apto 101
const authOk = store.authenticate(sampleApt.torre, sampleApt.apto, sampleApt.pin);
assert.ok(authOk, 'Autenticación con PIN correcto debe ser exitosa');
const authFail = store.authenticate(sampleApt.torre, sampleApt.apto, '99999');
assert.strictEqual(authFail, null, 'Autenticación con PIN incorrecto debe fallar');
console.log(`✔ Autenticación validada para ${sampleApt.nombreCompleto} con PIN ${sampleApt.pin}`);

// 3.1 Validar usuario AR Construcciones
const arApt = apartments.find(a => a.torre === 'AR Construcciones');
assert.ok(arApt, 'Debe existir el usuario AR Construcciones');
assert.strictEqual(arApt.apto, 'AR Construcciones');
assert.strictEqual(arApt.coeficiente, 6.0836);
assert.strictEqual(arApt.area, 1473.19);
const arAuth = store.authenticate('AR Construcciones', 'AR Construcciones', arApt.pin);
assert.ok(arAuth, 'Autenticación para AR Construcciones debe ser exitosa');
console.log(`✔ Usuario AR Construcciones validado: Coef ${arApt.coeficiente}%, Área ${arApt.area}m², PIN ${arApt.pin}`);

// 4. Validar Quórum
store.marcarTodos(false);
assert.strictEqual(store.getQuorumInfo().apartamentosPresentes, 0);

// Marcar Torre 1 completa (24 aptos)
store.marcarTorre(1, true);
const quorumT1 = store.getQuorumInfo();
assert.strictEqual(quorumT1.apartamentosPresentes, 24);
console.log(`✔ Quórum Torre 1 presente: ${quorumT1.coeficientePresente}% (${quorumT1.apartamentosPresentes} aptos)`);

// 5. Crear Pregunta y Abrir Votación
const preg = store.crearPregunta({
  titulo: '¿Aprueba el presupuesto ordinario 2025?',
  tipo: 'aprobacion'
});
assert.strictEqual(preg.estado, 'borrador');
store.abrirPregunta(preg.id);
assert.strictEqual(store.getPreguntaActiva().id, preg.id);
console.log('✔ Pregunta creada y abierta correctamente.');

// 6. Emitir Votos y Probar Anti-Doble Voto
// Voto de 1-101 por SÍ
const voto1 = store.emitirVoto(preg.id, sampleApt.id, 'opt_si');
assert.strictEqual(voto1.success, true);
assert.strictEqual(voto1.voto.coeficiente, sampleApt.coeficiente);

// Intento de doble voto por 1-101
const votoDuplicado = store.emitirVoto(preg.id, sampleApt.id, 'opt_no');
assert.strictEqual(votoDuplicado.success, false, 'El sistema DEBE rechazar el doble voto');
console.log('✔ Bloqueo de doble voto verificado con éxito: rechazado.');

// Voto de 1-102 por NO
const apt2 = apartments[1];
const voto2 = store.emitirVoto(preg.id, apt2.id, 'opt_no');
assert.strictEqual(voto2.success, true);

// 7. Validar Estadísticas Ponderadas
const stats = store.calcularEstadisticas(preg.id);
assert.strictEqual(stats.totalVotosEmitidos, 2);
const optSi = stats.opciones.find(o => o.id === 'opt_si');
const optNo = stats.opciones.find(o => o.id === 'opt_no');

assert.strictEqual(optSi.votosNominales, 1);
assert.strictEqual(optNo.votosNominales, 1);
assert.strictEqual(optSi.coeficienteSuma, sampleApt.coeficiente);
assert.strictEqual(optNo.coeficienteSuma, apt2.coeficiente);
console.log('✔ Estadísticas ponderadas por coeficiente verificadas con precisión.');
console.log(`   - Sí: ${optSi.coeficienteSuma}% (Nominal: ${optSi.votosNominales})`);
console.log(`   - No: ${optNo.coeficienteSuma}% (Nominal: ${optNo.votosNominales})`);

// 8. Validar Radar de Faltantes
assert.ok(stats.faltantes.total > 0);
console.log(`✔ Radar de faltantes verificado: ${stats.faltantes.total} aptos pendientes.`);

// 9. Validar Cierre de Pregunta
store.cerrarPregunta(preg.id);
const votoTardio = store.emitirVoto(preg.id, apartments[2].id, 'opt_si');
assert.strictEqual(votoTardio.success, false, 'No se puede votar en pregunta cerrada');
console.log('✔ Bloqueo de votos tras cierre de pregunta verificado.');

// 10. Validar Generación de Reporte Excel
const excelBuffer = generarReporteExcel(store);
assert.ok(excelBuffer.length > 1000, 'El archivo Excel de auditoría debe generarse');
console.log(`✔ Reporte Excel generado exitosamente (${excelBuffer.length} bytes).`);

console.log('\n--- TODAS LAS PRUEBAS PASARON EXITOSAMENTE (10/10) ---');
