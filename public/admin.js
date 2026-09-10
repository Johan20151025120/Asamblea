// Admin Dashboard Logic
let socket = null;
let adminKey = localStorage.getItem('asamblea_admin_key') || 'admin2026';
let activeQuestionData = null;
let activeStatsData = null;
let towersData = {};
let currentQuorum = null;
let currentAsistenciaMap = {};

// DOM Elements
const overlayLogin = document.getElementById('admin-login-overlay');
const formAdminLogin = document.getElementById('form-admin-login');
const inputAdminKey = document.getElementById('input-admin-key');
const adminLoginError = document.getElementById('admin-login-error');
const btnAdminLogout = document.getElementById('btn-admin-logout');
const btnExportExcel = document.getElementById('btn-export-excel');

// Quorum Stats
const statQuorumPct = document.getElementById('stat-quorum-pct');
const barQuorumPct = document.getElementById('bar-quorum-pct');
const statQuorumCoef = document.getElementById('stat-quorum-coef');
const badgeQuorumStatus = document.getElementById('badge-quorum-status');
const statAptosPresentes = document.getElementById('stat-aptos-presentes');
const statAptosPresentesPct = document.getElementById('stat-aptos-presentes-pct');

// Active Voting State in Header
const badgeVotingState = document.getElementById('badge-voting-state');
const statActiveTitle = document.getElementById('stat-active-title');
const statActiveSubtitle = document.getElementById('stat-active-subtitle');
const btnCloseActiveQuestion = document.getElementById('btn-close-active-question');
const btnQuickNewQuestion = document.getElementById('btn-quick-new-question');

// Live Monitor Section
const sectionLiveMonitor = document.getElementById('section-live-monitor');
const liveQuestionTitle = document.getElementById('live-question-title');
const liveQuestionDesc = document.getElementById('live-question-desc');
const liveQuestionType = document.getElementById('live-question-type');
const liveCountVoted = document.getElementById('live-count-voted');
const liveCountPct = document.getElementById('live-count-pct');
const liveCountMissing = document.getElementById('live-count-missing');
const liveOptionsContainer = document.getElementById('live-options-container');

// Missing Radar
const radarMissingCount = document.getElementById('radar-missing-count');
const radarTowersGrid = document.getElementById('radar-towers-grid');
const btnCopyMissingZoom = document.getElementById('btn-copy-missing-zoom');

// Question Creator Form
const formCreateQuestion = document.getElementById('form-create-question');
const qInputTitulo = document.getElementById('q-input-titulo');
const qInputDesc = document.getElementById('q-input-desc');
const tplAprobacion = document.getElementById('tpl-aprobacion');
const tplCandidatos = document.getElementById('tpl-candidatos');
const containerCustomOptions = document.getElementById('container-custom-options');
const customOptionsList = document.getElementById('custom-options-list');
const btnAddOption = document.getElementById('btn-add-option');
const btnSubmitOpenNow = document.getElementById('btn-submit-open-now');
const btnSaveDraft = document.getElementById('btn-save-draft');

// Questions History
const questionsHistoryList = document.getElementById('questions-history-list');

// Attendance Modal
const btnToggleAsistencia = document.getElementById('btn-toggle-asistencia-modal');
const modalAsistencia = document.getElementById('modal-asistencia');
const btnCloseModalAsistencia = document.getElementById('btn-close-modal-asistencia');
const btnMarkAll = document.getElementById('btn-mark-all');
const btnUnmarkAll = document.getElementById('btn-unmark-all');
const modalQuorumCount = document.getElementById('modal-quorum-count');
const modalQuorumCoef = document.getElementById('modal-quorum-coef');
const modalAsistenciaContainer = document.getElementById('modal-asistencia-torres-container');

let questionType = 'aprobacion'; // 'aprobacion' | 'seleccion'

// 1. Initial Load
async function init() {
  await loadTowersConfig();

  if (adminKey) {
    verifyAdminKey(adminKey);
  } else {
    overlayLogin.classList.remove('hidden');
  }
}

