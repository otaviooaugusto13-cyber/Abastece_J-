// ============================================================
// REGRAS DE NEGÓCIO DO SERVIDOR — é ela que vale de verdade.
// Deve ser idêntica a config.js/core.js (o teste test/split.test.js confere).
//
// Modelo de preço (por turno):
//   Promotor recebe (líquido) = horas × R$ 35,00
//   Valor bruto do serviço    = valor que fecha com o promotor após o royalty de 3%
//   Royalty da plataforma     = 3% do valor bruto
//   Loja paga                 = valor bruto + taxa de serviço fixa (R$ 5,00)
// ============================================================
const ROYALTY_PCT = 3;                       // % do valor bruto que fica com a plataforma
const TAXA_FIXA_CENTAVOS = 500;              // taxa de serviço fixa por turno (R$ 5,00)
const VALOR_HORA_PROMOTOR_CENTAVOS = 3500;   // R$ 35,00 por hora, líquido para o promotor
const HORAS_MAX_TURNO = 6;                   // limite estrito por turno
const MAX_VEZES_SEMANA_LOJA = 3;             // máx. de turnos do mesmo promotor na mesma loja por semana
const VALOR_MINIMO_CENTAVOS = 3000;
const VALOR_MAXIMO_CENTAVOS = 200000;
const STATUS_QUE_CONTAM = ["aceita", "paga", "concluida"];

const minutosEntre = (entrada, saida) => {
  const ok = (h) => /^\d{2}:\d{2}$/.test(String(h || ""));
  if (!ok(entrada) || !ok(saida)) return 0;
  const [h1, m1] = entrada.split(":").map(Number), [h2, m2] = saida.split(":").map(Number);
  return Math.max(0, h2 * 60 + m2 - (h1 * 60 + m1));
};

/** Valor líquido do promotor (centavos) para N minutos de trabalho. */
const liquidoDoTurno = (minutos) => Math.round((minutos * VALOR_HORA_PROMOTOR_CENTAVOS) / 60);

/** Divide um valor BRUTO. O promotor fica com o resto: nunca perde centavo por arredondamento. */
function calcularSplit(valorBrutoCentavos, pct = ROYALTY_PCT, taxaFixa = TAXA_FIXA_CENTAVOS) {
  const valor = Math.round(valorBrutoCentavos);
  if (!Number.isInteger(valor) || valor <= 0) throw new Error("valor inválido");
  const royalty = Math.round((valor * pct) / 100);
  const promotor = valor - royalty;
  return { valor, promotor, royalty, taxaFixa, app: royalty + taxaFixa, total: valor + taxaFixa, pct };
}

/** Menor valor bruto cujo líquido (bruto − royalty de 3%) é pelo menos o que o promotor deve receber. */
function brutoParaLiquido(liquido, pct = ROYALTY_PCT) {
  const g0 = Math.ceil((liquido * 100) / (100 - pct));
  for (let g = Math.max(1, g0 - 3); g <= g0 + 3; g++) if (g - Math.round((g * pct) / 100) >= liquido) return g;
  return g0 + 3;
}

/** Cálculo completo do turno a partir da duração. */
function calcularTurno(minutos) {
  const m = Math.round(minutos);
  if (!Number.isInteger(m) || m <= 0) throw new Error("duração inválida");
  const s = calcularSplit(brutoParaLiquido(liquidoDoTurno(m)));
  return { ...s, minutos: m, horas: m / 60, liquidoPromotor: s.promotor };
}

/** "" se o horário é válido; senão a mensagem de erro (regra estrita de 6 h). */
function validarTurno(entrada, saida) {
  const m = minutosEntre(entrada, saida);
  if (m <= 0) return "A saída precisa ser depois da entrada.";
  if (m > HORAS_MAX_TURNO * 60) return `O turno pode ter no máximo ${HORAS_MAX_TURNO} horas.`;
  const v = calcularTurno(m).valor;
  if (v < VALOR_MINIMO_CENTAVOS) return "Turno curto demais: o valor mínimo por turno não foi atingido.";
  if (v > VALOR_MAXIMO_CENTAVOS) return "Valor acima do máximo permitido por turno.";
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
  ROYALTY_PCT, TAXA_FIXA_CENTAVOS, VALOR_HORA_PROMOTOR_CENTAVOS, HORAS_MAX_TURNO, MAX_VEZES_SEMANA_LOJA,
  VALOR_MINIMO_CENTAVOS, VALOR_MAXIMO_CENTAVOS, STATUS_QUE_CONTAM,
  minutosEntre, liquidoDoTurno, calcularSplit, brutoParaLiquido, calcularTurno, validarTurno, limitesSemana, vezesNaSemana
};
