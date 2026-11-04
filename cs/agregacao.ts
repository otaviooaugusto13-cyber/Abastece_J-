/**
 * CS & B2B — AGREGAÇÕES (funções PURAS: recebem dados já carregados e devolvem métricas; sem Firestore, sem relógio global).
 * É aqui que cada número do painel nasce — por isso é testável sem rede (test/cs.test.ts).
 */
import type {
  ParametrosCS, MetricaFillRate, VagaDesatendida, Indicadores, MetricaCsat, MetricaPontualidade, MesRoi, MetricaRoi, MetricaRuptura, LinhaSetor,
  NivelChurn, LojaChurn, MetricaChurn, ContaChave, LinhaMarca, LinhaFaturamento, AlertaFaturamento, MetricaNps, PainelCS, EnvioNps, ModeloFaturamento, TipoLancamento
} from "./tipos";
import { SETORES_DESTAQUE } from "./tipos";

export const MIN = 60_000, HORA = 3_600_000, DIA = 86_400_000;
export const JANELA_DIAS = 125;          // quanto histórico o servidor carrega (cobre churn de 90 d e 4 meses de ROI)
export const MESES_ROI = 4;

// ───────────────────────── tempo (America/Sao_Paulo = UTC-3 fixo desde 2019) ─────────────────────────
export const instanteSP = (data: string, hhmm: string): number => Date.parse(`${data}T${hhmm}:00-03:00`);
export const hojeSP = (agora: number): string => new Date(agora - 3 * HORA).toISOString().slice(0, 10);
export const somaDias = (iso: string, n: number): string => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const segunda = (iso: string): string => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const diasNoMes = (mes: string): number => { const [a, m] = mes.split("-").map(Number); return new Date(Date.UTC(a, m, 0)).getUTCDate(); };
export function mesesRecentes(agora: number, n: number): string[] {
  const [a, m] = hojeSP(agora).split("-").map(Number), out: string[] = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.UTC(a, m - 1 - i, 1)); out.push(d.toISOString().slice(0, 7)); }
  return out;
}

// ───────────────────────── números ─────────────────────────
export const arred = (n: number, c = 1): number => Math.round(n * 10 ** c) / 10 ** c;
export const pct = (a: number, b: number): number | null => (b > 0 ? arred((100 * a) / b, 1) : null);
export const media = (xs: number[]): number | null => (xs.length ? arred(xs.reduce((a, b) => a + b, 0) / xs.length, 2) : null);
const soma = <T,>(xs: T[], f: (x: T) => number): number => xs.reduce((a, x) => a + f(x), 0);
export const nomeCurto = (n: string): string => { const p = String(n || "Promotor").trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0]; };

// ───────────────────────── modelos de entrada ─────────────────────────
export interface PedidoCS {
  id: string; lojaUid: string; lojaNome: string; redeId: string | null; data: string; entrada: string; saida: string; inicioMs: number; fimMs: number;
  setor: string; status: string; fase: string; tipo: string; marcaId: string | null; marcaNome: string; regiao: string;
  criadoEm: number; aceitoEm: number; checkinEm: number; checkoutEm: number; atrasoMin: number | null; minutos: number; gondola: string;
  auditoriaContestada: boolean; promotorUid: string; promotorNome: string; promotorNivel: string;
  estrelas: number | null; comentario: string; avaliadoEm: number; totalCentavos: number; expiraEm: number;
}
export interface LojaBase { lojaUid: string; nome: string; redeId: string | null; criadoEm: number; ativo: boolean; cidade: string; gerente: string }
export interface RedeBase { id: string; nome: string; csResponsavel: string; modelo: ModeloFaturamento; limiteCentavos: number; cicloDia: number; inicioApuracaoEm: number }
export interface LancamentoBase { id: string; redeId: string; tipo: TipoLancamento; valorCentavos: number; descricao: string; em: number; paga: boolean | null }
export interface BaseCS {
  pedidos: PedidoCS[]; lojas: LojaBase[]; redes: RedeBase[]; envios: EnvioNps[]; lancamentos: LancamentoBase[];
  lojasComAcao: string[]; params: ParametrosCS; agora: number; truncado: boolean;
}

