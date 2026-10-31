// Paridade navegador (config.js/core.js) × servidor (server/split.js, server/lib/config.js) e regras de negócio puras.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as cfg from "../config.js";
import * as core from "../core.js";
const require = createRequire(import.meta.url);
const srv = require("../server/split.js"), SC = require("../server/lib/config.js");

assert.deepEqual(cfg.EMPRESA, SC.EMPRESA, "EMPRESA diverge entre config.js e server/lib/config.js (emitente do comprovante)");

// 1) constantes idênticas entre navegador e servidor
for (const k of ["VALOR_DIARIA_CENTAVOS", "COMISSAO_PLATAFORMA_CENTAVOS", "REPASSE_PROFISSIONAL_CENTAVOS", "TAXA_FIXA_CENTAVOS", "HORAS_MIN_TURNO", "HORAS_MAX_TURNO", "MAX_VEZES_SEMANA_LOJA"])
  assert.equal(cfg[k], srv[k], `${k} diverge (config.js x server/split.js)`);
assert.deepEqual([cfg.MENOR_JANELA_INICIO, cfg.MENOR_JANELA_FIM, cfg.MENOR_SETORES_VEDADOS], [SC.MENOR.JANELA_INICIO, SC.MENOR.JANELA_FIM, SC.MENOR.SETORES_VEDADOS]);
assert.equal(cfg.IDADE_MINIMA, SC.IDADE_MINIMA); assert.equal(cfg.IDADE_MAIORIDADE, SC.IDADE_MAIORIDADE);
assert.deepEqual(core.SETORES.map((s) => s.v), SC.SETORES, "SETORES diverge entre core.js e server/lib/config.js");
assert.deepEqual(core.CATEGORIAS, SC.CATEGORIAS, "CATEGORIAS diverge entre core.js e server/lib/config.js");
assert.deepEqual(core.SETOR_CATEGORIA, SC.SETOR_CATEGORIA, "SETOR_CATEGORIA diverge entre core.js e server/lib/config.js");
for (const s of SC.SETORES) assert.ok(SC.CATEGORIAS[SC.SETOR_CATEGORIA[s]], `setor sem categoria de habilitação: ${s}`);
for (const s of SC.MENOR.SETORES_VEDADOS) assert.ok(SC.SETORES.includes(s), `setor vedado inexistente: ${s}`);

// 2) requisito: diária R$ 200 → R$ 50 plataforma + R$ 150 profissional
assert.deepEqual([cfg.VALOR_DIARIA_CENTAVOS, cfg.COMISSAO_PLATAFORMA_CENTAVOS, cfg.REPASSE_PROFISSIONAL_CENTAVOS], [20000, 5000, 15000]);
const d = core.calcularDiaria(); assert.deepEqual(d, srv.calcularDiaria());
assert.equal(d.promotor + d.app, d.total);
assert.equal(d.pct, 25); assert.equal(srv.PCT_REPASSE, 75);

// 3) qualquer duração permitida dá o mesmo preço, igual no navegador e no servidor
for (let m = 1; m <= 600; m++) { assert.deepEqual(core.calcularTurno(m), srv.calcularTurno(m)); assert.equal(core.validarTurno("08:00", `${String(8 + Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`.replace(/^(2[4-9]|[3-9]\d)/, "23")), srv.validarTurno("08:00", `${String(8 + Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`.replace(/^(2[4-9]|[3-9]\d)/, "23"))); }
assert.equal(core.calcularTurno(240).total, 20000);

// 4) limites de turno (4–6 h)
assert.equal(core.validarTurno("08:00", "12:00"), ""); assert.equal(core.validarTurno("08:00", "14:00"), "");
assert.match(core.validarTurno("08:00", "11:59"), /mínimo/); assert.match(core.validarTurno("08:00", "14:01"), /máximo/); assert.match(core.validarTurno("12:00", "08:00"), /depois da entrada/);
assert.equal(core.minutosEntre("08:00", "24:00"), 0); assert.equal(srv.minutosEntre("08:00", "x"), 0);