async function loadTowersConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    towersData = data.towers || {};
  } catch (err) {
    console.error('Error loading config:', err);
  }
}

// 2. Authentication
formAdminLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = inputAdminKey.value.trim();
  await verifyAdminKey(key);
});

async function verifyAdminKey(key) {
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    const data = await res.json();

    if (!res.ok) {
      adminLoginError.textContent = data.error || 'Clave inválida';
      adminLoginError.classList.remove('hidden');
      return;
    }

    adminKey = key;
    localStorage.setItem('asamblea_admin_key', key);
    overlayLogin.classList.add('hidden');

    initSocket();
    await fetchOverview();
  } catch (err) {
    adminLoginError.textContent = 'Error al conectar con el servidor.';
    adminLoginError.classList.remove('hidden');
  }
}

btnAdminLogout.addEventListener('click', () => {
  localStorage.removeItem('asamblea_admin_key');
  window.location.reload();
});

// 3. Socket.io Connection with Auto-Reconnect
function initSocket() {
  if (socket) socket.disconnect();
  socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 30,
    reconnectionDelay: 1000
  });

  socket.on('connect', () => {
    socket.emit('join:admin', adminKey);
    fetchOverview();
  });

  socket.on('reconnect', () => {
    socket.emit('join:admin', adminKey);
    fetchOverview();
  });

  socket.on('stats:updated', (stats) => {
    activeStatsData = stats;
    renderLiveMonitor(stats);
  });

  socket.on('quorum:updated', (quorum) => {
    currentQuorum = quorum;
    renderQuorum(quorum);
  });

  socket.on('question:opened', async () => {
    await fetchOverview();
  });

  socket.on('question:closed', async () => {
    await fetchOverview();
  });
}

// 4. Fetch Complete State
async function fetchOverview() {
  try {
    const res = await fetch('/api/admin/overview', {
      headers: { 'x-admin-key': adminKey }
    });
    if (res.status === 401) {
      overlayLogin.classList.remove('hidden');
      return;
    }
    const data = await res.json();

    currentQuorum = data.quorum;
    activeQuestionData = data.activeQuestion;
    activeStatsData = data.activeStats;
    currentAsistenciaMap = data.asistenciaMap || {};

    renderQuorum(data.quorum);
    renderHeaderVotingState(data.activeQuestion, data.activeStats);
    renderQuestionsHistory(data.preguntas);

    if (data.activeQuestion && data.activeStats) {
      renderLiveMonitor(data.activeStats);
    } else {
      sectionLiveMonitor.classList.add('hidden');
    }
  } catch (err) {
    console.error('Error fetching overview:', err);
  }
}

// 5. Render Quorum Info
function renderQuorum(quorum) {
  if (!quorum) return;

  statQuorumPct.textContent = `${quorum.quorumPorcentaje.toFixed(2)}%`;
  barQuorumPct.style.width = `${Math.min(quorum.quorumPorcentaje, 100)}%`;
  statQuorumCoef.textContent = `${quorum.coeficientePresente.toFixed(2)}%`;

  statAptosPresentes.textContent = quorum.apartamentosPresentes;
  const nominalPct = ((quorum.apartamentosPresentes / quorum.totalApartamentos) * 100).toFixed(1);
  statAptosPresentesPct.textContent = `${nominalPct}%`;

  modalQuorumCount.textContent = quorum.apartamentosPresentes;
  modalQuorumCoef.textContent = `${quorum.coeficientePresente.toFixed(2)}%`;

  if (quorum.hayQuorumDeliberatorio) {
    badgeQuorumStatus.textContent = 'DELIBERATORIO';
    badgeQuorumStatus.className = 'px-2 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-extrabold';
    barQuorumPct.className = 'bg-emerald-600 h-2.5 rounded-full transition-all duration-500';
  } else {
    badgeQuorumStatus.textContent = 'INSUFICIENTE (< 50%)';
    badgeQuorumStatus.className = 'px-2 py-0.5 rounded-full text-[10px] bg-amber-100 text-amber-800 font-extrabold';
    barQuorumPct.className = 'bg-amber-500 h-2.5 rounded-full transition-all duration-500';
  }
}

