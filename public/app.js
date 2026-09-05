// Resident Voting Logic
let socket = null;
let currentApto = null;
let activeQuestion = null;
let selectedOptionId = null;
let towersData = {};

// DOM Elements
const viewLogin = document.getElementById('view-login');
const viewVoter = document.getElementById('view-voter');
const selectTorre = document.getElementById('select-torre');
const selectApto = document.getElementById('select-apto');
const inputPin = document.getElementById('input-pin');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const headerBadge = document.getElementById('header-user-badge');

const voterNombreApto = document.getElementById('voter-nombre-apto');
const voterCoeficiente = document.getElementById('voter-coeficiente');
const btnLogout = document.getElementById('btn-logout');

const cardWaiting = document.getElementById('card-waiting');
const cardVoting = document.getElementById('card-voting');
const cardConfirmed = document.getElementById('card-confirmed');

const votingTitulo = document.getElementById('voting-titulo');
const votingDescripcion = document.getElementById('voting-descripcion');
const votingOptions = document.getElementById('voting-options');

const confirmedOpcion = document.getElementById('confirmed-opcion');
const confirmedCoeficiente = document.getElementById('confirmed-coeficiente');
const confirmedHora = document.getElementById('confirmed-hora');

const modalConfirm = document.getElementById('modal-confirm');
const modalOpcionText = document.getElementById('modal-opcion-text');
const modalCoefText = document.getElementById('modal-coef-text');
const modalBtnCancel = document.getElementById('modal-btn-cancel');
const modalBtnConfirm = document.getElementById('modal-btn-confirm');

// 1. Initial Load & URL Parameters check
async function init() {
  await loadTowersConfig();

  // Check URL params for direct link: ?token=xxx OR ?t=1&a=101&pin=1234
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const t = params.get('t') || params.get('torre');
  const a = params.get('a') || params.get('apto');
  const pin = params.get('pin');

  if (token) {
    await loginWithToken(token);
    return;
  }

  if (t && a && pin) {
    await loginWithCredentials(t, a, pin);
    return;
  }

  // Check localStorage session
  const savedToken = localStorage.getItem('asamblea_voter_token');
  if (savedToken) {
    await loginWithToken(savedToken);
  }
}

async function loadTowersConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    towersData = data.towers || {};

    selectTorre.innerHTML = '<option value="">Selecciona tu Torre...</option>';
    const torreNums = Object.keys(towersData).map(Number).sort((a, b) => a - b);
    for (const num of torreNums) {
      const opt = document.createElement('option');
      opt.value = num;
      opt.textContent = `Torre ${num}`;
      selectTorre.appendChild(opt);
    }
  } catch (err) {
    console.error('Error cargando configuración:', err);
  }
}

selectTorre.addEventListener('change', () => {
  const torreVal = selectTorre.value;
  selectApto.innerHTML = '<option value="">Selecciona tu Apartamento...</option>';

  if (torreVal && towersData[torreVal]) {
    selectApto.disabled = false;
    selectApto.classList.remove('bg-slate-100');
    selectApto.classList.add('bg-slate-50');

    // Sort aptos numerically
    const aptos = [...towersData[torreVal]].sort((a, b) => parseInt(a.apto) - parseInt(b.apto));
    for (const apt of aptos) {
      const opt = document.createElement('option');
      opt.value = apt.apto;
      opt.textContent = `Apto ${apt.apto}`;
      selectApto.appendChild(opt);
    }
  } else {
    selectApto.disabled = true;
    selectApto.classList.add('bg-slate-100');
    selectApto.classList.remove('bg-slate-50');
  }
});

// Form Login
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');

  const torre = selectTorre.value;
  const apto = selectApto.value;
  const pin = inputPin.value.trim();

  await loginWithCredentials(torre, apto, pin);
});

async function loginWithCredentials(torre, apto, pin) {
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ torre, apto, pin })
    });
    const data = await res.json();

    if (!res.ok) {
      showLoginError(data.error || 'Credenciales incorrectas');
      return;
    }

    onLoginSuccess(data.apartment);
  } catch (err) {
    showLoginError('Error de conexión con el servidor.');
  }
}

async function loginWithToken(token) {
  try {
    const res = await fetch('/api/auth-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();

    if (!res.ok) {
      localStorage.removeItem('asamblea_voter_token');
      return;
    }

    onLoginSuccess(data.apartment);
  } catch (err) {
    console.error('Error logging in with token:', err);
  }
}

function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove('hidden');
}

function onLoginSuccess(apartment) {
  currentApto = apartment;
  localStorage.setItem('asamblea_voter_token', apartment.token);

  voterNombreApto.textContent = apartment.nombreCompleto;
  voterCoeficiente.textContent = `${apartment.coeficiente.toFixed(4)}%`;

  viewLogin.classList.add('hidden');
  viewVoter.classList.remove('hidden');
  headerBadge.classList.remove('hidden');

  initSocket(apartment.token);
  fetchVoterState();
}

btnLogout.addEventListener('click', () => {
  localStorage.removeItem('asamblea_voter_token');
  window.location.href = '/';
});