const ms = (t: any): number => (t == null ? 0 : typeof t === "number" ? t : typeof t.toMillis === "function" ? t.toMillis() : 0);
const txt = (v: any, max = 200): string => String(v ?? "").slice(0, max);

/** Documento de `solicitacoes` (+ total pago pela loja em `solicitacoes_financeiro`) → PedidoCS. Devolve null se o turno é ilegível. */
export function normalizarPedido(id: string, d: any, totalCentavos: number, redeId: string | null): PedidoCS | null {
  const inicio = instanteSP(String(d?.data), String(d?.entrada)), fim0 = instanteSP(String(d?.data), String(d?.saida));
  if (!Number.isFinite(inicio) || !Number.isFinite(fim0)) return null;
  const checkinEm = ms(d.checkin?.em) || ms(d.checkinEm);
  const atraso = Number.isFinite(d.checkinAtrasoMin) ? Number(d.checkinAtrasoMin) : checkinEm ? Math.max(0, Math.round((checkinEm - inicio) / MIN)) : null;
  const e = d.avaliacao?.estrelas;
  return {
    id, lojaUid: txt(d.uid, 128), lojaNome: txt(d.loja, 160), redeId, data: d.data, entrada: d.entrada, saida: d.saida, inicioMs: inicio, fimMs: fim0 > inicio ? fim0 : fim0 + DIA,
    setor: txt(d.foco, 60) || "Sem setor", status: txt(d.status, 30), fase: txt(d.fase, 30), tipo: txt(d.tipo, 20) || "padrao",
    marcaId: d.marcaId ? txt(d.marcaId, 128) : null, marcaNome: txt(d.marcaNome, 80), regiao: d.regiao?.cidade ? `${d.regiao.cidade}/${d.regiao.uf || ""}`.replace(/\/$/, "") : "Não informada",
    criadoEm: ms(d.criadoEm) || inicio, aceitoEm: ms(d.aceitoEm), checkinEm, checkoutEm: ms(d.checkout?.em), atrasoMin: atraso,
    minutos: Number(d.checkout?.minutosNoLocal ?? d.minutos ?? 0) || 0, gondola: txt(d.checkout?.gondola, 20),
    auditoriaContestada: d.auditoriaLoja?.resultado === "contestada", promotorUid: txt(d.promotorUid, 128), promotorNome: txt(d.promotorNome, 100), promotorNivel: txt(d.promotorNivel, 20) || "bronze",
    estrelas: Number.isInteger(e) && e >= 1 && e <= 5 ? e : null, comentario: txt(d.avaliacao?.comentario, 300), avaliadoEm: ms(d.avaliacao?.em), totalCentavos: Math.max(0, Math.round(Number(totalCentavos) || 0)), expiraEm: ms(d.expiraEm)
  };
}

export const concluido = (p: PedidoCS): boolean => p.fase === "executada" || p.status === "paga" || p.status === "concluida";
export const horasDe = (p: PedidoCS): number => p.minutos / 60;
const pontual = (p: PedidoCS, tol: number): boolean => (p.atrasoMin ?? 0) <= tol;

export interface Janela { desde: string; ate: string; dias: number; agora: number; tol: number }
export const janelaDe = (dias: number, agora: number, tol: number): Janela => ({ desde: somaDias(hojeSP(agora), -(dias - 1)), ate: hojeSP(agora), dias, agora, tol });
const noPeriodo = (ps: PedidoCS[], j: Janela): PedidoCS[] => ps.filter((p) => p.data >= j.desde && p.data <= j.ate);