function renderHeaderVotingState(activeQuestion, activeStats) {
  if (activeQuestion && activeQuestion.estado === 'abierta') {
    badgeVotingState.textContent = 'VOTACIÓN EN CURSO';
    badgeVotingState.className = 'px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-100 text-amber-800 animate-pulse';

    statActiveTitle.textContent = activeQuestion.titulo;
    statActiveSubtitle.textContent = `${activeStats ? activeStats.totalVotosEmitidos : 0} votos emitidos hasta el momento.`;

    btnCloseActiveQuestion.classList.remove('hidden');
  } else {
    badgeVotingState.textContent = 'SIN VOTACIÓN ACTIVA';
    badgeVotingState.className = 'px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-slate-100 text-slate-600';

    statActiveTitle.textContent = 'Ninguna votación en curso';
    statActiveSubtitle.textContent = 'Crea una nueva pregunta o selecciona una plantilla para iniciar.';

    btnCloseActiveQuestion.classList.add('hidden');
  }
}

// 6. Render Live Monitor with Dynamic Bars & Missing Radar
function renderLiveMonitor(stats) {
  if (!stats) return;

  sectionLiveMonitor.classList.remove('hidden');
  liveQuestionTitle.textContent = stats.titulo;
  liveQuestionType.textContent = stats.tipo === 'aprobacion' ? 'Aprobación (Sí / No / Blanco)' : 'Elección de Personas';

  liveCountVoted.textContent = `${stats.totalVotosEmitidos} / ${stats.totalHabilitadosParaVotar}`;
  liveCountPct.textContent = `${stats.porcentajeParticipacionVoto}%`;
  liveCountMissing.textContent = stats.faltantes.total;

  // Options Bars
  liveOptionsContainer.innerHTML = '';
  stats.opciones.forEach(opt => {
    const card = document.createElement('div');
    card.className = 'bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-2';

    let colorBar = 'bg-indigo-600';
    const txt = opt.texto.trim().toUpperCase();
    if (txt === 'SÍ' || txt === 'SI') colorBar = 'bg-emerald-500';
    else if (txt === 'NO') colorBar = 'bg-rose-500';
    else if (txt.includes('BLANCO')) colorBar = 'bg-slate-400';

    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <span class="font-extrabold text-sm text-slate-900">${opt.texto}</span>
          <span class="text-xs text-slate-500">(${opt.votosNominales} aptos &bull; ${opt.porcentajeNominal}%)</span>
        </div>
        <div class="text-right">
          <span class="text-sm font-black text-indigo-900">${opt.coeficienteSuma.toFixed(4)}%</span>
          <span class="text-[11px] text-slate-500 block">
            ${opt.porcentajeSobrePresentes}% sobre presentes | ${opt.porcentajeSobreTotal}% del total
          </span>
        </div>
      </div>
      <div class="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
        <div class="${colorBar} h-3 rounded-full transition-all duration-300" style="width: ${Math.min(opt.porcentajeSobrePresentes, 100)}%"></div>
      </div>
    `;
    liveOptionsContainer.appendChild(card);
  });

  // Missing Radar
  radarMissingCount.textContent = stats.faltantes.total;
  radarTowersGrid.innerHTML = '';

  const towers = Object.keys(stats.faltantes.porTorre).sort((a, b) => {
    const numA = parseInt(a);
    const numB = parseInt(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(a).localeCompare(String(b));
  });
  if (towers.length === 0) {
    radarTowersGrid.innerHTML = '<div class="col-span-full text-center py-2 text-emerald-700 font-bold">¡Todos los apartamentos han votado!</div>';
  } else {
    for (const t of towers) {
      const aptos = stats.faltantes.porTorre[t];
      const isNum = !isNaN(t);
      const title = isNum ? `Torre ${t} (${aptos.length})` : `${t} (${aptos.length})`;
      const box = document.createElement('div');
      box.className = 'bg-white border border-amber-300/80 rounded-lg p-2';
      box.innerHTML = `
        <span class="font-bold text-slate-900 block border-b border-amber-100 pb-0.5 mb-1">${title}</span>
        <span class="text-slate-600 text-[11px] leading-tight block">${aptos.map(a => a.apto).join(', ')}</span>
      `;
      radarTowersGrid.appendChild(box);
    }
  }
}

// Copy Missing Aptos formatted for Zoom
btnCopyMissingZoom.addEventListener('click', () => {
  if (!activeStatsData || !activeStatsData.faltantes) return;
  const faltantes = activeStatsData.faltantes.porTorre;
  const towers = Object.keys(faltantes).sort((a, b) => {
    const numA = parseInt(a);
    const numB = parseInt(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(a).localeCompare(String(b));
  });

  if (towers.length === 0) {
    alert('¡No faltan apartamentos por votar!');
    return;
  }

  let text = `📢 RECORDATORIO DE VOTACIÓN (Faltan ${activeStatsData.faltantes.total} apartamentos por votar):\n`;
  for (const t of towers) {
    const aptos = faltantes[t].map(a => a.apto).join(', ');
    const label = !isNaN(t) ? `Torre ${t}` : t;
    text += `${label}: [${aptos}]\n`;
  }
  text += `👉 Por favor ingresen y confirmen su voto.`;

  navigator.clipboard.writeText(text).then(() => {
    btnCopyMissingZoom.textContent = '¡Copiado al portapapeles!';
    setTimeout(() => {
      btnCopyMissingZoom.textContent = 'Copiar lista para Zoom / Chat';
    }, 2500);
  });
});

// Close active question
btnCloseActiveQuestion.addEventListener('click', async () => {
  if (!activeQuestionData) return;
  if (!confirm(`¿Estás seguro de cerrar la votación de "${activeQuestionData.titulo}"? Ya no se recibirán más votos.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/admin/questions/${activeQuestionData.id}/close`, {
      method: 'POST',
      headers: { 'x-admin-key': adminKey }
    });
    if (res.ok) {
      await fetchOverview();
    }
  } catch (err) {
    alert('Error al cerrar la votación.');
  }
});

// 7. Question Templates & Creation
tplAprobacion.addEventListener('click', () => {
  questionType = 'aprobacion';
  containerCustomOptions.classList.add('hidden');
  tplAprobacion.className = 'px-2.5 py-2 text-xs font-bold bg-indigo-600 text-white rounded-xl shadow transition text-left';
  tplCandidatos.className = 'px-2.5 py-2 text-xs font-bold bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-xl border border-purple-200 text-left transition';
});

tplCandidatos.addEventListener('click', () => {
  questionType = 'seleccion';
  containerCustomOptions.classList.remove('hidden');
  tplCandidatos.className = 'px-2.5 py-2 text-xs font-bold bg-purple-600 text-white rounded-xl shadow transition text-left';
  tplAprobacion.className = 'px-2.5 py-2 text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl border border-indigo-200 text-left transition';

  if (customOptionsList.children.length === 0) {
    addCustomOptionInput('Candidato 1');
    addCustomOptionInput('Candidato 2');
    addCustomOptionInput('Voto en Blanco');
  }
});

function addCustomOptionInput(defaultVal = '') {
  const div = document.createElement('div');
  div.className = 'flex items-center space-x-1.5';
  div.innerHTML = `
    <input type="text" value="${defaultVal}" placeholder="Nombre de la opción o candidato" required class="flex-1 bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:bg-white focus:ring-2 focus:ring-purple-500">
    <button type="button" class="text-rose-500 hover:text-rose-700 text-xs px-2 py-1 font-bold">✕</button>
  `;
  div.querySelector('button').addEventListener('click', () => div.remove());
  customOptionsList.appendChild(div);
}

btnAddOption.addEventListener('click', () => addCustomOptionInput(''));

// Submit Question
formCreateQuestion.addEventListener('submit', async (e) => {
  e.preventDefault();
  await handleCreateQuestion(true);
});

btnSaveDraft.addEventListener('click', async () => {
  await handleCreateQuestion(false);
});

async function handleCreateQuestion(openImmediately) {
  const titulo = qInputTitulo.value.trim();
  const descripcion = qInputDesc.value.trim();

  if (!titulo) {
    alert('Ingresa el título de la pregunta.');
    return;
  }

  let opciones = [];
  if (questionType === 'seleccion') {
    const inputs = customOptionsList.querySelectorAll('input');
    inputs.forEach(inp => {
      const val = inp.value.trim();
      if (val) opciones.push(val);
    });
    if (opciones.length < 2) {
      alert('Para elección personalizada debes ingresar al menos 2 opciones.');
      return;
    }
  }

  try {
    const res = await fetch('/api/admin/questions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey
      },
      body: JSON.stringify({
        titulo,
        descripcion,
        tipo: questionType,
        opciones
      })
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Error al crear la pregunta');
      return;
    }

    // If open immediately requested
    if (openImmediately) {
      await fetch(`/api/admin/questions/${data.pregunta.id}/open`, {
        method: 'POST',
        headers: { 'x-admin-key': adminKey }
      });
    }

    qInputTitulo.value = '';
    qInputDesc.value = '';
    await fetchOverview();
  } catch (err) {
    alert('Error al procesar la solicitud.');
  }
}

// 8. Questions History Rendering
function renderQuestionsHistory(preguntas) {
  questionsHistoryList.innerHTML = '';
  if (!preguntas || preguntas.length === 0) {
    questionsHistoryList.innerHTML = '<p class="text-xs text-slate-400 italic text-center py-6">Aún no se han creado preguntas en esta sesión.</p>';
    return;
  }

  preguntas.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = 'border border-slate-200 rounded-xl p-4 bg-slate-50/50 hover:bg-white transition space-y-2';

    let badgeClass = 'bg-slate-200 text-slate-700';
    let badgeText = 'Borrador';
    if (p.estado === 'abierta') {
      badgeClass = 'bg-amber-100 text-amber-800 animate-pulse';
      badgeText = 'Abierta';
    } else if (p.estado === 'cerrada') {
      badgeClass = 'bg-emerald-100 text-emerald-800';
      badgeText = 'Cerrada';
    }

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div>
          <span class="text-[10px] font-extrabold text-slate-400 uppercase">#${idx + 1} &bull; ${p.tipo}</span>
          <h4 class="text-sm font-bold text-slate-900">${p.titulo}</h4>
          <span class="text-xs text-slate-500">${p.totalVotos} votos registrados</span>
        </div>
        <div class="flex items-center space-x-1.5">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeClass}">${badgeText}</span>
          ${p.estado === 'borrador' ? `<button class="btn-open-hist px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-lg" data-id="${p.id}">Abrir</button>` : ''}
          ${p.estado === 'abierta' ? `<button class="btn-close-hist px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold rounded-lg" data-id="${p.id}">Cerrar</button>` : ''}
          <button class="btn-del-hist text-slate-400 hover:text-rose-600 text-xs px-1 py-1 font-bold" data-id="${p.id}" title="Eliminar">🗑</button>
        </div>
      </div>
    `;

    // Listeners
    const btnOpen = card.querySelector('.btn-open-hist');
    if (btnOpen) {
      btnOpen.addEventListener('click', async () => {
        await fetch(`/api/admin/questions/${p.id}/open`, {
          method: 'POST',
          headers: { 'x-admin-key': adminKey }
        });
        await fetchOverview();
      });
    }

    const btnClose = card.querySelector('.btn-close-hist');
    if (btnClose) {
      btnClose.addEventListener('click', async () => {
        await fetch(`/api/admin/questions/${p.id}/close`, {
          method: 'POST',
          headers: { 'x-admin-key': adminKey }
        });
        await fetchOverview();
      });
    }

    const btnDel = card.querySelector('.btn-del-hist');
    if (btnDel) {
      btnDel.addEventListener('click', async () => {
        if (confirm('¿Deseas eliminar esta pregunta?')) {
          await fetch(`/api/admin/questions/${p.id}`, {
            method: 'DELETE',
            headers: { 'x-admin-key': adminKey }
          });
          await fetchOverview();
        }
      });
    }

    questionsHistoryList.appendChild(card);
  });
}

