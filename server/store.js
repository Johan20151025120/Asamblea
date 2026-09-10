const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'data', 'assembly_state.json');
const STATE_TEMP_FILE = path.join(__dirname, '..', 'data', 'assembly_state.tmp');

class AssemblyStore {
  constructor(apartments) {
    this.apartments = apartments; // array of 468 apartments
    this.apartmentsMap = new Map();
    this.tokenMap = new Map();
    this.totalCoeficienteGeneral = 0;

    for (const apt of apartments) {
      this.apartmentsMap.set(apt.id, apt);
      this.apartmentsMap.set(`${apt.torre}-${apt.apto}`, apt);
      this.tokenMap.set(apt.token, apt);
      this.totalCoeficienteGeneral += apt.coeficiente;
    }

    this.state = {
      asistencia: {},
      autoAsistencia: true,
      preguntas: [],
      preguntaActivaId: null
    };

    this._saveTimeout = null;
    this._isSaving = false;
    this._hasPendingSave = false;

    this.loadState();

    // Ensure save on process exit
    process.on('beforeExit', () => this.flushSaveSync());
  }

  loadState() {
    if (fs.existsSync(STATE_FILE)) {
      try {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        this.state = {
          ...this.state,
          ...parsed
        };
        console.log(`Loaded assembly state. Questions: ${this.state.preguntas.length}, Active Question: ${this.state.preguntaActivaId}`);
      } catch (err) {
        console.warn('Could not read state file, starting fresh:', err.message);
      }
    }
  }

  /**
   * High-concurrency debounced async persistence.
   * Never blocks the Node.js event loop during vote bursts.
   */
  scheduleSave() {
    if (this._saveTimeout) return;
    this._saveTimeout = setTimeout(() => {
      this._saveTimeout = null;
      this._persistAsync();
    }, 250); // Save to disk at most 4 times a second during heavy traffic
  }

  async _persistAsync() {
    if (this._isSaving) {
      this._hasPendingSave = true;
      return;
    }

    this._isSaving = true;
    try {
      const dataStr = JSON.stringify(this.state, null, 2);
      await fs.promises.writeFile(STATE_TEMP_FILE, dataStr, 'utf8');
      await fs.promises.rename(STATE_TEMP_FILE, STATE_FILE);
    } catch (err) {
      console.error('Error saving state asynchronously:', err.message);
    } finally {
      this._isSaving = false;
      if (this._hasPendingSave) {
        this._hasPendingSave = false;
        this.scheduleSave();
      }
    }
  }