// ───────────────────────── 1) FILL RATE ─────────────────────────
export function fillRate(ps: PedidoCS[], j: Janela, metaPct: number): MetricaFillRate {
  const abertas = noPeriodo(ps, j).filter((p) => p.status !== "cancelada");
  const enc = abertas.filter((p) => p.fimMs <= j.agora), conc = enc.filter(concluido), prazo = conc.filter((p) => pontual(p, j.tol));
  const aceitas = enc.filter((p) => p.status !== "aberta");
  const porDia = new Map<string, PedidoCS[]>();
  for (const p of enc) porDia.set(p.data, [...(porDia.get(p.data) || []), p]);
  const serie = [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dia, l]) => {
    const c = l.filter(concluido);
    return { dia, encerradas: l.length, concluidas: c.length, noPrazo: c.filter((p) => pontual(p, j.tol)).length, fillRate: pct(c.length, l.length) };
  });
  return {
    periodo: { desde: j.desde, ate: j.ate, dias: j.dias }, abertas: abertas.length, encerradas: enc.length, aceitas: aceitas.length, concluidas: conc.length, noPrazo: prazo.length,
    semPromotor: enc.length - aceitas.length, faltaPromotor: aceitas.length - conc.length,
    taxaAceite: pct(aceitas.length, enc.length), fillRate: pct(conc.length, enc.length), fillRateNoPrazo: pct(prazo.length, enc.length), metaPct, serie
  };
}

// ───────────────────────── 2) VAGAS DESATENDIDAS ─────────────────────────
export function vagasDesatendidas(ps: PedidoCS[], horas: number, agora: number): VagaDesatendida[] {
  return ps
    .filter((p) => p.status === "aberta" && p.fimMs > agora && p.inicioMs - agora <= horas * HORA && !(p.tipo === "ruptura" && p.expiraEm && p.expiraEm < agora))
    .map((p): VagaDesatendida => {
      const falta = Math.round((p.inicioMs - agora) / MIN), urgente = p.tipo === "ruptura" || falta <= 60;
      return { pedidoId: p.id, lojaUid: p.lojaUid, lojaNome: p.lojaNome, redeId: p.redeId, setor: p.setor, data: p.data, entrada: p.entrada, minutosParaInicio: falta, urgente, severidade: urgente ? "critica" : falta <= (horas * 60) / 2 ? "alta" : "media" };
    })
    .sort((a, b) => a.minutosParaInicio - b.minutosParaInicio);
}

// ───────────────────────── 3) CSAT ─────────────────────────
export function csat(ps: PedidoCS[], j: Janela, metaMedia: number): MetricaCsat {
  const av = noPeriodo(ps, j).filter((p) => p.estrelas !== null), notas = av.map((p) => p.estrelas as number);
  const semanas = new Map<string, number[]>();
  for (const p of av) semanas.set(segunda(p.data), [...(semanas.get(segunda(p.data)) || []), p.estrelas as number]);
  return {
    media: media(notas), total: notas.length, csatPct: pct(notas.filter((n) => n >= 4).length, notas.length), metaMedia,
    distribuicao: [5, 4, 3, 2, 1].map((e) => ({ estrelas: e, qtd: notas.filter((n) => n === e).length })),
    serie: [...semanas.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([semana, l]) => ({ semana, media: media(l), qtd: l.length })),
    comentarios: av.filter((p) => p.comentario.trim()).sort((a, b) => (b.avaliadoEm || b.inicioMs) - (a.avaliadoEm || a.inicioMs)).slice(0, 12)
      .map((p) => ({ pedidoId: p.id, loja: p.lojaNome, estrelas: p.estrelas as number, comentario: p.comentario, em: p.avaliadoEm || p.inicioMs })),
    baixas: notas.filter((n) => n <= 2).length
  };
}

// ───────────────────────── 8) PONTUALIDADE ─────────────────────────
export function pontualidade(ps: PedidoCS[], j: Janela): MetricaPontualidade {
  const ck = noPeriodo(ps, j).filter((p) => p.checkinEm > 0 && p.atrasoMin !== null), ok = ck.filter((p) => pontual(p, j.tol));
  const atrasados = ck.filter((p) => !pontual(p, j.tol));
  const sem = new Map<string, PedidoCS[]>(), prom = new Map<string, PedidoCS[]>();
  for (const p of ck) { sem.set(segunda(p.data), [...(sem.get(segunda(p.data)) || []), p]); prom.set(p.promotorUid, [...(prom.get(p.promotorUid) || []), p]); }
  return {
    tolMin: j.tol, checkins: ck.length, pontuais: ok.length, pct: pct(ok.length, ck.length), atrasoMedioMin: atrasados.length ? arred(soma(atrasados, (p) => p.atrasoMin as number) / atrasados.length, 0) : null,
    serie: [...sem.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([semana, l]) => ({ semana, pct: pct(l.filter((p) => pontual(p, j.tol)).length, l.length), checkins: l.length })),
    promotores: [...prom.values()].filter((l) => l.length >= 2).map((l) => {
      const at = l.filter((p) => !pontual(p, j.tol));
      return { nome: nomeCurto(l[0].promotorNome), nivel: l[0].promotorNivel, checkins: l.length, pct: pct(l.length - at.length, l.length) as number, atrasoMedioMin: at.length ? arred(soma(at, (p) => p.atrasoMin as number) / at.length, 0) : 0 };
    }).sort((a, b) => a.pct - b.pct || b.checkins - a.checkins).slice(0, 12)
  };
}

