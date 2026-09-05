const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const { loadAndProcessApartments } = require('./data_loader');
const AssemblyStore = require('./store');
const { generarReporteExcel } = require('./export_report');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin2026';

const app = express();
const server = http.createServer(app);

// Optimize Socket.io for high concurrency & flaky mobile connections
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  pingTimeout: 20000,
  pingInterval: 10000
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health Check for Cloud deployment (Google Cloud Run / Render)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Initialize data
console.log('Initializing Assembly Data...');
const apartments = loadAndProcessApartments();
const store = new AssemblyStore(apartments);
console.log(`System ready with ${apartments.length} apartments.`);

// Throttled stats broadcast to prevent event queue flooding during bursts
let statsBroadcastTimer = null;
let pendingBroadcastPreguntaId = null;

function broadcastStatsThrottled(preguntaId, immediate = false) {
  pendingBroadcastPreguntaId = preguntaId;
  if (immediate) {
    if (statsBroadcastTimer) {
      clearTimeout(statsBroadcastTimer);
      statsBroadcastTimer = null;
    }
    const stats = store.calcularEstadisticas(pendingBroadcastPreguntaId);
    if (stats) {
      io.to('admin').emit('stats:updated', stats);
      io.to('proyeccion').emit('stats:updated', stats);
    }
    return;
  }

  if (statsBroadcastTimer) return;

  statsBroadcastTimer = setTimeout(() => {
    statsBroadcastTimer = null;
    if (pendingBroadcastPreguntaId) {
      const stats = store.calcularEstadisticas(pendingBroadcastPreguntaId);
      if (stats) {
        io.to('admin').emit('stats:updated', stats);
        io.to('proyeccion').emit('stats:updated', stats);
      }
    }
  }, 100); // 10 FPS real-time broadcast max
}

// Middleware for Admin Authorization
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.adminKey;
  if (key && key === ADMIN_KEY) {
    return next();
  }
  return res.status(401).json({ error: 'Acceso no autorizado al panel administrativo.' });
}

// ----------------------------------------------------
// PUBLIC & VOTER API
// ----------------------------------------------------

app.get('/api/config', (req, res) => {
  const towers = {};
  for (let i = 0; i < apartments.length; i++) {
    const a = apartments[i];
    if (!towers[a.torre]) towers[a.torre] = [];
    towers[a.torre].push({
      apto: a.apto,
      id: a.id
    });
  }

  res.json({
    nombreCopropiedad: 'Conjunto Residencial Sopó',
    totalApartamentos: apartments.length,
    towers
  });
});

app.post('/api/auth', (req, res) => {
  const { torre, apto, pin } = req.body;
  if (!torre || !apto || !pin) {
    return res.status(400).json({ error: 'Por favor ingrese torre, apartamento y PIN.' });
  }

  const apt = store.authenticate(torre, apto, pin);
  if (!apt) {
    return res.status(401).json({ error: 'PIN o datos de apartamento incorrectos.' });
  }

  res.json({
    success: true,
    apartment: {
      id: apt.id,
      torre: apt.torre,
      apto: apt.apto,
      nombreCompleto: apt.nombreCompleto,
      area: apt.area,
      coeficiente: apt.coeficiente,
      token: apt.token
    }
  });
});

app.post('/api/auth-token', (req, res) => {
  const { token } = req.body;
  const apt = store.authenticateByToken(token);
  if (!apt) {
    return res.status(401).json({ error: 'Enlace de acceso inválido o expirado.' });
  }

  res.json({
    success: true,
    apartment: {
      id: apt.id,
      torre: apt.torre,
      apto: apt.apto,
      nombreCompleto: apt.nombreCompleto,
      area: apt.area,
      coeficiente: apt.coeficiente,
      token: apt.token
    }
  });
});

app.get('/api/voter/state', (req, res) => {
  const token = req.headers['x-voter-token'];
  const apt = store.authenticateByToken(token);
  if (!apt) {
    return res.status(401).json({ error: 'Sesión no válida.' });
  }

  const activeQuestion = store.getPreguntaActiva();
  let myVote = null;

  if (activeQuestion && activeQuestion.votos[apt.id]) {
    myVote = activeQuestion.votos[apt.id];
  }

  res.json({
    apartment: {
      id: apt.id,
      torre: apt.torre,
      apto: apt.apto,
      nombreCompleto: apt.nombreCompleto,
      coeficiente: apt.coeficiente
    },
    activeQuestion: activeQuestion ? {
      id: activeQuestion.id,
      titulo: activeQuestion.titulo,
      descripcion: activeQuestion.descripcion,
      tipo: activeQuestion.tipo,
      opciones: activeQuestion.opciones,
      estado: activeQuestion.estado
    } : null,
    myVote
  });
});

// Cast Vote - Ultra Fast < 2ms execution
app.post('/api/voter/vote', (req, res) => {
  const token = req.headers['x-voter-token'];
  const { preguntaId, opcionId } = req.body;

  const apt = store.authenticateByToken(token);
  if (!apt) {
    return res.status(401).json({ error: 'Sesión no autorizada para votar.' });
  }

  const result = store.emitirVoto(preguntaId, apt.id, opcionId);
  if (!result.success) {
    return res.status(400).json(result);
  }

  // Throttle broadcast for high concurrency
  broadcastStatsThrottled(preguntaId);

  // Direct response to voter
  res.json(result);
});

