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
// ============================================================
const VALOR_DIARIA_CENTAVOS = 20000;
const COMISSAO_PLATAFORMA_CENTAVOS = 5000;
const REPASSE_PROFISSIONAL_CENTAVOS = 15000;
const TAXA_FIXA_CENTAVOS = 0;                 // não há taxa adicional para a loja neste modelo
const HORAS_MIN_TURNO = 4;                    // diária: turno mínimo (suposição — ajuste conforme o negócio)
const HORAS_MAX_TURNO = 6;                    // limite estrito por turno (regra já existente)
const MAX_VEZES_SEMANA_LOJA = 3;              // máx. de turnos do mesmo promotor na mesma loja por semana
const STATUS_QUE_CONTAM = ["aceita", "paga", "concluida"];

if (COMISSAO_PLATAFORMA_CENTAVOS + REPASSE_PROFISSIONAL_CENTAVOS !== VALOR_DIARIA_CENTAVOS) {
  throw new Error("Configuração financeira inconsistente: comissão + repasse deve ser igual à diária.");
}
const PCT_REPASSE = (REPASSE_PROFISSIONAL_CENTAVOS * 100) / VALOR_DIARIA_CENTAVOS; // 75
const PCT_COMISSAO = 100 - PCT_REPASSE;                                             // 25

const minutosEntre = (entrada, saida) => {
  const ok = (h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || ""));
  if (!ok(entrada) || !ok(saida)) return 0;
  const [h1, m1] = entrada.split(":").map(Number), [h2, m2] = saida.split(":").map(Number);
  return Math.max(0, h2 * 60 + m2 - (h1 * 60 + m1));
};

/** Divisão da diária. Sempre inteiros; comissão + repasse === total (nada some, nada sobra). */
function calcularDiaria() {
  return {
    valor: VALOR_DIARIA_CENTAVOS,
    promotor: REPASSE_PROFISSIONAL_CENTAVOS,
    comissao: COMISSAO_PLATAFORMA_CENTAVOS,
    royalty: COMISSAO_PLATAFORMA_CENTAVOS,      // alias de compatibilidade
    taxaFixa: TAXA_FIXA_CENTAVOS,
    app: COMISSAO_PLATAFORMA_CENTAVOS + TAXA_FIXA_CENTAVOS,
    total: VALOR_DIARIA_CENTAVOS + TAXA_FIXA_CENTAVOS,
    pct: PCT_COMISSAO,
    modelo: "diaria-v1"
  };
}

/** Compatível com o código antigo: o valor não depende mais da duração (diária fixa). */
function calcularTurno(minutos) {
  const m = Math.round(minutos);
  if (!Number.isInteger(m) || m <= 0) throw new Error("duração inválida");
  return { ...calcularDiaria(), minutos: m, horas: m / 60, liquidoPromotor: REPASSE_PROFISSIONAL_CENTAVOS };
}

/** "" se o horário é válido; senão a mensagem de erro. */
function validarTurno(entrada, saida) {
  const m = minutosEntre(entrada, saida);
  if (m <= 0) return "A saída precisa ser depois da entrada.";
  if (m < HORAS_MIN_TURNO * 60) return `O turno precisa ter no mínimo ${HORAS_MIN_TURNO} horas.`;
  if (m > HORAS_MAX_TURNO * 60) return `O turno pode ter no máximo ${HORAS_MAX_TURNO} horas.`;
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
  VALOR_DIARIA_CENTAVOS, COMISSAO_PLATAFORMA_CENTAVOS, REPASSE_PROFISSIONAL_CENTAVOS, TAXA_FIXA_CENTAVOS,
  HORAS_MIN_TURNO, HORAS_MAX_TURNO, MAX_VEZES_SEMANA_LOJA, STATUS_QUE_CONTAM, PCT_REPASSE, PCT_COMISSAO,
  minutosEntre, calcularDiaria, calcularTurno, validarTurno, limitesSemana, vezesNaSemana
};