// ───────────────────────── 5) ROI / ECONOMIA GERADA ─────────────────────────
/**
 * Comparação (ESTIMADA): para cada loja e mês, quantos contratados fixos ela precisaria para cobrir a SEMANA DE PICO
 * (horas do pico ÷ jornada produtiva) — mínimo 1 — a custo mensal cheio. Economia = custo fixo equivalente − gasto on-demand real.
 * Pode dar NEGATIVO (lojas com uso constante e alto): o painel mostra isso, não esconde.
 */
export function roi(ps: PedidoCS[], p: ParametrosCS, agora: number): MetricaRoi {
  const meses = mesesRecentes(agora, MESES_ROI), hoje = hojeSP(agora), mesAtual = hoje.slice(0, 7);
  const jornada = (p.horasSemanaFixo * p.ocupacaoFixaPct) / 100;
  const linhas: MesRoi[] = meses.map((mes) => {
    const ex = ps.filter((x) => concluido(x) && x.data.startsWith(mes));
    const porLoja = new Map<string, Map<string, number>>();
    for (const x of ex) { const s = porLoja.get(x.lojaUid) || new Map<string, number>(); s.set(segunda(x.data), (s.get(segunda(x.data)) || 0) + horasDe(x)); porLoja.set(x.lojaUid, s); }
    let fte = 0;
    for (const s of porLoja.values()) fte += Math.max(1, Math.ceil(Math.max(...s.values()) / jornada));
    const parcial = mes === mesAtual, fator = parcial ? Number(hoje.slice(8, 10)) / diasNoMes(mes) : 1;
    const onDemand = soma(ex, (x) => x.totalCentavos), fixo = Math.round(fte * p.custoMensalFixoCentavos * fator);
    return { mes, parcial, horas: arred(soma(ex, horasDe), 1), turnos: ex.length, lojasAtivas: porLoja.size, onDemandCentavos: onDemand, fixoEquivalenteCentavos: fixo, economiaCentavos: fixo - onDemand, economiaPct: fixo > 0 ? arred((100 * (fixo - onDemand)) / fixo, 1) : null, contratadosEquivalentes: fte };
  });
  const od = soma(linhas, (m) => m.onDemandCentavos), fx = soma(linhas, (m) => m.fixoEquivalenteCentavos);
  return { meses: linhas, acumulado: { onDemandCentavos: od, fixoEquivalenteCentavos: fx, economiaCentavos: fx - od, economiaPct: fx > 0 ? arred((100 * (fx - od)) / fx, 1) : null }, premissas: { custoMensalFixoCentavos: p.custoMensalFixoCentavos, horasSemanaFixo: p.horasSemanaFixo, ocupacaoFixaPct: p.ocupacaoFixaPct } };
}

