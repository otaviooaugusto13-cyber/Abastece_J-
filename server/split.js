// ============================================================
// REGRAS FINANCEIRAS DO SERVIDOR — é ela que vale de verdade.
// Deve ser idêntica a config.js/core.js (test/split.test.js confere).
//
// Modelo "diária" (por turno, valores em CENTAVOS inteiros):
//   Loja paga                 = R$ 200,00  (VALOR_DIARIA_CENTAVOS)
//   Comissão da plataforma    = R$  50,00  (retida automaticamente)
//   Repasse ao profissional   = R$ 150,00  (cai na carteira digital)
//
// ATENÇÃO: R$ 150 sobre R$ 200 é 75%, não 80%. Os VALORES em reais são a
// fonte da verdade; a porcentagem é apenas derivada (PCT_REPASSE).
//
// DINÂMICO: os valores abaixo são apenas o PADRÃO (semente inicial e referência dos testes).
// Em produção quem manda é o documento `configuracoes/taxas` no Firestore, editado pelo admin
// (PUT /admin/taxas) e lido via lib/taxas.js. Todas as funções recebem `cfg` e, sem ele, usam o PADRÃO.
// ============================================================
const PADRAO = Object.freeze({
  diariaCentavos: 20000,      // loja paga
  comissaoCentavos: 5000,     // retida pela plataforma
  repasseCentavos: 15000,     // vai para a carteira do profissional
  taxaFixaCentavos: 0,        // não há taxa adicional para a loja neste modelo
  horasMin: 4,                // diária: turno mínimo
  horasMax: 6,                // limite estrito por turno
  maxSemana: 3,               // máx. de turnos do mesmo promotor na mesma loja por semana
  versao: 0
});
const VALOR_DIARIA_CENTAVOS = PADRAO.diariaCentavos;
const COMISSAO_PLATAFORMA_CENTAVOS = PADRAO.comissaoCentavos;
const REPASSE_PROFISSIONAL_CENTAVOS = PADRAO.repasseCentavos;
const TAXA_FIXA_CENTAVOS = PADRAO.taxaFixaCentavos;
const HORAS_MIN_TURNO = PADRAO.horasMin;
const HORAS_MAX_TURNO = PADRAO.horasMax;
const MAX_VEZES_SEMANA_LOJA = PADRAO.maxSemana;
const STATUS_QUE_CONTAM = ["aceita", "paga", "concluida"];

if (PADRAO.comissaoCentavos + PADRAO.repasseCentavos !== PADRAO.diariaCentavos) {
  throw new Error("Configuração financeira inconsistente: comissão + repasse deve ser igual à diária.");
}
const PCT_REPASSE = (REPASSE_PROFISSIONAL_CENTAVOS * 100) / VALOR_DIARIA_CENTAVOS; // 75
const PCT_COMISSAO = 100 - PCT_REPASSE;                                             // 25

// ---------- validação das taxas editadas pelo admin ----------
const LIMITES = Object.freeze({
  diariaCentavos: [1000, 500000],   // R$ 10,00 a R$ 5.000,00
  taxaFixaCentavos: [0, 50000],     // R$ 0,00 a R$ 500,00
  horas: [0.5, 12],
  maxSemana: [1, 7]
});
const brlTxt = (c) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
const inteiro = (v) => typeof v === "number" && Number.isSafeInteger(v);
const meiaHora = (v) => typeof v === "number" && Number.isFinite(v) && Number.isInteger(v * 2);

/**
 * Valida e normaliza as taxas. Retorna { erro: "", cfg } ou { erro: "mensagem" }.
 * Só aceita NÚMEROS (nada de string), centavos inteiros, e exige comissão + repasse === diária.
 * Campos desconhecidos são ignorados (o cliente não injeta nada no documento).
 */
function validarTaxas(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) return { erro: "Corpo inválido." };
  const { diariaCentavos: d, comissaoCentavos: c, repasseCentavos: r, taxaFixaCentavos: t, horasMin: hmin, horasMax: hmax, maxSemana: ms } = b;
  for (const [nome, v] of [["diária", d], ["comissão", c], ["repasse", r], ["taxa fixa", t]]) if (!inteiro(v) || v < 0) return { erro: `Valor inválido em "${nome}" (use centavos inteiros, sem negativos).` };
  const [dMin, dMax] = LIMITES.diariaCentavos, [tMin, tMax] = LIMITES.taxaFixaCentavos;
  if (d < dMin || d > dMax) return { erro: `A diária deve ficar entre ${brlTxt(dMin)} e ${brlTxt(dMax)}.` };
  if (t < tMin || t > tMax) return { erro: `A taxa fixa deve ficar entre ${brlTxt(tMin)} e ${brlTxt(tMax)}.` };
  if (r <= 0) return { erro: "O repasse ao profissional precisa ser maior que zero." };
  if (c + r !== d) return { erro: `Comissão (${brlTxt(c)}) + repasse (${brlTxt(r)}) precisa ser igual à diária (${brlTxt(d)}); ${c + r > d ? "sobram" : "faltam"} ${brlTxt(Math.abs(d - c - r))}.` };
  const [hLo, hHi] = LIMITES.horas;
  if (!meiaHora(hmin) || !meiaHora(hmax)) return { erro: "A duração do turno deve ser em horas inteiras ou meias horas (ex.: 4 ou 4,5)." };
  if (hmin < hLo || hmax > hHi) return { erro: `A duração do turno deve ficar entre ${hLo} h e ${hHi} h.` };
  if (hmin > hmax) return { erro: "A duração mínima do turno não pode ser maior que a máxima." };
  const [sLo, sHi] = LIMITES.maxSemana;
  if (!inteiro(ms) || ms < sLo || ms > sHi) return { erro: `O máximo de turnos por semana por loja deve ser um inteiro de ${sLo} a ${sHi}.` };
  return { erro: "", cfg: { diariaCentavos: d, comissaoCentavos: c, repasseCentavos: r, taxaFixaCentavos: t, horasMin: hmin, horasMax: hmax, maxSemana: ms } };
}

