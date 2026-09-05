const xlsx = require('xlsx');

function generarReporteExcel(store) {
  const wb = xlsx.utils.book_new();

  // Sheet 1: Resumen General y Quórum
  const quorum = store.getQuorumInfo();
  const resumenRows = [
    { 'MÉTRICA': 'Total Apartamentos Copropiedad', 'VALOR': quorum.totalApartamentos },
    { 'MÉTRICA': 'Coeficiente Total Copropiedad', 'VALOR': `${quorum.totalCoeficienteGeneral}%` },
    { 'MÉTRICA': 'Apartamentos Registrados / Presentes', 'VALOR': quorum.apartamentosPresentes },
    { 'MÉTRICA': 'Coeficiente Presente (Quórum)', 'VALOR': `${quorum.coeficientePresente}%` },
    { 'MÉTRICA': 'Porcentaje de Quórum Registrado', 'VALOR': `${quorum.quorumPorcentaje}%` },
    { 'MÉTRICA': 'Estado del Quórum', 'VALOR': quorum.hayQuorumDeliberatorio ? 'VÁLIDO (Mayor al 50%)' : 'NO DELIBERATORIO' },
    { 'MÉTRICA': 'Fecha de Generación del Informe', 'VALOR': new Date().toLocaleString('es-CO') }
  ];
  const wsResumen = xlsx.utils.json_to_sheet(resumenRows);
  wsResumen['!cols'] = [{ wch: 35 }, { wch: 30 }];
  xlsx.utils.book_append_sheet(wb, wsResumen, 'RESUMEN_QUORUM');

  // Sheet 2: Resumen de Resultados por Pregunta
  const resultadosRows = [];
  for (let i = 0; i < store.state.preguntas.length; i++) {
    const preg = store.state.preguntas[i];
    const stats = store.calcularEstadisticas(preg.id);
    if (!stats) continue;

    for (const opt of stats.opciones) {
      resultadosRows.push({
        '# PREGUNTA': i + 1,
        'TÍTULO PREGUNTA': preg.titulo,
        'ESTADO': preg.estado.toUpperCase(),
        'OPCIÓN': opt.texto,
        'VOTOS NOMINALES (APTOS)': opt.votosNominales,
        '% NOMINAL': `${opt.porcentajeNominal}%`,
        'COEFICIENTE SUMA': `${opt.coeficienteSuma}%`,
        '% SOBRE PRESENTES (MAYORÍA SIMPLE)': `${opt.porcentajeSobrePresentes}%`,
        '% SOBRE TOTAL COPROPIEDAD (MAYORÍA CALIFICADA)': `${opt.porcentajeSobreTotal}%`,
        'INICIO': preg.horaInicio ? new Date(preg.horaInicio).toLocaleTimeString('es-CO') : 'N/A',
        'CIERRE': preg.horaCierre ? new Date(preg.horaCierre).toLocaleTimeString('es-CO') : 'N/A'
      });
    }
  }

  if (resultadosRows.length > 0) {
    const wsResultados = xlsx.utils.json_to_sheet(resultadosRows);
    wsResultados['!cols'] = [
      { wch: 12 }, { wch: 40 }, { wch: 12 }, { wch: 20 },
      { wch: 24 }, { wch: 14 }, { wch: 20 }, { wch: 35 },
      { wch: 42 }, { wch: 12 }, { wch: 12 }
    ];
    xlsx.utils.book_append_sheet(wb, wsResultados, 'RESULTADOS_PREGUNTAS');
  }

  // Sheet 3: Auditoría Voto a Voto (Todas las preguntas)
  const auditoriaRows = [];
  for (let i = 0; i < store.state.preguntas.length; i++) {
    const preg = store.state.preguntas[i];
    const votosList = Object.values(preg.votos);

    for (const v of votosList) {
      auditoriaRows.push({
        '# PREGUNTA': i + 1,
        'PREGUNTA': preg.titulo,
        'TORRE': v.torre,
        'APARTAMENTO': v.apto,
        'IDENTIFICADOR': v.aptoId,
        'COEFICIENTE APLICADO (%)': v.coeficiente,
        'VOTO REGISTRADO': v.opcionTexto,
        'FECHA Y HORA': new Date(v.timestamp).toLocaleString('es-CO')
      });
    }
  }

  if (auditoriaRows.length > 0) {
    const wsAuditoria = xlsx.utils.json_to_sheet(auditoriaRows);
    wsAuditoria['!cols'] = [
      { wch: 12 }, { wch: 35 }, { wch: 8 }, { wch: 14 },
      { wch: 16 }, { wch: 24 }, { wch: 20 }, { wch: 22 }
    ];
    xlsx.utils.book_append_sheet(wb, wsAuditoria, 'AUDITORIA_VOTO_A_VOTO');
  }

  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { generarReporteExcel };