// 9. Attendance Modal Management
btnToggleAsistencia.addEventListener('click', () => {
  renderAttendanceModal();
  modalAsistencia.classList.remove('hidden');
});

btnCloseModalAsistencia.addEventListener('click', () => {
  modalAsistencia.classList.add('hidden');
});

function renderAttendanceModal() {
  modalAsistenciaContainer.innerHTML = '';
  const keys = Object.keys(towersData);
  const numericTowers = keys.filter(k => !isNaN(k)).map(Number).sort((a, b) => a - b);
  const nonNumericTowers = keys.filter(k => isNaN(k)).sort();
  const allTowers = [...numericTowers, ...nonNumericTowers];

  allTowers.forEach(tKey => {
    const aptos = towersData[tKey];
    if (!aptos) return;
    const towerBox = document.createElement('div');
    towerBox.className = 'border border-slate-200 rounded-xl p-3 bg-slate-50/50';

    let allTowerPresent = aptos.every(a => currentAsistenciaMap[a.id]);
    const isNum = !isNaN(tKey);
    const towerTitle = isNum ? `Torre ${tKey} (${aptos.length} aptos)` : `${tKey} (${aptos.length} unidad)`;
    const btnText = allTowerPresent
      ? (isNum ? 'Desmarcar Torre' : 'Desmarcar')
      : (isNum ? 'Marcar Toda la Torre' : 'Marcar Presente');

    towerBox.innerHTML = `
      <div class="flex items-center justify-between border-b border-slate-200 pb-2 mb-2">
        <span class="font-bold text-xs text-slate-800">${towerTitle}</span>
        <button class="btn-toggle-tower text-[11px] font-bold text-indigo-600 hover:text-indigo-800" data-torre="${tKey}">
          ${btnText}
        </button>
      </div>
      <div class="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
        ${aptos.map(a => `
          <label class="flex items-center space-x-1 text-xs cursor-pointer p-1 rounded hover:bg-white">
            <input type="checkbox" class="chk-apt-asistencia rounded text-indigo-600 focus:ring-indigo-500" data-id="${a.id}" ${currentAsistenciaMap[a.id] ? 'checked' : ''}>
            <span class="font-mono text-[11px]">${a.apto}</span>
          </label>
        `).join('')}
      </div>
    `;

    // Toggle entire tower
    towerBox.querySelector('.btn-toggle-tower').addEventListener('click', async () => {
      const willBePresent = !allTowerPresent;
      await fetch('/api/admin/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ torre: tKey, presente: willBePresent })
      });
      await fetchOverview();
      renderAttendanceModal();
    });

    // Toggle individual apartment
    towerBox.querySelectorAll('.chk-apt-asistencia').forEach(chk => {
      chk.addEventListener('change', async (e) => {
        const aptoId = e.target.getAttribute('data-id');
        const presente = e.target.checked;
        await fetch('/api/admin/attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
          body: JSON.stringify({ aptoId, presente })
        });
        await fetchOverview();
      });
    });

    modalAsistenciaContainer.appendChild(towerBox);
  });
}

btnMarkAll.addEventListener('click', async () => {
  await fetch('/api/admin/attendance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
    body: JSON.stringify({ todos: true })
  });
  await fetchOverview();
  renderAttendanceModal();
});

btnUnmarkAll.addEventListener('click', async () => {
  await fetch('/api/admin/attendance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
    body: JSON.stringify({ todos: false })
  });
  await fetchOverview();
  renderAttendanceModal();
});

// 10. Excel Export
btnExportExcel.addEventListener('click', () => {
  window.open(`/api/admin/export?adminKey=${adminKey}`, '_blank');
});

// Start
init();
