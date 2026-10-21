import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as cfg from "../config.js";
import * as core from "../core.js";
const require = createRequire(import.meta.url);
const srv = require("../server/split.js");
const fn = require("../functions/split.js");

// 1) constantes idênticas entre navegador e servidor (e a cópia em functions/)
for (const k of ["ROYALTY_PCT", "TAXA_FIXA_CENTAVOS", "VALOR_HORA_PROMOTOR_CENTAVOS", "HORAS_MAX_TURNO", "MAX_VEZES_SEMANA_LOJA", "VALOR_MINIMO_CENTAVOS", "VALOR_MAXIMO_CENTAVOS"]) {
  assert.equal(cfg[k], srv[k], `${k} diverge (config.js x server/split.js)`);
  assert.equal(fn[k], srv[k], `${k} diverge (functions/split.js x server/split.js)`);
}
assert.deepEqual([cfg.ROYALTY_PCT, cfg.TAXA_FIXA_CENTAVOS, cfg.VALOR_HORA_PROMOTOR_CENTAVOS, cfg.HORAS_MAX_TURNO, cfg.MAX_VEZES_SEMANA_LOJA], [3, 500, 3500, 6, 3]);

// 2) valor-hora R$ 35: 4 h -> promotor recebe exatamente R$ 140,00; loja paga bruto + R$ 5,00; royalty = 3% do bruto
const t4 = core.calcularTurno(240);
assert.equal(t4.promotor, 14000);
assert.equal(t4.royalty, Math.round(t4.valor * 0.03));
assert.equal(t4.total, t4.valor + 500);
assert.equal(t4.app, t4.royalty + 500);

// 3) para QUALQUER duração permitida: nada some, nada sobra, promotor nunca recebe menos que horas × R$ 35, navegador == servidor
for (let m = 1; m <= 360; m++) {
  const a = core.calcularTurno(m), b = srv.calcularTurno(m);
  assert.deepEqual(a, b, `divergência em ${m} min`);
  const liquido = Math.round((m * 3500) / 60);
  assert.ok(a.promotor >= liquido && a.promotor <= liquido + 1, `promotor fora do esperado em ${m} min`);
  assert.equal(a.royalty, Math.round(a.valor * 3 / 100), `royalty != 3% em ${m} min`);
  assert.equal(a.promotor + a.app, a.total, `soma errada em ${m} min`);
}
for (let v = 1; v <= 200000; v += 7) assert.deepEqual(core.calcularSplit(v), srv.calcularSplit(v));

// 4) limite estrito de 6 horas
assert.equal(core.validarTurno("08:00", "14:00"), "");
assert.match(core.validarTurno("08:00", "14:01"), /6 horas/);
assert.match(core.validarTurno("06:00", "22:00"), /6 horas/);
assert.match(core.validarTurno("12:00", "08:00"), /depois da entrada/);
assert.equal(core.validarTurno("08:00", "14:01"), srv.validarTurno("08:00", "14:01"));
assert.equal(srv.minutosEntre("08:00", "x"), 0);

// 5) semana segunda–domingo e no máximo 3 vezes na mesma loja
assert.deepEqual(core.limitesSemana("2026-10-21"), { inicio: "2026-10-19", fim: "2026-10-25" });
assert.deepEqual(core.limitesSemana("2026-10-25"), { inicio: "2026-10-19", fim: "2026-10-25" });
assert.deepEqual(core.limitesSemana("2026-10-26"), { inicio: "2026-10-26", fim: "2026-11-01" });
assert.deepEqual(srv.limitesSemana("2026-01-01"), core.limitesSemana("2026-01-01"));
const hist = [
  { id: "a", uid: "lojaA", data: "2026-10-19", status: "paga" },
  { id: "b", uid: "lojaA", data: "2026-10-21", status: "aceita" },
  { id: "c", uid: "lojaA", data: "2026-10-25", status: "concluida" },
  { id: "d", uid: "lojaA", data: "2026-10-22", status: "cancelada" },   // cancelado não conta
  { id: "e", uid: "lojaB", data: "2026-10-22", status: "aceita" },      // outra loja não conta
  { id: "f", uid: "lojaA", data: "2026-10-26", status: "aceita" }       // outra semana não conta
];
assert.equal(core.vezesNaSemana(hist, "lojaA", "2026-10-23"), 3);
assert.equal(srv.vezesNaSemana(hist, "lojaA", "2026-10-23"), 3);
assert.equal(core.vezesNaSemana(hist, "lojaB", "2026-10-23"), 1);
assert.equal(core.vezesNaSemana(hist, "lojaA", "2026-10-27"), 1);
assert.equal(core.vezesNaSemana(hist, "lojaA", "2026-10-23", "a"), 2); // ignora o próprio pedido
assert.ok(core.vezesNaSemana(hist, "lojaA", "2026-10-23") >= cfg.MAX_VEZES_SEMANA_LOJA, "4º turno na semana deve ser barrado");

// 6) privacidade: o que cada lado enxerga
const s = core.calcularTurno(240);
assert.deepEqual(Object.keys(core.visaoLoja(s)).sort(), ["taxaFixa", "total", "valor"]);
assert.deepEqual(Object.keys(core.visaoPromotor(s)), ["liquido"]);
assert.equal(core.valorPromotor({ valorPromotorCentavos: 14000 }), 14000);

// 7) termos: a discriminação de taxas está nos Termos (e só neles)
for (const perfil of ["loja", "promotor"]) {
  const t = core.textoTermos(perfil);
  assert.match(t, /royalty de 3%/); assert.match(t, /R\$\s?5,00/); assert.match(t, /R\$\s?35,00/); assert.match(t, /6 horas/); assert.match(t, /3 vezes por semana/);
}
assert.match(core.textoTermos("loja"), /cartão de crédito válido/);

// 8) reais -> centavos sem erro de ponto flutuante
assert.equal(core.reaisParaCentavos("19,90"), 1990);
assert.equal(core.reaisParaCentavos(0.1 + 0.2), 30);
assert.equal(core.reaisParaCentavos("1.234,56"), 123456);
assert.throws(() => core.calcularSplit(0));
assert.throws(() => core.calcularTurno(0));

// 9) documentos
assert.ok(core.cpfValido("529.982.247-25")); assert.ok(!core.cpfValido("111.111.111-11")); assert.ok(!core.cpfValido("529.982.247-26"));
assert.ok(core.cnpjValido("11.222.333/0001-81")); assert.ok(!core.cnpjValido("11.222.333/0001-80"));
assert.equal(core.mascaraCPF("52998224725"), "529.982.247-25");
assert.equal(core.mascaraTelefone("19999998888"), "(19) 99999-8888");
console.log("✅ todos os testes passaram");
