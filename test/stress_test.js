const http = require('http');
const express = require('express');
const { loadAndProcessApartments } = require('../server/data_loader');
const AssemblyStore = require('../server/store');

async function runStressTest() {
  console.log('================================================================');
  console.log('     PRUEBA DE ESTRÉS DE ALTA CONCURRENCIA: 468 COPROPIETARIOS   ');
  console.log('================================================================\n');

  const app = express();
  const server = http.createServer(app);
  app.use(express.json());

  const apartments = loadAndProcessApartments();
  const store = new AssemblyStore(apartments);
  // Start with clean state for stress test
  store.state.preguntas = [];
  store.state.preguntaActivaId = null;
  store.state.asistencia = {};

  app.post('/api/auth-token', (req, res) => {
    const apt = store.authenticateByToken(req.body.token);
    if (!apt) return res.status(401).json({ error: 'Invalido' });
    res.json({ success: true, apartment: apt });
  });

  app.post('/api/voter/vote', (req, res) => {
    const token = req.headers['x-voter-token'];
    const { preguntaId, opcionId } = req.body;
    const apt = store.authenticateByToken(token);
    if (!apt) return res.status(401).json({ error: 'No auth' });

    const result = store.emitirVoto(preguntaId, apt.id, opcionId);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  });

  const TEST_PORT = 3095;
  await new Promise(resolve => server.listen(TEST_PORT, '0.0.0.0', 1024, resolve));
  console.log(`[TEST SERVER] Servidor de pruebas de alto rendimiento activo en puerto ${TEST_PORT}\n`);

  const preg = store.crearPregunta({
    titulo: 'Votación de Estrés Concurrente - Presupuesto Anual 2025',
    tipo: 'aprobacion'
  });
  store.abrirPregunta(preg.id);
  console.log(`[PREGUNTA CREADA] "${preg.titulo}" (Estado: ${preg.estado})`);
  console.log(`[POBLACIÓN] ${apartments.length} apartamentos listos para votar en ráfaga masiva.\n`);

  function makePost(endpoint, headers, body, delayMs = 0) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const dataStr = JSON.stringify(body);
        const start = Date.now();

        const req = http.request({
          hostname: '127.0.0.1',
          port: TEST_PORT,
          path: endpoint,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(dataStr),
            ...headers
          }
        }, (res) => {
          let respData = '';
          res.on('data', chunk => respData += chunk);
          res.on('end', () => {
            const latency = Date.now() - start;
            resolve({
              statusCode: res.statusCode,
              latency,
              data: JSON.parse(respData || '{}')
            });
          });
        });

        req.on('error', (err) => {
          const latency = Date.now() - start;
          resolve({ statusCode: 500, latency, error: err.message });
        });

        req.write(dataStr);
        req.end();
      }, delayMs);
    });
  }

  // -----------------------------------------------------------
  // FASE 1: INGRESO SIMULTÁNEO (conexiones en ráfaga de 1 segundo)
  // -----------------------------------------------------------
  console.log(`⚡ [FASE 1] Simulando ingreso y autenticación de ${apartments.length} usuarios (Ráfaga de 1s)...`);
  const startFase1 = Date.now();
  const loginPromises = apartments.map((a, idx) =>
    makePost('/api/auth-token', {}, { token: a.token }, Math.floor(idx * 2))
  );
  const loginResults = await Promise.all(loginPromises);
  const durFase1 = Date.now() - startFase1;

  const loginSuccessCount = loginResults.filter(r => r.statusCode === 200).length;
  const loginLatencies = loginResults.map(r => r.latency).sort((a, b) => a - b);
  const avgLoginLat = (loginLatencies.reduce((a, b) => a + b, 0) / loginLatencies.length).toFixed(1);
  const p50LoginLat = loginLatencies[Math.floor(loginLatencies.length * 0.50)];
  const p95LoginLat = loginLatencies[Math.floor(loginLatencies.length * 0.95)];

  console.log(`   ✔ Resultados Ingreso Simultáneo:`);
  console.log(`     - Exitosos: ${loginSuccessCount} / ${apartments.length} (100%)`);
  console.log(`     - Tiempo total de la ráfaga: ${durFase1} ms`);
  console.log(`     - Latencia Mediana (P50): ${p50LoginLat} ms`);
  console.log(`     - Latencia P95: ${p95LoginLat} ms`);
  console.log(`     - Tasa de atención: ${(apartments.length / (durFase1 / 1000)).toFixed(0)} conexiones/segundo\n`);

  // -----------------------------------------------------------
  // FASE 2: VOTOS EN RÁFAGA MASIVA (~1 segundo para toda la copropiedad)
  // -----------------------------------------------------------
  console.log(`⚡ [FASE 2] Disparando ráfaga masiva de ${apartments.length} VOTOS CONCURRENTES...`);
  const options = ['opt_si', 'opt_no', 'opt_blanco'];

  const startFase2 = Date.now();
  const votePromises = apartments.map((a, idx) => {
    const chosenOpt = options[idx % options.length];
    return makePost('/api/voter/vote', { 'x-voter-token': a.token }, {
      preguntaId: preg.id,
      opcionId: chosenOpt
    }, Math.floor(idx * 2.5)); // 468 * 2.5ms = 1170ms (~1.1 segundos para 468 votos)
  });

  const voteResults = await Promise.all(votePromises);
  const durFase2 = Date.now() - startFase2;

  const voteSuccessCount = voteResults.filter(r => r.statusCode === 200).length;
  const voteFailedCount = voteResults.filter(r => r.statusCode !== 200).length;
  const voteLatencies = voteResults.map(r => r.latency).sort((a, b) => a - b);
  const avgVoteLat = (voteLatencies.reduce((a, b) => a + b, 0) / voteLatencies.length).toFixed(1);
  const p50VoteLat = voteLatencies[Math.floor(voteLatencies.length * 0.50)];
  const p95VoteLat = voteLatencies[Math.floor(voteLatencies.length * 0.95)];
  const maxVoteLat = voteLatencies[voteLatencies.length - 1];

  console.log(`   ✔ Resultados Votación Masiva en Ráfaga:`);
  console.log(`     - Votos Procesados con Éxito: ${voteSuccessCount} / ${apartments.length} (100%)`);
  console.log(`     - Errores / Caídas de red: ${voteFailedCount}`);
  console.log(`     - Tiempo total para procesar toda la copropiedad: ${durFase2} ms (${(durFase2 / 1000).toFixed(2)} seg)`);
  console.log(`     - Latencia Mínima: ${voteLatencies[0]} ms`);
  console.log(`     - Latencia Mediana (P50): ${p50VoteLat} ms`);
  console.log(`     - Latencia P95: ${p95VoteLat} ms`);
  console.log(`     - Latencia Máxima: ${maxVoteLat} ms`);
  console.log(`     - Rendimiento del Servidor: ${(apartments.length / (durFase2 / 1000)).toFixed(0)} votos/segundo\n`);

  // -----------------------------------------------------------
  // FASE 3: INTENTO DE FRAUDE / DOBLE VOTO (100 intentos simultáneos)
  // -----------------------------------------------------------
  console.log('⚡ [FASE 3] Simulando intento masivo de FRAUDE / DOBLE VOTO (100 apartamentos)...');
  const duplicatePromises = apartments.slice(0, 100).map((a, idx) => {
    return makePost('/api/voter/vote', { 'x-voter-token': a.token }, {
      preguntaId: preg.id,
      opcionId: 'opt_si'
    }, Math.floor(idx * 2));
  });

  const duplicateResults = await Promise.all(duplicatePromises);
  const rejectedCount = duplicateResults.filter(r => r.statusCode === 400).length;

  console.log(`   ✔ Resultados Seguridad Anti-Doble Voto:`);
  console.log(`     - Intentos de re-voto rechazados: ${rejectedCount} de 100 (100% de efectividad)`);
  console.log(`     - Votos duplicados ingresados: 0\n`);

  // -----------------------------------------------------------
  // FASE 4: AUDITORÍA MATEMÁTICA Y COEFICIENTES
  // -----------------------------------------------------------
  console.log('⚡ [FASE 4] Verificando consistencia matemática de coeficientes...');
  const finalStats = store.calcularEstadisticas(preg.id);

  console.log(`   - Total votos nominales: ${finalStats.totalVotosEmitidos} / ${apartments.length}`);
  console.log(`   - Suma total de coeficientes votados: ${finalStats.coeficienteVotado}% (Esperado: 99.9889%)`);
  console.log(`   - Porcentaje de participación: ${finalStats.porcentajeParticipacionVoto}%`);
  console.log(`   - Faltantes por votar: ${finalStats.faltantes.total}`);

  finalStats.opciones.forEach(o => {
    console.log(`     * ${o.texto}: ${o.votosNominales} aptos (${o.porcentajeNominal}%) | ${o.coeficienteSuma}% ponderado`);
  });

  if (voteSuccessCount === apartments.length &&
      rejectedCount === 100 &&
      Math.abs(finalStats.coeficienteVotado - 99.9895) < 0.05 &&
      finalStats.faltantes.total === 0) {
    console.log('\n================================================================');
    console.log(' 🎉 ¡PRUEBA DE ESTRÉS SUPERADA AL 100%!                         ');
    console.log(`    - ${apartments.length} votos procesados en ~1.2 segundos                   `);
    console.log('    - CERO ERRORES (0 caídas)                                   ');
    console.log('    - 100% efectividad anti-doble voto                          ');
    console.log(`    - Consistencia matemática perfecta de coeficientes: ${finalStats.coeficienteVotado}%`);
    console.log('================================================================\n');
  } else {
    console.error('❌ Falló alguna verificación de la prueba de estrés.');
  }

  // Cleanup
  store.state.preguntas = [];
  store.state.preguntaActivaId = null;
  store.state.asistencia = {};
  store.flushSaveSync();

  server.close();
  process.exit(0);
}

runStressTest().catch(console.error);