// ───────────────────────── 6) RUPTURA EVITADA ─────────────────────────
/** Confirmadas = chamados relâmpago concluídos (a loja declarou a ruptura). Estimadas = reposições regulares com gôndola cheia × taxa (premissa). */
export function ruptura(ps: PedidoCS[], j: Janela, p: ParametrosCS): MetricaRuptura {
  const ex = noPeriodo(ps, j).filter(concluido), rel = ex.filter((x) => x.tipo === "ruptura"), reg = ex.filter((x) => x.tipo !== "ruptura");
  const cheias = ex.filter((x) => x.gondola === "cheia"), regCheias = reg.filter((x) => x.gondola === "cheia");
  const conf = rel.length, est = Math.round((regCheias.length * p.taxaRupturaEvitadaPct) / 100), total = conf + est, horas = soma(ex, horasDe);
  const porMes = new Map<string, PedidoCS[]>();
  for (const x of ex) porMes.set(x.data.slice(0, 7), [...(porMes.get(x.data.slice(0, 7)) || []), x]);
  return {
    reposicoes: ex.length, horas: arred(horas, 1), itensRepostosEst: Math.round(horas * p.itensPorHora), gondolasCheias: cheias.length, chamadosRelampago: rel.length,
    evitadasConfirmadas: conf, evitadasEstimadas: est, evitadasTotal: total, vendaPreservadaCentavos: p.receitaPorRupturaCentavos > 0 ? total * p.receitaPorRupturaCentavos : null,
    serie: [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, l]) => ({
      mes, evitadas: l.filter((x) => x.tipo === "ruptura").length + Math.round((l.filter((x) => x.tipo !== "ruptura" && x.gondola === "cheia").length * p.taxaRupturaEvitadaPct) / 100), itens: Math.round(soma(l, horasDe) * p.itensPorHora)
    }))
  };
}

// ───────────────────────── indicadores genéricos (reaproveitados por setor, marca, rede, loja) ─────────────────────────
export function indicadores(ps: PedidoCS[], j: Janela): Indicadores {
  const no = noPeriodo(ps, j), abertas = no.filter((p) => p.status !== "cancelada"), enc = abertas.filter((p) => p.fimMs <= j.agora), conc = enc.filter(concluido);
  const exec = no.filter(concluido), ck = no.filter((p) => p.checkinEm > 0 && p.atrasoMin !== null), notas = no.filter((p) => p.estrelas !== null).map((p) => p.estrelas as number);
  const comGondola = exec.filter((p) => p.gondola);
  return {
    missoes: abertas.length, encerradas: enc.length, concluidas: conc.length, horas: arred(soma(exec, horasDe), 1), gastoCentavos: soma(exec, (p) => p.totalCentavos),
    fillRate: pct(conc.length, enc.length), fillRateNoPrazo: pct(conc.filter((p) => pontual(p, j.tol)).length, enc.length), csat: media(notas), avaliacoes: notas.length,
    pontualidade: pct(ck.filter((p) => pontual(p, j.tol)).length, ck.length), gondolaCheiaPct: pct(comGondola.filter((p) => p.gondola === "cheia").length, comGondola.length)
  };
}
const agrupar = <T,>(xs: T[], chave: (x: T) => string): Map<string, T[]> => { const m = new Map<string, T[]>(); for (const x of xs) { const k = chave(x); m.set(k, [...(m.get(k) || []), x]); } return m; };

// ───────────────────────── 13) SETORES ─────────────────────────
export function setores(ps: PedidoCS[], j: Janela): LinhaSetor[] {
  const no = noPeriodo(ps, j), g = agrupar(no, (p) => p.setor), destaque: readonly string[] = SETORES_DESTAQUE;
  const ordem = [...destaque.filter((s) => g.has(s)), ...[...g.keys()].filter((s) => !destaque.includes(s)).sort()];
  return ordem.map((setor) => {
    const l = g.get(setor) as PedidoCS[], aceite = l.filter((p) => p.aceitoEm > 0 && p.criadoEm > 0).map((p) => Math.max(0, (p.aceitoEm - p.criadoEm) / MIN));
    return { setor, ...indicadores(l, j), tempoAceiteMin: aceite.length ? arred(soma(aceite, (x) => x) / aceite.length, 0) : null };
  });
}