// 5) semana segunda–domingo e máximo de 3 por semana/loja
assert.deepEqual(core.limitesSemana("2026-10-21"), { inicio: "2026-10-19", fim: "2026-10-25" });
assert.deepEqual(srv.limitesSemana("2026-01-01"), core.limitesSemana("2026-01-01"));
const hist = [{ id: "a", uid: "L", data: "2026-10-19", status: "paga" }, { id: "b", uid: "L", data: "2026-10-21", status: "aceita" }, { id: "c", uid: "L", data: "2026-10-25", status: "concluida" }, { id: "d", uid: "L", data: "2026-10-22", status: "cancelada" }, { id: "e", uid: "M", data: "2026-10-22", status: "aceita" }];
assert.equal(core.vezesNaSemana(hist, "L", "2026-10-23"), 3); assert.equal(srv.vezesNaSemana(hist, "L", "2026-10-23"), 3);

// 6) idade: 16 é o mínimo; 16–17 é "menor"; 18 não é; datas impossíveis rejeitadas
const f = (anos, dd = 0) => { const [a, m, dia] = core.hojeLocal().split("-").map(Number); return new Date(Date.UTC(a - anos, m - 1, dia - dd)).toISOString().slice(0, 10); };
assert.match(core.validarNascimento(f(15)).erro, /16 anos/); assert.match(core.validarNascimento(f(16, -1)).erro, /16 anos/);
assert.deepEqual([core.validarNascimento(f(16)).erro, core.validarNascimento(f(16)).menor], ["", true]);
assert.equal(core.validarNascimento(f(17, 1)).menor, true); assert.equal(core.validarNascimento(f(18)).menor, false);
assert.ok(core.validarNascimento("2010-02-31").erro); assert.ok(core.validarNascimento("").erro); assert.ok(core.validarNascimento("2999-01-01").erro);
assert.equal(core.limitesNascimento().max, f(16));

// 7) privacidade: o que cada lado enxerga
assert.deepEqual(Object.keys(core.visaoLoja(d)).sort(), ["taxaFixa", "total", "valor"]); assert.deepEqual(Object.keys(core.visaoPromotor(d)), ["liquido"]);
assert.equal(core.valorPromotor({}), 15000); assert.equal(core.valorPromotor({ valorPromotorCentavos: 15000 }), 15000);

// 8) Termos: informam diária, comissão, repasse, idade e treinamento — e só eles discriminam isso
for (const perfil of ["loja", "promotor"]) { const t = core.textoTermos(perfil); assert.ok(t.includes("R$") && /200,00/.test(t) && /50,00/.test(t) && /150,00/.test(t), perfil); }
assert.match(core.textoTermos("promotor"), /PRATICAMENTE/); assert.match(core.textoTermos("promotor"), /16 anos/);
assert.equal(core.esc("<img onerror=alert(1)>"), "&lt;img onerror=alert(1)&gt;");

