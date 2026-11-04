// ============================================================
// ABASTECE JÁ — núcleo PURO da fila de TI (sem DOM, sem rede, sem relógio próprio): faixas de criticidade, cronômetro de SLA e
// utilidades do monitor de saúde. É a FONTE ÚNICA dessas regras: o painel (ti.js) e o componente React (painel-ti-react/) importam daqui,
// e test/bugs.test.js garante o comportamento em Node. Toda função que depende de "agora" recebe o instante como parâmetro.
// ============================================================

/**
 * @typedef {{ id: string, protocolo: string, titulo: string, prioridade: "critica"|"alta"|"media"|"baixa", status: string, origem?: string,
 *   categoria?: string, criadoEm: string, slaAtendEm: string|null, slaResolEm: string|null, atribuidoNome?: string }} ChamadoTI
 * @typedef {"critica"|"media"|"baixa"} FaixaId
 * @typedef {{ id: string, nome: string, tipo: string, status: "ok"|"degradado"|"fora"|"nao_configurado"|"desconhecido", latenciaMs: number|null, detalhe: string,
 *   verificadoEm: string|null, lentoMs: number|null, historico: { em: number, ms: number, s: string }[], disponibilidadePct: number|null }} ServicoSaude
 */

export const FAIXAS = /** @type {const} */ ([
    { id: "critica", rotulo: "Crítica", dica: "Incidente: atende na hora (1º atendimento em 15 min)" },
    { id: "media", rotulo: "Média", dica: "Fila normal de trabalho" },
    { id: "baixa", rotulo: "Baixa", dica: "Sem pressa: pode esperar o fim do dia" }
]);
const PESO = { critica: 4, alta: 3, media: 2, baixa: 1 };
export const ROTULO_PRIORIDADE = { critica: "Crítica", alta: "Alta", media: "Média", baixa: "Baixa" };

/**
 * Faixa exibida para uma prioridade. O sistema tem 4 níveis (a "alta" é a urgência máxima que um usuário pode sugerir);
 * o painel mostra 3 faixas: "alta" cai em MÉDIA para não diluir a faixa crítica (que é a que aciona plantão) — o selo do chamado continua
 * dizendo "Alta" e o cronômetro usa o prazo real dela (1 h / 8 h). Para mudar a regra, altere só esta função.
 * @param {string} prioridade @returns {FaixaId}
 */
export const faixaDe = (prioridade) => (prioridade === "critica" ? "critica" : prioridade === "baixa" ? "baixa" : "media");

/** `[AUTO-BUG]` = aberto pelo capturador automático (título com o cabeçalho ou origem "automatico"). */
export const ehAutoBug = (c) => c?.origem === "automatico" || /^\s*\[AUTO-BUG\]/i.test(String(c?.titulo || ""));

/** Título sem o cabeçalho (para exibir o selo [AUTO-BUG] separado do texto). */
export const tituloLimpo = (c) => String(c?.titulo || "").replace(/^\s*\[AUTO-BUG\]\s*/i, "");

/**
 * Agrupa por faixa. Dentro da faixa: prioridade real primeiro (alta antes de média), depois o mais antigo (já está esperando há mais tempo).
 * @param {ChamadoTI[]} chamados @returns {Record<FaixaId, ChamadoTI[]>}
 */
export function agruparPorFaixa(chamados) {
    const g = { critica: [], media: [], baixa: [] };
    for (const c of chamados || []) g[faixaDe(c.prioridade)].push(c);
    for (const k of Object.keys(g)) g[k].sort((a, b) => (PESO[b.prioridade] || 0) - (PESO[a.prioridade] || 0) || Date.parse(a.criadoEm) - Date.parse(b.criadoEm));
    return g;
}

/**
 * Cronômetro de SLA de UM chamado, no instante `agoraMs`.
 *   aberto            → conta até o PRIMEIRO ATENDIMENTO (slaAtendEm)
 *   em_atendimento    → conta até a RESOLUÇÃO (slaResolEm)
 *   aguardando_usuario→ relógio PARADO (o tempo esperando o usuário não conta; o prazo é empurrado quando ele responde)
 *   resolvido/cancelado → sem cronômetro
 * `pct` = fração da janela já consumida (>1 = estourou). nível: ok (<70%) · atencao (70–100%) · estourado · pausado · nenhum.
 * @param {ChamadoTI} c @param {Record<string,{atend:number,resol:number}>} slaMin @param {number} agoraMs
 * @returns {{ fase: "atendimento"|"resolucao"|"pausado"|"nenhuma", rotulo: string, alvoMs: number|null, restanteMs: number|null, pct: number, nivel: "ok"|"atencao"|"estourado"|"pausado"|"nenhum" }}
 */