// ───────────────────────── 14) CHURN ─────────────────────────
const nivelChurn = (d: number, lim: number): NivelChurn => (d >= 2 * lim ? "critico" : d >= lim ? "risco" : d >= Math.ceil(lim * 0.6) ? "atencao" : "saudavel");
const ORDEM_NIVEL: Record<NivelChurn, number> = { critico: 3, risco: 2, atencao: 1, saudavel: 0 };
export function churn(b: Pick<BaseCS, "pedidos" | "lojas" | "redes" | "lojasComAcao" | "params" | "agora">): MetricaChurn {
  const lim = b.params.inatividadeDias, redeNome = new Map(b.redes.map((r) => [r.id, r.nome])), porLoja = agrupar(b.pedidos, (p) => p.lojaUid);
  const itens: LojaChurn[] = [], resumo = { saudavel: 0, atencao: 0, risco: 0, critico: 0 };
  for (const l of b.lojas) {
    if (!l.ativo) continue;
    const ps = porLoja.get(l.lojaUid) || [], ultima = ps.length ? Math.max(...ps.map((p) => p.criadoEm)) : 0;
    const r90 = ps.filter((p) => p.status !== "cancelada" && p.criadoEm >= b.agora - 90 * DIA);
    let dias: number, alem = false;
    if (ultima) dias = Math.floor((b.agora - ultima) / DIA);
    else if (l.criadoEm && b.agora - l.criadoEm < JANELA_DIAS * DIA) dias = Math.floor((b.agora - l.criadoEm) / DIA);
    else { dias = JANELA_DIAS; alem = true; }
    const nivel = nivelChurn(dias, lim);
    resumo[nivel]++;
    if (nivel !== "saudavel") itens.push({ lojaUid: l.lojaUid, nome: l.nome, redeId: l.redeId, redeNome: l.redeId ? redeNome.get(l.redeId) || "" : "", nivel, diasSemMissao: dias, alemDaJanela: alem, semNenhumaMissao: !ultima, ultimaMissaoEm: ultima || null, missoes90d: r90.length, gasto90dCentavos: soma(r90.filter(concluido), (p) => p.totalCentavos), acaoAberta: b.lojasComAcao.includes(l.lojaUid) });
  }
  itens.sort((a, c) => ORDEM_NIVEL[c.nivel] - ORDEM_NIVEL[a.nivel] || c.gasto90dCentavos - a.gasto90dCentavos || c.diasSemMissao - a.diasSemMissao);
  return { limiteDias: lim, janelaDias: JANELA_DIAS, itens, resumo, receitaEmRiscoCentavos: soma(itens.filter((i) => i.nivel === "risco" || i.nivel === "critico"), (i) => i.gasto90dCentavos) };
}

// ───────────────────────── 11) NPS ─────────────────────────
export function nps(envios: EnvioNps[], j: Janela): MetricaNps {
  const ate = (iso: string) => Date.parse(iso + "T23:59:59-03:00"), de = (iso: string) => Date.parse(iso + "T00:00:00-03:00");
  const resp = envios.filter((e) => e.status === "respondido" && e.nota !== null && e.respondidoEm !== null && (e.respondidoEm as number) >= de(j.desde) && (e.respondidoEm as number) <= ate(j.ate));
  const enviados = envios.filter((e) => e.criadoEm >= de(j.desde) && e.criadoEm <= ate(j.ate));
  const calc = (l: EnvioNps[]): number | null => (l.length ? Math.round((100 * (l.filter((e) => (e.nota as number) >= 9).length - l.filter((e) => (e.nota as number) <= 6).length)) / l.length) : null);
  const meses = agrupar(resp, (e) => new Date((e.respondidoEm as number) - 3 * HORA).toISOString().slice(0, 7));
  return {
    nps: calc(resp), respostas: resp.length, enviados: enviados.length, taxaResposta: pct(enviados.filter((e) => e.status === "respondido").length, enviados.length), pendentes: envios.filter((e) => e.status === "pendente").length,
    promotores: resp.filter((e) => (e.nota as number) >= 9).length, neutros: resp.filter((e) => (e.nota as number) >= 7 && (e.nota as number) <= 8).length, detratores: resp.filter((e) => (e.nota as number) <= 6).length,
    serie: [...meses.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, l]) => ({ mes, nps: calc(l), respostas: l.length })),
    comentarios: resp.filter((e) => e.comentario.trim()).sort((a, b) => (b.respondidoEm as number) - (a.respondidoEm as number)).slice(0, 10).map((e) => ({ loja: e.lojaNome, nota: e.nota as number, comentario: e.comentario, em: e.respondidoEm as number }))
  };
}

