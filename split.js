// REGRA FINANCEIRA DO SERVIDOR — é ela que vale de verdade.
// Deve ser idêntica a config.js/core.js (o teste test/split.test.js confere).
const PLATAFORMA_PCT = 20;       // % do valor do turno que fica com o app
const TAXA_FIXA_CENTAVOS = 500;  // taxa fixa por turno (R$ 5,00)
const VALOR_MINIMO_CENTAVOS = 3000;
const VALOR_MAXIMO_CENTAVOS = 200000;

function calcularSplit(valorCentavos, pct = PLATAFORMA_PCT, taxaFixa = TAXA_FIXA_CENTAVOS) {
  const valor = Math.round(valorCentavos);
  if (!Number.isInteger(valor) || valor <= 0) throw new Error("valor inválido");
  const comissaoApp = Math.round((valor * pct) / 100);
  const promotor = valor - comissaoApp;
  return { valor, promotor, comissaoApp, taxaFixa, app: comissaoApp + taxaFixa, total: valor + taxaFixa, pct };
}
module.exports = { calcularSplit, PLATAFORMA_PCT, TAXA_FIXA_CENTAVOS, VALOR_MINIMO_CENTAVOS, VALOR_MAXIMO_CENTAVOS };