// 2. Fetch current voter state (active question & my vote)
async function fetchVoterState() {
  if (!currentApto) return;
  try {
    const res = await fetch('/api/voter/state', {
      headers: { 'x-voter-token': currentApto.token }
    });
    const data = await res.json();

    if (data.activeQuestion && data.activeQuestion.estado === 'abierta') {
      activeQuestion = data.activeQuestion;
      if (data.myVote) {
        showVoteConfirmed(data.myVote);
      } else {
        renderActiveQuestion(data.activeQuestion);
      }
    } else {
      activeQuestion = null;
      showWaiting();
    }
  } catch (err) {
    console.error('Error fetching voter state:', err);
  }
}

// 3. Socket.io Real-Time Synchronization with Auto-Reconnect
function initSocket(token) {
  if (socket) socket.disconnect();
  socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 1000
  });

  socket.on('connect', () => {
    socket.emit('join:voter', token);
    fetchVoterState();
  });

  socket.on('reconnect', () => {
    socket.emit('join:voter', token);
    fetchVoterState();
  });

  socket.on('question:opened', (question) => {
    activeQuestion = question;
    renderActiveQuestion(question);
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
  });

  socket.on('question:closed', () => {
    activeQuestion = null;
    showWaiting();
  });

  socket.on('voter:confirmed', (vote) => {
    showVoteConfirmed(vote);
  });
}

function showWaiting() {
  cardWaiting.classList.remove('hidden');
  cardVoting.classList.add('hidden');
  cardConfirmed.classList.add('hidden');
}

function renderActiveQuestion(question) {
  cardWaiting.classList.add('hidden');
  cardConfirmed.classList.add('hidden');
  cardVoting.classList.remove('hidden');

  votingTitulo.textContent = question.titulo;
  if (question.descripcion) {
    votingDescripcion.textContent = question.descripcion;
    votingDescripcion.classList.remove('hidden');
  } else {
    votingDescripcion.classList.add('hidden');
  }

  votingOptions.innerHTML = '';

  question.opciones.forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'w-full py-4 px-4 rounded-xl font-bold text-sm text-left flex items-center justify-between border-2 transition touch-btn active:scale-[0.98]';

    const txtUpper = opt.texto.trim().toUpperCase();
    if (txtUpper === 'SÍ' || txtUpper === 'SI') {
      btn.className += ' border-emerald-500/80 bg-emerald-50 text-emerald-900 hover:bg-emerald-100';
    } else if (txtUpper === 'NO') {
      btn.className += ' border-rose-500/80 bg-rose-50 text-rose-900 hover:bg-rose-100';
    } else if (txtUpper.includes('BLANCO')) {
      btn.className += ' border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100';
    } else {
      btn.className += ' border-indigo-200 bg-indigo-50/50 text-indigo-900 hover:bg-indigo-100/60';
    }

    btn.innerHTML = `
      <span>${opt.texto}</span>
      <span class="w-6 h-6 rounded-full border border-current flex items-center justify-center text-xs opacity-70">➔</span>
    `;

    btn.addEventListener('click', () => promptConfirmVote(opt));
    votingOptions.appendChild(btn);
  });
}

function promptConfirmVote(option) {
  selectedOptionId = option.id;
  modalOpcionText.textContent = option.texto;
  modalCoefText.textContent = `${currentApto.coeficiente.toFixed(4)}%`;
  modalConfirm.classList.remove('hidden');
}

modalBtnCancel.addEventListener('click', () => {
  modalConfirm.classList.add('hidden');
  selectedOptionId = null;
});

modalBtnConfirm.addEventListener('click', async () => {
  if (!selectedOptionId || !activeQuestion || !currentApto) return;

  modalBtnConfirm.disabled = true;
  modalBtnConfirm.textContent = 'Enviando...';

  try {
    const res = await fetch('/api/voter/vote', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-voter-token': currentApto.token
      },
      body: JSON.stringify({
        preguntaId: activeQuestion.id,
        opcionId: selectedOptionId
      })
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.votoPrevio) {
        modalConfirm.classList.add('hidden');
        showVoteConfirmed(data.votoPrevio);
        return;
      }
      alert(data.error || 'Error al emitir el voto');
      modalConfirm.classList.add('hidden');
      return;
    }

    modalConfirm.classList.add('hidden');
    showVoteConfirmed(data.voto);
  } catch (err) {
    // Retry once automatically on fetch network glitch
    try {
      const retryState = await fetch('/api/voter/state', {
        headers: { 'x-voter-token': currentApto.token }
      });
      const stData = await retryState.json();
      if (stData.myVote) {
        modalConfirm.classList.add('hidden');
        showVoteConfirmed(stData.myVote);
        return;
      }
    } catch (e) {}
    alert('Error al enviar el voto. Por favor verifica tu conexión y vuelve a intentar.');
  } finally {
    modalBtnConfirm.disabled = false;
    modalBtnConfirm.textContent = 'Sí, Confirmar';
  }
});

function showVoteConfirmed(vote) {
  cardWaiting.classList.add('hidden');
  cardVoting.classList.add('hidden');
  cardConfirmed.classList.remove('hidden');

  confirmedOpcion.textContent = vote.opcionTexto;
  confirmedCoeficiente.textContent = `${Number(vote.coeficiente).toFixed(4)}%`;
  confirmedHora.textContent = new Date(vote.timestamp).toLocaleTimeString('es-CO');
}

// Start
init();