// 9) taxas DINÂMICAS: com os mesmos valores, navegador (core.js) e servidor (split.js) calculam exatamente igual
{
  const nova = { diariaCentavos: 31000, comissaoCentavos: 6200, repasseCentavos: 24800, taxaFixaCentavos: 350, horasMin: 3, horasMax: 8.5, maxSemana: 5, versao: 4 };
  const { erro, cfg: ok } = srv.validarTaxas(nova); assert.equal(erro, "");
  assert.equal(core.aplicarTaxas({ ...ok, versao: 4 }), true);
  assert.deepEqual(core.calcularDiaria(), srv.calcularDiaria({ ...ok, versao: 4 }));
  for (const m of [60, 180, 240, 510, 511]) assert.deepEqual(core.calcularTurno(m), srv.calcularTurno(m, { ...ok, versao: 4 }));
  // taxas dinâmicas + níveis: a comissão do Bronze é a vigente e os demais níveis escalam (navegador e servidor idênticos); o split congelado se reconstrói
  for (const n of ["bronze", "prata", "ouro", "platina"]) for (const b of [0, 3000]) { const sv = srv.calcularDiaria({ ...ok, versao: 4 }, n, b); assert.deepEqual(core.calcularDiaria(n, b), sv, `dinâmico ${n}/${b}`); assert.deepEqual(srv.calcularDiaria(srv.cfgDoSplit(sv), n, b), sv, `congelado ${n}/${b}`); assert.equal(sv.promotor + sv.app, sv.total); }
  assert.equal(srv.calcularDiaria({ ...ok, versao: 4 }, "bronze").comissao, 6200); assert.equal(srv.calcularDiaria({ ...ok, versao: 4 }, "platina").comissao, 2480);
  for (const [e, sd] of [["08:00", "10:59"], ["08:00", "11:00"], ["08:00", "16:30"], ["08:00", "16:31"]]) assert.equal(core.validarTurno(e, sd), srv.validarTurno(e, sd, ok), `${e}-${sd}`);
  assert.equal(core.valorPromotor({}), 24800); assert.match(core.textoTermos("loja"), /310,00/); assert.match(core.textoTermos("loja"), /62,00/); assert.match(core.textoTermos("loja"), /248,00/);
  assert.equal(core.calcularDiaria().total, 31350); assert.equal(core.calcularDiaria().promotor + core.calcularDiaria().app, 31350);
  // lixo vindo da rede nunca contamina a tela: mantém o último valor bom
  assert.equal(core.aplicarTaxas({ ...nova, repasseCentavos: 1 }), false); assert.equal(core.aplicarTaxas(null), false); assert.equal(core.aplicarTaxas({ ...nova, diariaCentavos: NaN }), false);
  assert.equal(core.TAXAS.repasseCentavos, 24800);
  // volta ao padrão para não afetar nada depois
  core.aplicarTaxas({ diariaCentavos: 20000, comissaoCentavos: 5000, repasseCentavos: 15000, taxaFixaCentavos: 0, horasMin: 4, horasMax: 6, maxSemana: 3, versao: 0 });
  assert.deepEqual(core.calcularDiaria(), srv.calcularDiaria());
  // o servidor jamais aceita split inconsistente
  assert.throws(() => srv.calcularDiaria({ ...ok, repasseCentavos: 1 }), /inconsistente/);
}
console.log("✓ paridade navegador×servidor, diária 200/50/150, idade 16+ e termos");

// 9) Camada de níveis/jogo: servidor e navegador idênticos
assert.deepEqual(cfg.NIVEIS.map((n) => [n.id, n.comissaoPct, n.minConcluidos]), srv.NIVEIS.map((n) => [n.id, n.comissaoPct, n.minConcluidos]), "NIVEIS diverge");
assert.deepEqual(cfg.CHAMADOS_PARA_SUBIR, srv.CHAMADOS_PARA_SUBIR);
for (const [n, id] of [[0, "bronze"], [29, "bronze"], [30, "prata"], [89, "prata"], [90, "ouro"], [189, "ouro"], [190, "platina"]]) { assert.equal(srv.nivelPorConcluidos(n).id, id); assert.equal(core.nivelPorConcluidos(n).id, id); }
for (const n of ["bronze", "prata", "ouro", "platina"]) for (const b of [0, 3000]) assert.deepEqual(core.calcularDiaria(n, b), srv.calcularDiaria(srv.PADRAO, n, b), `calcularDiaria ${n}/${b}`);
assert.equal(cfg.GEO_RAIO_METROS, SC.GEO.RAIO_METROS); assert.equal(cfg.VIDAS_MAX, SC.VIDAS_MAX); assert.equal(cfg.CANCELAMENTO_TARDIO_HORAS, SC.CANCELAMENTO_TARDIO_HORAS);
assert.deepEqual(cfg.BONUS_RUPTURA_CENTAVOS, SC.RUPTURA.BONUS_OPCOES_CENTAVOS);
for (const perfil of ["loja", "promotor"]) { const t = core.textoTermos(perfil); assert.match(t, /Platina 10%/); assert.match(t, /advertência/); assert.match(t, /100 m|foto/); }