// ----------------------------------------------------
// ADMIN API
// ----------------------------------------------------

app.post('/api/admin/login', (req, res) => {
  const { key } = req.body;
  if (key === ADMIN_KEY) {
    return res.json({ success: true, adminKey: ADMIN_KEY });
  }
  return res.status(401).json({ error: 'Clave de administración incorrecta.' });
});

app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const quorum = store.getQuorumInfo();
  const activeQuestion = store.getPreguntaActiva();
  const stats = activeQuestion ? store.calcularEstadisticas(activeQuestion.id) : null;

  const preguntasSummary = store.state.preguntas.map(p => ({
    id: p.id,
    titulo: p.titulo,
    tipo: p.tipo,
    estado: p.estado,
    totalVotos: Object.keys(p.votos).length,
    horaInicio: p.horaInicio,
    horaCierre: p.horaCierre
  }));

  res.json({
    quorum,
    activeQuestion: activeQuestion ? {
      id: activeQuestion.id,
      titulo: activeQuestion.titulo,
      tipo: activeQuestion.tipo,
      estado: activeQuestion.estado,
      opciones: activeQuestion.opciones
    } : null,
    activeStats: stats,
    preguntas: preguntasSummary,
    asistenciaMap: store.state.asistencia
  });
});

app.get('/api/admin/questions/:id/stats', requireAdmin, (req, res) => {
  const stats = store.calcularEstadisticas(req.params.id);
  if (!stats) {
    return res.status(404).json({ error: 'Pregunta no encontrada.' });
  }
  res.json(stats);
});

app.post('/api/admin/questions', requireAdmin, (req, res) => {
  const { titulo, descripcion, tipo, opciones } = req.body;
  if (!titulo) {
    return res.status(400).json({ error: 'El título de la pregunta es obligatorio.' });
  }

  const preg = store.crearPregunta({ titulo, descripcion, tipo, opciones });
  res.json({ success: true, pregunta: preg });
});

app.post('/api/admin/questions/:id/open', requireAdmin, (req, res) => {
  try {
    const preg = store.abrirPregunta(req.params.id);

    io.emit('question:opened', {
      id: preg.id,
      titulo: preg.titulo,
      descripcion: preg.descripcion,
      tipo: preg.tipo,
      opciones: preg.opciones
    });

    broadcastStatsThrottled(preg.id, true);
    res.json({ success: true, pregunta: preg });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/questions/:id/close', requireAdmin, (req, res) => {
  try {
    const preg = store.cerrarPregunta(req.params.id);

    io.emit('question:closed', { id: preg.id, titulo: preg.titulo });
    broadcastStatsThrottled(preg.id, true);

    res.json({ success: true, pregunta: preg });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/questions/:id', requireAdmin, (req, res) => {
  const success = store.eliminarPregunta(req.params.id);
  if (success) {
    io.emit('question:deleted', { id: req.params.id });
    return res.json({ success: true });
  }
  return res.status(404).json({ error: 'Pregunta no encontrada.' });
});

app.post('/api/admin/attendance', requireAdmin, (req, res) => {
  const { aptoId, presente, torre, todos } = req.body;

  if (todos !== undefined) {
    store.marcarTodos(Boolean(todos));
  } else if (torre !== undefined) {
    store.marcarTorre(torre, Boolean(presente));
  } else if (aptoId) {
    store.marcarAsistencia(aptoId, Boolean(presente));
  }

  const quorum = store.getQuorumInfo();
  io.to('admin').emit('quorum:updated', quorum);
  io.to('proyeccion').emit('quorum:updated', quorum);

  res.json({ success: true, quorum });
});

app.get('/api/admin/export', requireAdmin, (req, res) => {
  try {
    const buffer = generarReporteExcel(store);
    const filename = `Reporte_Asamblea_Sopo_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Error generating report:', err);
    res.status(500).json({ error: 'Error al generar el reporte de auditoría.' });
  }
});

app.get('/api/projection/live', (req, res) => {
  const quorum = store.getQuorumInfo();
  const activeQuestion = store.getPreguntaActiva();
  const stats = activeQuestion ? store.calcularEstadisticas(activeQuestion.id) : null;
  res.json({ quorum, activeQuestion, stats });
});

// ----------------------------------------------------
// SOCKET.IO REALTIME ENGINE
// ----------------------------------------------------

io.on('connection', (socket) => {
  socket.on('join:admin', (key) => {
    if (key === ADMIN_KEY) {
      socket.join('admin');
    }
  });

  socket.on('join:proyeccion', () => {
    socket.join('proyeccion');
  });

  socket.on('join:voter', (token) => {
    const apt = store.authenticateByToken(token);
    if (apt) {
      socket.join(`apto_${apt.id}`);
      socket.data.aptoId = apt.id;
    }
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` SISTEMA DE VOTACIÓN ASAMBLEA SOPÓ INICIADO (ALTA CONCURRENCIA)`);
  console.log(` - Acceso Residentes: http://localhost:${PORT}`);
  console.log(` - Panel Administrador: http://localhost:${PORT}/admin.html`);
  console.log(` - Pantalla Proyección: http://localhost:${PORT}/proyeccion.html`);
  console.log(` - Clave Admin: ${ADMIN_KEY}`);
  console.log(`=======================================================`);
});