const minutosEntre = (entrada, saida) => {
  const ok = (h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || ""));
  if (!ok(entrada) || !ok(saida)) return 0;
  const [h1, m1] = entrada.split(":").map(Number), [h2, m2] = saida.split(":").map(Number);
  return Math.max(0, h2 * 60 + m2 - (h1 * 60 + m1));
};

/** Divisão da diária. Sempre inteiros; comissão + repasse === diária (nada some, nada sobra). `cfg` = taxas vigentes. */
function calcularDiaria(cfg = PADRAO) {
  const { diariaCentavos: valor, comissaoCentavos: comissao, repasseCentavos: promotor, taxaFixaCentavos: taxaFixa } = cfg;
  if (comissao + promotor !== valor) throw new Error("Configuração financeira inconsistente: comissão + repasse deve ser igual à diária.");
  return {
    valor,
    promotor,
    comissao,
    royalty: comissao,                 // alias de compatibilidade
    taxaFixa,
    app: comissao + taxaFixa,
    total: valor + taxaFixa,
    pct: 100 - (promotor * 100) / valor,
    modelo: "diaria-v1",
    versaoTaxas: cfg.versao || 0       // qual versão das taxas gerou este split (rastreabilidade)
  };
}

/** Compatível com o código antigo: o valor não depende mais da duração (diária fixa). */
function calcularTurno(minutos, cfg = PADRAO) {
  const m = Math.round(minutos);
  if (!Number.isInteger(m) || m <= 0) throw new Error("duração inválida");
  return { ...calcularDiaria(cfg), minutos: m, horas: m / 60, liquidoPromotor: cfg.repasseCentavos };
}

/** "" se o horário é válido; senão a mensagem de erro. */
function validarTurno(entrada, saida, cfg = PADRAO) {
  const m = minutosEntre(entrada, saida);
  if (m <= 0) return "A saída precisa ser depois da entrada.";
  if (m < cfg.horasMin * 60) return `O turno precisa ter no mínimo ${cfg.horasMin} horas.`;
  if (m > cfg.horasMax * 60) return `O turno pode ter no máximo ${cfg.horasMax} horas.`;
  return "";
}

// ---------- semana (segunda a domingo) ----------
const paraUTC = (iso) => { const [a, m, d] = String(iso).split("-").map(Number); return new Date(Date.UTC(a, m - 1, d)); };
const deUTC = (dt) => dt.toISOString().slice(0, 10);
function limitesSemana(iso) {
  const dt = paraUTC(iso), dow = (dt.getUTCDay() + 6) % 7; // 0 = segunda
  const ini = new Date(dt); ini.setUTCDate(dt.getUTCDate() - dow);
  const fim = new Date(ini); fim.setUTCDate(ini.getUTCDate() + 6);
  return { inicio: deUTC(ini), fim: deUTC(fim) };
}
/** Quantos turnos desse promotor já existem na mesma loja, na semana da data informada. */
function vezesNaSemana(historico, lojaUid, dataIso, ignorarId = "") {
  const { inicio, fim } = limitesSemana(dataIso);
  return historico.filter((t) => t.id !== ignorarId && t.uid === lojaUid && STATUS_QUE_CONTAM.includes(t.status) && t.data >= inicio && t.data <= fim).length;
}

module.exports = {
  PADRAO, LIMITES, validarTaxas,
  VALOR_DIARIA_CENTAVOS, COMISSAO_PLATAFORMA_CENTAVOS, REPASSE_PROFISSIONAL_CENTAVOS, TAXA_FIXA_CENTAVOS,
  HORAS_MIN_TURNO, HORAS_MAX_TURNO, MAX_VEZES_SEMANA_LOJA, STATUS_QUE_CONTAM, PCT_REPASSE, PCT_COMISSAO,
  minutosEntre, calcularDiaria, calcularTurno, validarTurno, limitesSemana, vezesNaSemana
};