// ───────────────────────── 4) CONTAS-CHAVE ─────────────────────────
export function contasChave(b: BaseCS, j: Janela): ContaChave[] {
  const churnPorLoja = new Map(churn(b).itens.map((i) => [i.lojaUid, i.nivel])), lojasPorRede = agrupar(b.lojas.filter((l) => l.ativo), (l) => l.redeId || "");
  const pedPorRede = agrupar(b.pedidos, (p) => p.redeId || ""), enviosPorRede = agrupar(b.envios, (e) => e.redeId || "");
  const ids = [...b.redes.map((r) => r.id), ""];
  return ids.map((id): ContaChave => {
    const rede = b.redes.find((r) => r.id === id), lojas = lojasPorRede.get(id) || [], ps = pedPorRede.get(id) || [];
    const porLoja = lojas.map((l) => ({ lojaUid: l.lojaUid, nome: l.nome, nivelChurn: churnPorLoja.get(l.lojaUid) || ("saudavel" as NivelChurn), ...indicadores(ps.filter((p) => p.lojaUid === l.lojaUid), j) })).sort((a, c) => c.gastoCentavos - a.gastoCentavos);
    return {
      redeId: id || null, nome: rede ? rede.nome : "Lojas avulsas", csResponsavel: rede?.csResponsavel || "", lojas: lojas.length, lojasAtivas: porLoja.filter((l) => l.missoes > 0).length,
      lojasEmChurn: porLoja.filter((l) => l.nivelChurn === "risco" || l.nivelChurn === "critico").length, nps: nps(enviosPorRede.get(id) || [], j).nps, ...indicadores(ps, j), porLoja
    };
  }).filter((c) => c.redeId !== null || c.lojas > 0).sort((a, c) => c.gastoCentavos - a.gastoCentavos);
}

// ───────────────────────── 10) MARCAS PARCEIRAS ─────────────────────────
export function marcas(ps: PedidoCS[], j: Janela): LinhaMarca[] {
  const comMarca = noPeriodo(ps, j).filter((p) => p.marcaId);
  return [...agrupar(comMarca, (p) => p.marcaId as string).entries()].map(([marcaId, l]) => ({
    marcaId, marca: l.find((p) => p.marcaNome)?.marcaNome || marcaId, ...indicadores(l, j), lojas: new Set(l.map((p) => p.lojaUid)).size,
    regioes: [...new Set(l.map((p) => p.regiao))].sort(), auditoriasContestadas: l.filter((p) => p.auditoriaContestada).length
  })).sort((a, c) => c.horas - a.horas);
}

// ───────────────────────── 9) FATURAMENTO B2B ─────────────────────────
const inicioCiclo = (hoje: string, dia: number): string => {
  const [a, m, d] = hoje.split("-").map(Number), base = d >= dia ? new Date(Date.UTC(a, m - 1, dia)) : new Date(Date.UTC(a, m - 2, dia));
  return base.toISOString().slice(0, 10);
};
const proximoCiclo = (ini: string): string => { const d = new Date(ini + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); };
/**
 * Pré-pago: saldo = créditos/ajustes lançados − consumo (missões concluídas desde `inicioApuracaoEm`) − comprometido (missões abertas/aceitas futuras).
 * Pós-pago: consumo (+ comprometido) do ciclo corrente contra o limite. Valores = o que a LOJA paga (solicitacoes_financeiro.total); nunca repasse/comissão.
 */
