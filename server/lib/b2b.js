// Agregação do painel B2B (marcas/indústrias). Função PURA: recebe pedidos já filtrados por marca e devolve as métricas.
const PONTUAL_TOL_MIN = 10;
const ms = (t) => (t?.toMillis ? t.toMillis() : typeof t === "number" ? t : 0);
const nomeCurto = (n) => { const p = String(n || "Promotor").trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0]; };
const regiaoDe = (o) => (o.regiao?.cidade ? `${o.regiao.cidade}/${o.regiao.uf || ""}`.replace(/\/$/, "") : "Não informada");
const arred = (n, c = 1) => Math.round(n * 10 ** c) / 10 ** c;

/** @param pedidos [{id, ...solicitacao}]  @param opts { desdeMs, regiao, instanteSP(data,hhmm), agora } */
function agregar(pedidos, { desdeMs = 0, regiao = "", instanteSP, agora = Date.now() } = {}) {
  const todos = pedidos.filter((o) => (ms(o.criadoEm) || 0) >= desdeMs && (!regiao || regiaoDe(o) === regiao));
  const exec = todos.filter((o) => o.fase === "executada" && o.checkin?.em && o.checkout?.em);
  const andamento = todos.filter((o) => o.fase === "em_andamento");
  const horas = (o) => (o.checkout?.minutosNoLocal ?? Math.round((ms(o.checkout.em) - ms(o.checkin.em)) / 60000)) / 60;
  const cheia = exec.filter((o) => o.checkout.gondola === "cheia").length;
  const porRegiao = new Map(), porProm = new Map();
  for (const o of exec) {
    const r = regiaoDe(o), a = porRegiao.get(r) || { regiao: r, horas: 0, chamados: 0, cheia: 0 };
    a.horas += horas(o); a.chamados++; if (o.checkout.gondola === "cheia") a.cheia++; porRegiao.set(r, a);
    const pid = o.promotorUid, p = porProm.get(pid) || { nome: nomeCurto(o.promotorNome), nivel: o.promotorNivel || "bronze", chamados: 0, horas: 0, cheia: 0, pontuais: 0, comHorario: 0, notas: [] };
    p.chamados++; p.horas += horas(o); if (o.checkout.gondola === "cheia") p.cheia++;
    if (instanteSP && o.data && o.entrada) { p.comHorario++; if (ms(o.checkin.em) <= instanteSP(o.data, o.entrada) + PONTUAL_TOL_MIN * 60000) p.pontuais++; }
    if (o.avaliacao?.estrelas) p.notas.push(o.avaliacao.estrelas);
    porProm.set(pid, p);
  }
  const ranking = [...porProm.values()].map((p) => {
    const comp = [[0.4, p.cheia / p.chamados]]; if (p.comHorario) comp.push([0.3, p.pontuais / p.comHorario]); if (p.notas.length) comp.push([0.3, p.notas.reduce((a, b) => a + b, 0) / p.notas.length / 5]);
    const score = Math.round((100 * comp.reduce((a, [w, v]) => a + w * v, 0)) / comp.reduce((a, [w]) => a + w, 0));
    return { nome: p.nome, nivel: p.nivel, chamados: p.chamados, horas: arred(p.horas), taxaCheia: Math.round((100 * p.cheia) / p.chamados), pontualidade: p.comHorario ? Math.round((100 * p.pontuais) / p.comHorario) : null, nota: p.notas.length ? arred(p.notas.reduce((a, b) => a + b, 0) / p.notas.length) : null, score };
  }).sort((a, b) => b.score - a.score || b.chamados - a.chamados).slice(0, 10);
  const recentes = [...exec].sort((a, b) => ms(b.checkout.em) - ms(a.checkout.em));
  return {
    kpis: { chamados: todos.length, executados: exec.length, emAndamento: andamento.length, horasTotal: arred(exec.reduce((a, o) => a + horas(o), 0)), taxaGondolaCheia: exec.length ? Math.round((100 * cheia) / exec.length) : null,
      fotosAuditoria: exec.length, promotores: porProm.size, checkinsNegados: todos.reduce((a, o) => a + (o.checkinNegados || 0), 0), auditoriaContestada: exec.filter((o) => o.auditoriaLoja?.resultado === "contestada").length },
    porRegiao: [...porRegiao.values()].map((a) => ({ regiao: a.regiao, horas: arred(a.horas), chamados: a.chamados, taxaCheia: Math.round((100 * a.cheia) / a.chamados) })).sort((a, b) => b.horas - a.horas),
    regioes: [...new Set(pedidos.map(regiaoDe))].sort(),
    ranking,
    aoVivo: andamento.map((o) => ({ loja: o.loja, regiao: regiaoDe(o), promotor: nomeCurto(o.promotorNome), desde: ms(o.checkin?.em) })),
    presencas: recentes.slice(0, 40).map((o) => ({ id: o.id, loja: o.loja, regiao: regiaoDe(o), promotor: nomeCurto(o.promotorNome), entrada: ms(o.checkin.em), saida: ms(o.checkout.em), minutos: o.checkout.minutosNoLocal ?? null,
      distanciaM: o.checkin.distanciaM ?? null, precisaoM: o.checkin.precisaoM ?? null, noRaio: o.checkin.noRaio === true, simulado: !!o.checkin.simulado, saidaNoRaio: o.checkout.noRaio ?? null })),
    fotosIds: recentes.slice(0, 24).map((o) => ({ id: o.id, loja: o.loja, promotor: nomeCurto(o.promotorNome), em: ms(o.checkout.em), gondola: o.checkout.gondola, auditoria: o.auditoriaLoja?.resultado || null }))
  };
}
module.exports = { agregar, nomeCurto, regiaoDe };
