import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as cfg from "../config.js";
import * as core from "../core.js";
const require = createRequire(import.meta.url);
const srv = require("../functions/split.js");

// 1) constantes idênticas entre navegador e servidor
assert.equal(cfg.PLATAFORMA_PCT, srv.PLATAFORMA_PCT, "PLATAFORMA_PCT diverge");
assert.equal(cfg.TAXA_FIXA_CENTAVOS, srv.TAXA_FIXA_CENTAVOS, "TAXA_FIXA diverge");
assert.equal(cfg.VALOR_MINIMO_CENTAVOS, srv.VALOR_MINIMO_CENTAVOS);
assert.equal(cfg.VALOR_MAXIMO_CENTAVOS, srv.VALOR_MAXIMO_CENTAVOS);

// 2) exemplo da conversa: turno de R$ 100 -> 80 promotor / 20 app + R$ 5 fixo
const s = core.calcularSplit(10000);
assert.deepEqual([s.promotor, s.comissaoApp, s.taxaFixa, s.app, s.total], [8000, 2000, 500, 2500, 10500]);

// 3) para qualquer valor: nada some, nada sobra, e navegador == servidor
for (let v = 1; v <= 200000; v += 7) {
  const a = core.calcularSplit(v), b = srv.calcularSplit(v);
  assert.deepEqual(a, b, `divergência em ${v}`);
  assert.equal(a.promotor + a.app, a.total, `soma errada em ${v}`);
  assert.ok(a.promotor > 0 && a.promotor >= a.valor - Math.ceil(a.valor * 0.2), `promotor perdeu centavo em ${v}`);
}

// 4) reais -> centavos sem erro de ponto flutuante
assert.equal(core.reaisParaCentavos("19,90"), 1990);
assert.equal(core.reaisParaCentavos(0.1 + 0.2), 30);
assert.equal(core.reaisParaCentavos("1.234,56"), 123456);
assert.throws(() => core.calcularSplit(0));
assert.throws(() => core.calcularSplit(NaN));

// 5) documentos
assert.ok(core.cpfValido("529.982.247-25"));
assert.ok(!core.cpfValido("111.111.111-11"));
assert.ok(!core.cpfValido("529.982.247-26"));
assert.ok(core.cnpjValido("11.222.333/0001-81"));
assert.ok(!core.cnpjValido("11.222.333/0001-80"));
assert.equal(core.mascaraCPF("52998224725"), "529.982.247-25");
assert.equal(core.mascaraCNPJ("11222333000181"), "11.222.333/0001-81");
assert.equal(core.mascaraTelefone("19999998888"), "(19) 99999-8888");

// 6) validação de faixa
assert.ok(core.validarValor(1000));
assert.equal(core.validarValor(10000), "");
console.log("✅ todos os testes passaram");