export function faturamento(b: BaseCS, janelaCarregadaDesde: number): LinhaFaturamento[] {
  const hoje = hojeSP(b.agora);
  return b.redes.map((r): LinhaFaturamento => {
    const ps = b.pedidos.filter((p) => p.redeId === r.id), lan = b.lancamentos.filter((l) => l.redeId === r.id && l.tipo !== "fatura" && l.em >= r.inicioApuracaoEm);
    const consumo = soma(ps.filter((p) => concluido(p) && p.inicioMs >= r.inicioApuracaoEm), (p) => p.totalCentavos);
    const comprometido = soma(ps.filter((p) => !concluido(p) && p.status !== "cancelada" && p.fimMs > b.agora), (p) => p.totalCentavos);
    const base = { redeId: r.id, rede: r.nome, modelo: r.modelo, creditosCentavos: soma(lan, (l) => l.valorCentavos), consumoCentavos: consumo, comprometidoCentavos: comprometido, apuracaoParcial: r.inicioApuracaoEm < janelaCarregadaDesde, lancamentos: b.lancamentos.filter((l) => l.redeId === r.id).sort((a, c) => c.em - a.em).slice(0, 15).map((l) => ({ ...l })) };
    if (r.modelo === "prepago") {
      const saldo = base.creditosCentavos - consumo - comprometido, ult30 = soma(ps.filter((p) => concluido(p) && p.inicioMs >= b.agora - 30 * DIA), (p) => p.totalCentavos) / 30;
      const dias = ult30 > 0 && saldo > 0 ? Math.floor(saldo / ult30) : null;
      const alerta: AlertaFaturamento = saldo <= 0 ? "saldo_esgotado" : dias !== null && dias < 7 ? "saldo_baixo" : "ok";
      return { ...base, saldoDisponivelCentavos: saldo, diasDeSaldo: dias, limiteCentavos: null, consumoCicloCentavos: null, usoLimitePct: null, proximoFechamento: null, alerta };
    }
    const ini = inicioCiclo(hoje, r.cicloDia), fim = proximoCiclo(ini), noCiclo = ps.filter((p) => p.data >= ini && p.data < fim && p.status !== "cancelada" && (concluido(p) || p.fimMs > b.agora));
    const uso = soma(noCiclo, (p) => p.totalCentavos), usoPct = r.limiteCentavos > 0 ? arred((100 * uso) / r.limiteCentavos, 1) : null;
    const alerta: AlertaFaturamento = usoPct !== null && usoPct >= 100 ? "limite_estourado" : usoPct !== null && usoPct >= 85 ? "limite_proximo" : "ok";
    return { ...base, saldoDisponivelCentavos: null, diasDeSaldo: null, limiteCentavos: r.limiteCentavos, consumoCicloCentavos: uso, usoLimitePct: usoPct, proximoFechamento: fim, alerta };
  });
}

// ───────────────────────── PAINEL (visão geral) ─────────────────────────
/** Restringe a base a uma rede (conta-chave). Tudo o que o painel/relatório calcula depois enxerga só aquela rede. */
export function escopo(b: BaseCS, redeId: string | null): BaseCS {
  if (!redeId) return b;
  return { ...b, pedidos: b.pedidos.filter((p) => p.redeId === redeId), lojas: b.lojas.filter((l) => l.redeId === redeId), redes: b.redes.filter((r) => r.id === redeId), envios: b.envios.filter((e) => e.redeId === redeId), lancamentos: b.lancamentos.filter((l) => l.redeId === redeId) };
}
export function montarPainel(base: BaseCS, dias: number, redeId: string | null): PainelCS {
  const b = escopo(base, redeId), j = janelaDe(dias, b.agora, b.params.toleranciaPontualMin), p = b.params;
  const fr = fillRate(b.pedidos, j, p.metaFillRatePct), cs = csat(b.pedidos, j, p.metaCsat), pt = pontualidade(b.pedidos, j), ro = roi(b.pedidos, p, b.agora), ru = ruptura(b.pedidos, j, p);
  const ch = churn(b), np = nps(b.envios, j), vg = vagasDesatendidas(b.pedidos, p.alertaVagaHoras, b.agora);
  return {
    geradoEm: b.agora, periodo: fr.periodo, escopo: { redeId, rede: redeId ? b.redes[0]?.nome || "" : "Todas as redes e lojas" }, parametros: p, truncado: b.truncado,
    kpis: { fillRate: fr.fillRate, fillRateNoPrazo: fr.fillRateNoPrazo, csat: cs.media, nps: np.nps, pontualidade: pt.pct, economiaCentavos: ro.acumulado.economiaCentavos, vagasDesatendidas: vg.length, lojasEmChurn: ch.resumo.risco + ch.resumo.critico, rupturasEvitadas: ru.evitadasTotal },
    fillRate: fr, vagas: vg, csat: cs, pontualidade: pt, roi: ro, ruptura: ru, setores: setores(b.pedidos, j), churn: ch, nps: np
  };
}
