// Projection / Screen Share View Logic
let socket = null;

const projQuorumPct = document.getElementById('proj-quorum-pct');
const projQuorumAptos = document.getElementById('proj-quorum-aptos');
const projQuorumStatus = document.getElementById('proj-quorum-status');

const projViewStandby = document.getElementById('proj-view-standby');
const projViewActive = document.getElementById('proj-view-active');

const projStateBadge = document.getElementById('proj-state-badge');
const projQuestionTitle = document.getElementById('proj-question-title');
const projQuestionDesc = document.getElementById('proj-question-desc');
const projCountVoted = document.getElementById('proj-count-voted');
const projCountPct = document.getElementById('proj-count-pct');
const projOptionsBars = document.getElementById('proj-options-bars');

async function init() {
  initSocket();
  await fetchLiveProjection();
}

function initSocket() {
  if (socket) socket.disconnect();
  socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 30,
    reconnectionDelay: 1000
  });

  socket.on('connect', () => {
    socket.emit('join:proyeccion');
    fetchLiveProjection();
  });

  socket.on('reconnect', () => {
    socket.emit('join:proyeccion');
    fetchLiveProjection();
  });

  socket.on('stats:updated', (stats) => {
    renderStats(stats);
  });

  socket.on('quorum:updated', (quorum) => {
    renderQuorum(quorum);
  });

  socket.on('question:opened', async () => {
    await fetchLiveProjection();
  });

  socket.on('question:closed', async () => {
    await fetchLiveProjection();
  });
}

async function fetchLiveProjection() {
  try {
    const res = await fetch('/api/projection/live');
    const data = await res.json();
    renderQuorum(data.quorum);

    if (data.stats) {
      renderStats(data.stats);
    } else {
      projViewStandby.classList.remove('hidden');
      projViewActive.classList.add('hidden');
    }
  } catch (err) {
    console.error('Error fetching projection data:', err);
  }
}

function renderQuorum(quorum) {
  if (!quorum) return;

  projQuorumPct.textContent = `${quorum.quorumPorcentaje.toFixed(2)}%`;
  projQuorumAptos.textContent = `${quorum.apartamentosPresentes} / ${quorum.totalApartamentos}`;

  if (quorum.hayQuorumDeliberatorio) {
    projQuorumStatus.textContent = 'QUÓRUM VÁLIDO';
    projQuorumStatus.className = 'px-3 py-1 rounded-full text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
  } else {
    projQuorumStatus.textContent = 'QUÓRUM INSUFICIENTE';
    projQuorumStatus.className = 'px-3 py-1 rounded-full text-xs font-black bg-amber-500/20 text-amber-300 border border-amber-500/30';
  }
}

function renderStats(stats) {
  if (!stats) return;

  projViewStandby.classList.add('hidden');
  projViewActive.classList.remove('hidden');

  projQuestionTitle.textContent = stats.titulo;
  if (stats.descripcion) {
    projQuestionDesc.textContent = stats.descripcion;
    projQuestionDesc.classList.remove('hidden');
  } else {
    projQuestionDesc.classList.add('hidden');
  }

  if (stats.estado === 'abierta') {
    projStateBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400 mr-2 animate-ping"></span>VOTACIÓN EN CURSO`;
    projStateBadge.className = 'inline-flex items-center px-3.5 py-1 rounded-full text-xs font-black bg-amber-500/20 text-amber-300 border border-amber-500/30';
  } else {
    projStateBadge.innerHTML = `VOTACIÓN CERRADA &bull; RESULTADO OFICIAL`;
    projStateBadge.className = 'inline-flex items-center px-3.5 py-1 rounded-full text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
  }

  projCountVoted.textContent = `${stats.totalVotosEmitidos} / ${stats.totalHabilitadosParaVotar}`;
  projCountPct.textContent = `${stats.porcentajeParticipacionVoto}%`;

  projOptionsBars.innerHTML = '';
  stats.opciones.forEach(opt => {
    const card = document.createElement('div');
    card.className = 'bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3 shadow-lg';

    let barGradient = 'from-indigo-600 to-violet-500';
    const txt = opt.texto.trim().toUpperCase();
    if (txt === 'SÍ' || txt === 'SI') barGradient = 'from-emerald-600 to-teal-400';
    else if (txt === 'NO') barGradient = 'from-rose-600 to-pink-500';
    else if (txt.includes('BLANCO')) barGradient = 'from-slate-600 to-slate-400';

    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <span class="text-xl sm:text-2xl font-black text-white">${opt.texto}</span>
          <span class="text-xs sm:text-sm text-slate-400 ml-3 font-semibold">(${opt.votosNominales} apartamentos &bull; ${opt.porcentajeNominal}%)</span>
        </div>
        <div class="text-right">
          <span class="text-2xl sm:text-3xl font-black text-emerald-400">${opt.coeficienteSuma.toFixed(4)}%</span>
          <span class="text-xs text-slate-400 block font-bold">
            ${opt.porcentajeSobrePresentes}% sobre presentes | ${opt.porcentajeSobreTotal}% del total copropiedad
          </span>
        </div>
      </div>
      <div class="w-full bg-slate-950 rounded-full h-5 p-0.5 border border-slate-800 overflow-hidden">
        <div class="bg-gradient-to-r ${barGradient} h-4 rounded-full transition-all duration-500" style="width: ${Math.min(opt.porcentajeSobrePresentes, 100)}%"></div>
      </div>
    `;

    projOptionsBars.appendChild(card);
  });
}

init();