  flushSaveSync() {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
      this._saveTimeout = null;
    }
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      console.error('Error flushing state on exit:', err);
    }
  }

  // Quórum & Attendance
  marcarAsistencia(aptoId, presente = true, skipSave = false) {
    if (this.apartmentsMap.has(aptoId)) {
      if (presente) {
        this.state.asistencia[aptoId] = {
          fechaRegistro: new Date().toISOString()
        };
      } else {
        delete this.state.asistencia[aptoId];
      }
      if (!skipSave) this.scheduleSave();
      return true;
    }
    return false;
  }

  marcarTodos(presente = true) {
    if (presente) {
      const now = new Date().toISOString();
      for (const apt of this.apartments) {
        this.state.asistencia[apt.id] = { fechaRegistro: now };
      }
    } else {
      this.state.asistencia = {};
    }
    this.scheduleSave();
  }

  marcarTorre(torreNum, presente = true) {
    const now = new Date().toISOString();
    for (const apt of this.apartments) {
      if (String(apt.torre) === String(torreNum)) {
        if (presente) {
          this.state.asistencia[apt.id] = { fechaRegistro: now };
        } else {
          delete this.state.asistencia[apt.id];
        }
      }
    }
    this.scheduleSave();
  }

  getQuorumInfo() {
    const presentIds = Object.keys(this.state.asistencia);
    let coefPresente = 0;
    for (const id of presentIds) {
      const apt = this.apartmentsMap.get(id);
      if (apt) {
        coefPresente += apt.coeficiente;
      }
    }

    const quorumPorcentaje = this.totalCoeficienteGeneral > 0
      ? (coefPresente / this.totalCoeficienteGeneral) * 100
      : 0;

    return {
      totalApartamentos: this.apartments.length,
      apartamentosPresentes: presentIds.length,
      coeficientePresente: Number(coefPresente.toFixed(4)),
      totalCoeficienteGeneral: Number(this.totalCoeficienteGeneral.toFixed(4)),
      quorumPorcentaje: Number(quorumPorcentaje.toFixed(2)),
      hayQuorumDeliberatorio: quorumPorcentaje >= 50.0
    };
  }

  // Authentication
  authenticate(torre, apto, pin) {
    const id = `${torre}-${apto}`;
    const apt = this.apartmentsMap.get(id) || this.apartmentsMap.get(torre) || this.apartmentsMap.get('AR-Construcciones');
    if (!apt) return null;
    if (apt.pin === String(pin).trim()) {
      if (this.state.autoAsistencia && !this.state.asistencia[apt.id]) {
        this.marcarAsistencia(apt.id, true);
      }
      return apt;
    }
    return null;
  }

  authenticateByToken(token) {
    if (!token) return null;
    const apt = this.tokenMap.get(String(token).trim());
    if (apt) {
      if (this.state.autoAsistencia && !this.state.asistencia[apt.id]) {
        this.marcarAsistencia(apt.id, true);
      }
      return apt;
    }
    return null;
  }

  // Questions Management
  crearPregunta({ titulo, descripcion, tipo = 'aprobacion', opciones = [] }) {
    const id = 'pregunta_' + Date.now();
    let finalOptions = [];

    if (tipo === 'aprobacion') {
      finalOptions = [
        { id: 'opt_si', texto: 'SÍ' },
        { id: 'opt_no', texto: 'NO' },
        { id: 'opt_blanco', texto: 'EN BLANCO' }
      ];
    } else {
      finalOptions = opciones.map((opt, idx) => ({
        id: `opt_${idx + 1}`,
        texto: typeof opt === 'string' ? opt.trim() : opt.texto
      }));
    }

    const nuevaPregunta = {
      id,
      titulo: titulo.trim(),
      descripcion: (descripcion || '').trim(),
      tipo,
      opciones: finalOptions,
      estado: 'borrador',
      horaCreacion: new Date().toISOString(),
      horaInicio: null,
      horaCierre: null,
      votos: {} // aptoId -> { opcionId, timestamp, coeficiente }
    };

    this.state.preguntas.push(nuevaPregunta);
    this.scheduleSave();
    return nuevaPregunta;
  }

  abrirPregunta(preguntaId) {
    const preg = this.state.preguntas.find(p => p.id === preguntaId);
    if (!preg) throw new Error('Pregunta no encontrada');

    if (this.state.preguntaActivaId && this.state.preguntaActivaId !== preguntaId) {
      this.cerrarPregunta(this.state.preguntaActivaId);
    }

    preg.estado = 'abierta';
    preg.horaInicio = new Date().toISOString();
    this.state.preguntaActivaId = preguntaId;
    this.scheduleSave();
    return preg;
  }

  cerrarPregunta(preguntaId) {
    const preg = this.state.preguntas.find(p => p.id === preguntaId);
    if (!preg) throw new Error('Pregunta no encontrada');

    preg.estado = 'cerrada';
    preg.horaCierre = new Date().toISOString();
    if (this.state.preguntaActivaId === preguntaId) {
      this.state.preguntaActivaId = null;
    }
    this.scheduleSave();
    return preg;
  }

  eliminarPregunta(preguntaId) {
    const idx = this.state.preguntas.findIndex(p => p.id === preguntaId);
    if (idx !== -1) {
      if (this.state.preguntaActivaId === preguntaId) {
        this.state.preguntaActivaId = null;
      }
      this.state.preguntas.splice(idx, 1);
      this.scheduleSave();
      return true;
    }
    return false;
  }

  getPreguntaActiva() {
    if (!this.state.preguntaActivaId) return null;
    return this.state.preguntas.find(p => p.id === this.state.preguntaActivaId) || null;
  }

  // Voting Engine (Strict anti-double voting & instant O(1) in-memory performance)
  emitirVoto(preguntaId, aptoId, opcionId) {
    const preg = this.state.preguntas.find(p => p.id === preguntaId);
    if (!preg) {
      return { success: false, error: 'Pregunta no encontrada.' };
    }
    if (preg.estado !== 'abierta') {
      return { success: false, error: 'Esta votación ya se encuentra cerrada.' };
    }

    const apt = this.apartmentsMap.get(aptoId);
    if (!apt) {
      return { success: false, error: 'Apartamento no registrado en el sistema.' };
    }

    // Atomic in-memory check against double-voting
    if (preg.votos[aptoId]) {
      return {
        success: false,
        error: 'Este apartamento ya emitió su voto para esta pregunta.',
        votoPrevio: preg.votos[aptoId]
      };
    }

    const opcionValida = preg.opciones.find(o => o.id === opcionId);
    if (!opcionValida) {
      return { success: false, error: 'Opción de voto inválida.' };
    }

    // Record vote
    const voto = {
      aptoId,
      torre: apt.torre,
      apto: apt.apto,
      coeficiente: apt.coeficiente,
      opcionId,
      opcionTexto: opcionValida.texto,
      timestamp: new Date().toISOString()
    };

    preg.votos[aptoId] = voto;

    // Ensure marked present without blocking disk write
    if (!this.state.asistencia[aptoId]) {
      this.state.asistencia[aptoId] = { fechaRegistro: voto.timestamp };
    }

    // Schedule non-blocking async persistence
    this.scheduleSave();
    return { success: true, voto };
  }

  // Real-time Statistics Calculator (Cached / In-memory O(Votos))
  calcularEstadisticas(preguntaId) {
    const preg = this.state.preguntas.find(p => p.id === preguntaId);
    if (!preg) return null;

    const quorum = this.getQuorumInfo();
    const votosMap = preg.votos;
    const votosList = Object.values(votosMap);
    const totalVotos = votosList.length;

    let sumaCoefVotaron = 0;

    const statsOpciones = preg.opciones.map(opt => ({
      id: opt.id,
      texto: opt.texto,
      votosNominales: 0,
      coeficienteSuma: 0,
      porcentajeNominal: 0,
      porcentajeSobrePresentes: 0,
      porcentajeSobreTotal: 0
    }));

    const optLookup = new Map(statsOpciones.map(s => [s.id, s]));

    for (let i = 0; i < votosList.length; i++) {
      const v = votosList[i];
      sumaCoefVotaron += v.coeficiente;
      const target = optLookup.get(v.opcionId);
      if (target) {
        target.votosNominales += 1;
        target.coeficienteSuma += v.coeficiente;
      }
    }

    for (const s of statsOpciones) {
      s.coeficienteSuma = Number(s.coeficienteSuma.toFixed(4));
      s.porcentajeNominal = totalVotos > 0
        ? Number(((s.votosNominales / totalVotos) * 100).toFixed(2))
        : 0;
      s.porcentajeSobrePresentes = quorum.coeficientePresente > 0
        ? Number(((s.coeficienteSuma / quorum.coeficientePresente) * 100).toFixed(2))
        : 0;
      s.porcentajeSobreTotal = quorum.totalCoeficienteGeneral > 0
        ? Number(((s.coeficienteSuma / quorum.totalCoeficienteGeneral) * 100).toFixed(2))
        : 0;
    }

    const presentIds = Object.keys(this.state.asistencia);
    const targetPool = presentIds.length > 0
      ? presentIds.map(id => this.apartmentsMap.get(id)).filter(Boolean)
      : this.apartments;

    const faltantesPorTorre = {};
    let faltantesCount = 0;
    let faltantesCoef = 0;

    for (let i = 0; i < targetPool.length; i++) {
      const apt = targetPool[i];
      if (!votosMap[apt.id]) {
        faltantesCount++;
        faltantesCoef += apt.coeficiente;
        if (!faltantesPorTorre[apt.torre]) {
          faltantesPorTorre[apt.torre] = [];
        }
        faltantesPorTorre[apt.torre].push({
          id: apt.id,
          apto: apt.apto,
          coeficiente: apt.coeficiente
        });
      }
    }

    for (const t in faltantesPorTorre) {
      faltantesPorTorre[t].sort((a, b) => {
        const numA = parseInt(a.apto, 10);
        const numB = parseInt(b.apto, 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return String(a.apto).localeCompare(String(b.apto));
      });
    }

    return {
      preguntaId: preg.id,
      titulo: preg.titulo,
      tipo: preg.tipo,
      estado: preg.estado,
      horaInicio: preg.horaInicio,
      horaCierre: preg.horaCierre,
      opciones: statsOpciones,
      quorum,
      totalHabilitadosParaVotar: targetPool.length,
      totalVotosEmitidos: totalVotos,
      coeficienteVotado: Number(sumaCoefVotaron.toFixed(4)),
      porcentajeParticipacionVoto: targetPool.length > 0
        ? Number(((totalVotos / targetPool.length) * 100).toFixed(2))
        : 0,
      faltantes: {
        total: faltantesCount,
        coeficiente: Number(faltantesCoef.toFixed(4)),
        porTorre: faltantesPorTorre
      }
    };
  }
}

module.exports = AssemblyStore;