export function slaDe(c, slaMin, agoraMs) {
    if (c.status === "aguardando_usuario") return { fase: "pausado", rotulo: "Aguardando usuário", alvoMs: null, restanteMs: null, pct: 0, nivel: "pausado" };
    const fase = c.status === "aberto" ? "atendimento" : c.status === "em_atendimento" ? "resolucao" : "nenhuma";
    if (fase === "nenhuma") return { fase, rotulo: "", alvoMs: null, restanteMs: null, pct: 0, nivel: "nenhum" };
    const alvoMs = Date.parse(fase === "atendimento" ? c.slaAtendEm || "" : c.slaResolEm || "");
    const janelaMs = ((slaMin?.[c.prioridade] || {})[fase === "atendimento" ? "atend" : "resol"] || 0) * 60_000;
    if (!Number.isFinite(alvoMs)) return { fase, rotulo: "", alvoMs: null, restanteMs: null, pct: 0, nivel: "nenhum" };
    const restanteMs = alvoMs - agoraMs, pct = janelaMs > 0 ? Math.max(0, 1 - restanteMs / janelaMs) : restanteMs < 0 ? 1.01 : 0;
    return { fase, rotulo: fase === "atendimento" ? "1º atendimento" : "Resolução", alvoMs, restanteMs, pct, nivel: restanteMs < 0 ? "estourado" : pct >= 0.7 ? "atencao" : "ok" };
}

/** "12 min", "1 h 05 min", "42 s" (≤ 2 min mostra segundos: é o que dá a sensação de cronômetro correndo). */
export function formatarDuracao(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 120) return `${s} s`;
    const m = Math.floor(s / 60); if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60; if (h < 48) return r ? `${h} h ${String(r).padStart(2, "0")} min` : `${h} h`;
    return `${Math.floor(h / 24)} d`;
}
/** Texto do cronômetro: "em 12 min" / "estourou há 3 min" / "pausado". */
export function textoSla(sla) {
    if (sla.nivel === "pausado") return "pausado";
    if (sla.nivel === "nenhum" || sla.restanteMs == null) return "—";
    return sla.restanteMs < 0 ? `estourou há ${formatarDuracao(-sla.restanteMs)}` : `em ${formatarDuracao(sla.restanteMs)}`;
}
/** Segundos → "12 min" (usado nos cartões TMA/TMR, que chegam em segundos). */
export const duracaoSeg = (s) => { if (s == null) return "—"; s = Math.round(s); if (s < 60) return `${s} s`; const m = Math.round(s / 60); if (m < 60) return `${m} min`; const h = Math.floor(m / 60), r = m % 60; if (h < 48) return r ? `${h} h ${r} min` : `${h} h`; return `${Math.round(h / 24)} d`; };

/** Latência para exibir: "—" sem medição, "<0,1" para valores ínfimos (cálculo interno), 1 casa abaixo de 10 ms, inteiro acima. */
export const formatarLatencia = (ms) => (ms == null ? "—" : ms < 0.1 ? "<0,1" : ms < 10 ? ms.toFixed(1).replace(".", ",") : String(Math.round(ms)));

/** Totais por faixa para o cabeçalho de cada coluna. @returns {Record<FaixaId,{total:number, estourados:number}>} */
export function totaisPorFaixa(chamados, slaMin, agoraMs) {
    const t = { critica: { total: 0, estourados: 0 }, media: { total: 0, estourados: 0 }, baixa: { total: 0, estourados: 0 } };
    for (const c of chamados || []) { const f = faixaDe(c.prioridade); t[f].total++; if (slaDe(c, slaMin, agoraMs).nivel === "estourado") t[f].estourados++; }
    return t;
}

// ---------------- saúde dos serviços ----------------
export const STATUS_SAUDE = {
    ok: { rotulo: "Operacional", classe: "ok" },
    degradado: { rotulo: "Degradado", classe: "warn" },
    fora: { rotulo: "Fora do ar", classe: "bad" },
    nao_configurado: { rotulo: "Não configurado", classe: "off" },
    desconhecido: { rotulo: "Medindo…", classe: "off" }
};
export const rotuloGeral = (geral, servicos = []) => {
    const n = servicos.filter((s) => s.status === "degradado" || s.status === "fora").length;
    return geral === "ok" ? "Todos os serviços operacionais" : geral === "desconhecido" ? "Medindo os serviços…" : `${n} serviço${n === 1 ? "" : "s"} com problema`;
};

/**
 * Pontos de um minigráfico de latência. x distribuído pelo número de amostras; y normalizado pelo maior entre o pico medido e o limite de "lento"
 * (assim um serviço rápido não parece instável só porque o gráfico se ajusta ao próprio pico). Falhas ("fora") viram marcadores à parte.
 * @param {{ms:number,s:string}[]} historico @returns {{ linha: string, falhas: {x:number,y:number}[] }}
 */
export function sparkline(historico, largura = 120, altura = 28, lentoMs = 0) {
    const h = historico || []; if (h.length < 2) return { linha: "", falhas: [] };
    const teto = Math.max(lentoMs || 0, ...h.map((p) => p.ms), 1), pad = 3, passo = (largura - 2 * pad) / (h.length - 1);
    const pt = (p, i) => ({ x: Math.round((pad + i * passo) * 10) / 10, y: Math.round((altura - pad - (Math.min(p.ms, teto) / teto) * (altura - 2 * pad)) * 10) / 10 });
    const pts = h.map(pt);
    return { linha: pts.map((p) => `${p.x},${p.y}`).join(" "), falhas: pts.filter((_, i) => h[i].s === "fora") };
}
