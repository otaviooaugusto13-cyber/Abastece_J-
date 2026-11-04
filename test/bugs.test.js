// Bateria do rastreador de bugs e do monitor de saúde: partes PURAS (sem banco, sem rede, sem relógio real).
// As rotas e a abertura do chamado automático são testadas em ti.test.cjs (precisam do servidor falso).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { classificarBug, LIMITE_AFETADOS, LIMITE_OCORRENCIAS } = require("../server/lib/ti/classificador.js");
const { redigir: redigirServidor } = require("../server/lib/ti/redacao.js");
const { sanitizarContexto, dispositivoDe, rotaSegura } = require("../server/lib/ti/bug-contexto.js");
const { criarSaude } = require("../server/lib/ti/saude.js");
const { criarSondas } = require("../server/lib/ti/sondas.js");
const G = require("../server/lib/geo.js");
const { redigir: redigirCliente, montarRelatorio, PREFIXO_BUG } = await import("../erros-nucleo.js");
const N = await import("../ti-fila-nucleo.js");

const testes = []; const t = (nome, fn) => testes.push([nome, fn]);
const MIN = 60_000;

// ======================= classificação de criticidade =======================
t("classificador: fluxo financeiro e alcance → crítica; falha tratada/página pública/módulo velho → baixa; resto → média", () => {
  const c = (o) => classificarBug(o).prioridade;
  assert.equal(c({ origem: "window.onerror", rota: "/pagar.html", nome: "TypeError" }), "critica");
  assert.equal(c({ origem: "api", rota: "/painel-loja", mensagem: "POST criarCobranca: Erro interno" }), "critica");
  assert.equal(c({ origem: "api", mensagem: "POST carteira/saque: Erro interno" }), "critica");
  assert.equal(c({ origem: "unhandledrejection", mensagem: "webhookMP falhou" }), "critica");
  assert.equal(c({ origem: "window.onerror", rota: "/painel-loja", mensagem: "x is not a function" }), "media");
  assert.equal(c({ origem: "api", rota: "/painel-promotor", mensagem: "POST turnos/aceitar: Erro interno" }), "media");
  assert.equal(c({ origem: "manual", rota: "/painel-loja" }), "baixa");
  assert.equal(c({ origem: "window.onerror", perfil: "publico", rota: "/landing.html" }), "baixa");
  assert.equal(c({ nome: "ChunkLoadError", mensagem: "Loading chunk 7 failed" }), "baixa");
  assert.equal(c({ nome: "QuotaExceededError", mensagem: "storage cheio" }), "baixa");
  assert.equal(c({}), "media", "sem nenhuma informação: média (nunca esconde nem exagera)");
});
t("classificador: alcance vence tudo (inclusive 'baixa') e usa limites exatos; falha manual no financeiro NÃO vira crítica", () => {
  assert.equal(classificarBug({ origem: "manual", afetados: LIMITE_AFETADOS }).prioridade, "critica");
  assert.equal(classificarBug({ origem: "manual", afetados: LIMITE_AFETADOS - 1 }).prioridade, "baixa");
  assert.equal(classificarBug({ ocorrencias: LIMITE_OCORRENCIAS }).prioridade, "critica");
  assert.equal(classificarBug({ ocorrencias: LIMITE_OCORRENCIAS - 1 }).prioridade, "media");
  assert.equal(classificarBug({ origem: "manual", rota: "/pagar.html" }).prioridade, "baixa", "já tratado pelo app: não aciona plantão");
  assert.ok(classificarBug({ afetados: 7 }).motivos[0].includes("7 usuários"), "o motivo explica a decisão");
});

// ======================= redação e contexto =======================
t("redação do servidor tem paridade com a do navegador (LGPD nos dois lados)", () => {
  const amostras = ["Falhou para joao.silva@exemplo.com.br", "CPF 123.456.789-09 e CNPJ 12.345.678/0001-90", "Ligue (19) 99876-5432 agora", "Authorization: Bearer abcdefghijklmnop123456",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk", "https://x.com/p?token=segredo&a=1&senha=123", "texto normal sem dados", "stack at f (file.js:123:45)"];
  for (const a of amostras) assert.equal(redigirServidor(a), redigirCliente(a), `divergiu em: ${a}`);
  assert.ok(!redigirServidor("a@b.com 123.456.789-09").match(/@|123\.456/));
});
t("contexto: rota sem query/hash, usuário só do token, dispositivo reconhecido, stack com quebras de linha e nada de dado pessoal", () => {
  const ctx = sanitizarContexto({ rota: "https://app.com/painel-loja?token=abc#x", versao: "abastece-v15", origem: "api", perfil: "loja", nome: "ApiError", mensagem: "falhou p/ a@b.com",
    navegador: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1", viewport: "390x844", stack: "Error: x\n   at a (f.js:1:1)\n   at b (f.js:2:2)",
    usuario: { uid: "FORJADO" }, uid: "FORJADO" }, { uid: "u1", tipo: "loja", impressao: "abc123abc123" });
  assert.equal(ctx.rota, "/painel-loja"); assert.deepEqual(ctx.usuario, { uid: "u1", tipo: "loja" });
  assert.deepEqual(ctx.dispositivo, { tipo: "celular", so: "iOS 17.4", navegador: "Safari 17" });
  assert.equal(ctx.stack.split("\n").length, 3); assert.ok(!JSON.stringify(ctx).includes("a@b.com") && !JSON.stringify(ctx).includes("FORJADO") && !JSON.stringify(ctx).includes("token=abc"));
  assert.equal(dispositivoDe("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0 Safari/537.36 Edg/125.0").navegador, "Edge 125");
  assert.equal(dispositivoDe("").tipo, "desconhecido"); assert.equal(rotaSegura(42), "");
});
t("contexto hostil (tipos errados, enorme, objetos aninhados) nunca lança e fica dentro dos limites", () => {
  for (const lixo of [null, undefined, "texto", 42, [1, 2], () => 1, { rota: { a: 1 }, versao: ["x"], stack: 9, viewport: "<script>", origem: "evil", perfil: { $gt: "" } }]) {
    const c = sanitizarContexto(lixo, { uid: "u", tipo: "loja", impressao: "i123456" });
    assert.equal(c.origem, ""); assert.equal(c.perfil === "" || c.perfil === "loja", true); assert.equal(c.viewport, ""); assert.ok(typeof c.rota === "string" && typeof c.stack === "string");
  }
  const g = sanitizarContexto({ stack: "x\n".repeat(5000), mensagem: "m".repeat(5000), navegador: "n".repeat(5000), tela: "t".repeat(999) }, { uid: "u", tipo: "loja", impressao: "i123456" });
  assert.ok(g.stack.length <= 1500 && g.mensagem.length <= 300 && g.navegador.length <= 160 && g.tela.length <= 60);
});
t("relatório do navegador: título começa com [AUTO-BUG] (≤120) e o contexto estruturado leva rota, versão, navegador e pilha redigida", () => {
  const e = { nome: "TypeError", mensagem: "x falhou para a@b.com", stack: "TypeError: x\n    at f (https://a.com/s.js?token=zzz:1:2)", origem: "window.onerror" };
  const r = montarRelatorio(e, { url: "https://app.com/painel-loja?x=1#h", versao: "abastece-v15", perfil: "loja", navegador: "UA/1", viewport: "390x844", online: true, fuso: "America/Sao_Paulo", tela: "screen-main" });
  assert.ok(r.titulo.startsWith(`${PREFIXO_BUG} TypeError:`) && r.titulo.length <= 120);
  assert.equal(r.contexto.rota, "/painel-loja"); assert.equal(r.contexto.versao, "abastece-v15"); assert.equal(r.contexto.viewport, "390x844");
  assert.ok(!r.contexto.stack.includes("zzz") && !r.contexto.mensagem.includes("a@b.com"), "nada sensível vai no contexto");
  assert.ok(montarRelatorio({ ...e, mensagem: "y".repeat(900) }, {}).titulo.length <= 120);
});

// ======================= monitor de saúde =======================
const relogio = () => { const r = { agora: 1_700_000_000_000 }; r.fn = () => r.agora; return r; };
const sonda = (nome, fn, extra = {}) => ({ nome, tipo: "externo", fn, ...extra });
t("saúde: ok → 1ª falha só 'degradado' → 2ª seguida 'fora' → recupera sozinha (histerese contra alarme falso)", async () => {
  let falha = false; const s = criarSaude({ sondas: { x: sonda("X", async () => { if (falha) throw new Error("timeout"); return {}; }) }, medir: () => 0 });
  const est = async () => { await s.verificar(); return s.resumo().servicos[0].status; };
  assert.equal(await est(), "ok"); falha = true;
  assert.equal(await est(), "degradado"); assert.match(s.resumo().servicos[0].detalhe, /confirmando/);
  assert.equal(await est(), "fora"); assert.equal(s.resumo().geral, "fora");
  falha = false; assert.equal(await est(), "ok"); assert.equal(s.resumo().geral, "ok");
});
t("saúde: latência acima do limite vira 'degradado'; o detalhe diz o limite; a latência é a medida (ou a informada pela sonda)", async () => {
  let ms = 100; const s = criarSaude({ sondas: { x: sonda("X", async () => ({ latenciaMs: ms }), { lentoMs: 500 }) } });
  await s.verificar(); assert.equal(s.resumo().servicos[0].status, "ok"); assert.equal(s.resumo().servicos[0].latenciaMs, 100);
  ms = 900; await s.verificar(); const v = s.resumo().servicos[0]; assert.equal(v.status, "degradado"); assert.match(v.detalhe, /900 ms.*500 ms/);
});
t("saúde: 'nao_configurado' e 'desconhecido' não contam no estado geral nem na disponibilidade; pior estado manda", async () => {
  const s = criarSaude({ sondas: { a: sonda("A", async () => ({})), b: sonda("B", async () => ({ estado: "nao_configurado", detalhe: "sem token" })), c: sonda("C", async () => ({ estado: "degradado", detalhe: "429" })) } });
  assert.equal(s.resumo().geral, "desconhecido"); assert.ok(s.resumo().servicos.every((x) => x.status === "desconhecido" && x.historico.length === 0));
  await s.verificar(); const r = s.resumo(); assert.equal(r.geral, "degradado");
  const b = r.servicos.find((x) => x.id === "b"); assert.equal(b.status, "nao_configurado"); assert.equal(b.latenciaMs, null); assert.equal(b.historico.length, 0); assert.equal(b.disponibilidadePct, null);
  const so = criarSaude({ sondas: { b: sonda("B", async () => ({ estado: "nao_configurado" })) } }); await so.verificar(); assert.equal(so.resumo().geral, "desconhecido");
});
t("saúde: sonda travada estoura o tempo limite sem atrasar as outras; histórico e disponibilidade; erro nunca vaza stack", async () => {
  const s = criarSaude({ timeoutMs: 40, historicoMax: 3, sondas: { lenta: sonda("Lenta", () => new Promise(() => {})), rapida: sonda("Rápida", async () => ({})), vaza: sonda("Vaza", async () => { throw Object.assign(new Error("boom\n    at secreto (/srv/app.js:1:1)\n" + "x".repeat(500)), {}); }) } });
  const t0 = Date.now(); await s.verificar(); assert.ok(Date.now() - t0 < 1000, "não esperou o travado por muito tempo");
  const r = s.resumo(), por = Object.fromEntries(r.servicos.map((x) => [x.id, x]));
  assert.equal(por.rapida.status, "ok"); assert.equal(por.lenta.status, "degradado"); assert.match(por.lenta.detalhe, /sem resposta/);
  assert.ok(por.vaza.detalhe.length <= 190 && !/\n/.test(por.vaza.detalhe), "uma linha, curto"); 
  for (let i = 0; i < 4; i++) await s.verificar(); assert.equal(s.resumo().servicos.find((x) => x.id === "rapida").historico.length, 3, "histórico limitado");
  const lenta = s.resumo().servicos.find((x) => x.id === "lenta"); assert.equal(lenta.status, "fora"); assert.ok(lenta.disponibilidadePct < 100);
});
t("saúde: obter() mede na 1ª vez, usa cache depois, e 'forçar' respeita 10 s (ninguém martela as APIs); duas chamadas simultâneas dividem a rodada", async () => {
  const R = relogio(); let n = 0; const s = criarSaude({ relogio: R.fn, sondas: { x: sonda("X", async () => { n++; await new Promise((r) => setTimeout(r, 5)); return {}; }) } });
  await Promise.all([s.obter(), s.obter()]); assert.equal(n, 1, "rodada compartilhada");
  await s.obter(); await s.obter({ forcar: true }); assert.equal(n, 1, "dentro de 10 s usa o cache");
  R.agora += 11_000; await s.obter({ forcar: true }); assert.equal(n, 2);
  await s.obter(); assert.equal(n, 2, "sem forçar, nunca remede");
});
t("saúde: webhook passivo conta só 2xx e 5xx (401 de quem bate sem assinatura é ruído) e olha a janela de 15 min", () => {
  const R = relogio(); const s = criarSaude({ relogio: R.fn });
  for (const status of [401, 401, 503 - 100, 200, 200, 500, 404]) s.registrarWebhook({ status });
  const w = s.webhookRecente(); assert.equal(w.total, 3, "200,200,500 (401/404/403 ignorados)"); assert.equal(w.falhas, 1); assert.ok(Math.abs(w.taxa - 1 / 3) < 1e-9);
  R.agora += 16 * MIN; assert.equal(s.webhookRecente().total, 0, "fora da janela");
  assert.ok(s.webhookRecente().ultimoEm, "mas lembra do último evento");
});

// ======================= sondas reais (com rede falsa) =======================
const resp = (status, corpo = "[]") => ({ status, ok: status >= 200 && status < 300, arrayBuffer: async () => new ArrayBuffer(0), text: async () => corpo });
const dbOk = { collection: () => ({ doc: () => ({ get: async () => ({}) }) }) }, adminOk = { auth: () => ({ listUsers: async () => ({}) }) };
const montar = (o = {}) => { const saude = criarSaude({}); const sondas = criarSondas({ db: dbOk, admin: adminOk, G, saude, mpToken: "tok", baseUrl: "https://app.exemplo.com", segredoWebhook: true, fetchFn: async () => resp(200), ...o }); return { sondas, saude }; };
const medirUma = async (s) => { const r = criarSaude({ sondas: { x: s } }); await r.verificar(); await r.verificar(); return r.resumo().servicos[0]; };   // 2 rodadas: confirma "fora" após a histerese
t("sonda Mercado Pago: 200 ok · 401/403 credencial recusada (fora) · 429 degradado · 500 fora · sem token = não configurado; token só vai no cabeçalho", async () => {
  const chamadas = []; const mp = (status) => montar({ fetchFn: async (u, init) => { chamadas.push([u, init]); return resp(status); } }).sondas.mercadopago;
  assert.equal((await medirUma(mp(200))).status, "ok");
  const c = chamadas[0]; assert.equal(c[0], "https://api.mercadopago.com/v1/payment_methods"); assert.equal(c[1].headers.Authorization, "Bearer tok"); assert.ok(c[1].signal, "tem timeout"); assert.ok(!c[0].includes("tok"), "token fora da URL");
  const r401 = await medirUma(mp(401)); assert.equal(r401.status, "fora"); assert.match(r401.detalhe, /Credencial recusada/); assert.ok(!r401.detalhe.includes("tok"));
  assert.equal((await medirUma(mp(403))).status, "fora"); assert.equal((await medirUma(mp(500))).status, "fora");
  const r429 = await medirUma(mp(429)); assert.equal(r429.status, "degradado"); assert.match(r429.detalhe, /429/);
  assert.equal((await medirUma(montar({ mpToken: "" }).sondas.mercadopago)).status, "nao_configurado");
  assert.equal((await medirUma(montar({ fetchFn: async () => { throw new Error("ECONNRESET"); } }).sondas.mercadopago)).status, "fora");
});
t("sonda de webhooks: recusar sem assinatura (401) = ok; aceitar/5xx/rede caída = fora; falhas reais recentes degradam/derrubam; sem segredo = não configurado", async () => {
  const web = (status, pre) => { const m = montar({ fetchFn: async () => resp(status) }); pre?.(m.saude); return m.sondas.webhooks; };
  const ok = await medirUma(web(401)); assert.equal(ok.status, "ok"); assert.match(ok.detalhe, /Recusa chamadas sem assinatura/);
  assert.equal((await medirUma(web(200))).status, "fora", "aceitar sem assinatura NÃO é saudável");
  assert.equal((await medirUma(web(502))).status, "fora");
  const urls = []; await medirUma(montar({ fetchFn: async (u, i) => { urls.push([u, i.method]); return resp(401); } }).sondas.webhooks); assert.deepEqual(urls[0], ["https://app.exemplo.com/webhookMP", "POST"]);
  const feed = (n, falhas) => (sa) => { for (let i = 0; i < n; i++) sa.registrarWebhook({ status: i < falhas ? 500 : 200 }); };
  assert.equal((await medirUma(web(401, feed(10, 3)))).status, "degradado", "30% de falha");
  assert.equal((await medirUma(web(401, feed(10, 6)))).status, "fora", "60% de falha");
  assert.equal((await medirUma(web(401, feed(4, 4)))).status, "ok", "poucos eventos: sem conclusão precipitada");
  assert.equal((await medirUma(montar({ segredoWebhook: false }).sondas.webhooks)).status, "nao_configurado");
});
t("sonda Firebase: mede Firestore + Auth, informa o pior tempo e nomeia o que caiu", async () => {
  const falhaAuth = { auth: () => ({ listUsers: async () => { throw new Error("auth down"); } }) }, falhaTudo = { collection: () => ({ doc: () => ({ get: async () => { throw new Error("x"); } }) }) };
  const ok = await medirUma(montar().sondas.firebase); assert.equal(ok.status, "ok"); assert.match(ok.detalhe, /Firestore .* ms · Auth .* ms/);
  assert.match((await medirUma(montar({ admin: falhaAuth }).sondas.firebase)).detalhe, /^Auth sem resposta$/);
  assert.match((await medirUma(montar({ db: falhaTudo, admin: falhaAuth }).sondas.firebase)).detalhe, /Firestore e Auth/);
});
t("sonda de geolocalização: sem provedor externo valida o cálculo do geofence (interno, honesto); com GEO_HEALTH_URL mede o provedor; pega regressão no cálculo", async () => {
  const interna = await medirUma(montar().sondas.geolocalizacao); assert.equal(interna.status, "ok"); assert.equal(interna.tipo, "interno"); assert.match(interna.detalhe, /sem dependência externa/);
  assert.equal((await medirUma(montar({ G: { ...G, distanciaM: () => 5 } }).sondas.geolocalizacao)).status, "fora", "distância errada é detectada");
  assert.equal((await medirUma(montar({ G: { ...G, coordenadas: (c) => c } }).sondas.geolocalizacao)).status, "fora", "0/0 aceito é detectado");
  const ext = montar({ geoUrl: "https://mapas.exemplo.com/ping" }).sondas.geolocalizacao; assert.equal(ext.tipo, "externo");
  assert.equal((await medirUma(ext)).status, "ok"); assert.equal((await medirUma(montar({ geoUrl: "https://m.x/p", fetchFn: async () => resp(503) }).sondas.geolocalizacao)).status, "fora");
});

// ======================= núcleo da fila (faixas e cronômetro de SLA) =======================
const SLA = { critica: { atend: 15, resol: 240 }, alta: { atend: 60, resol: 480 }, media: { atend: 240, resol: 1440 }, baixa: { atend: 1440, resol: 4320 } };
const AGORA = Date.parse("2026-11-02T12:00:00Z"), iso = (ms) => new Date(ms).toISOString();
const ch = (o) => ({ id: o.id || "c", protocolo: "TI-000001", titulo: "t", prioridade: "media", status: "aberto", criadoEm: iso(AGORA - 5 * MIN), slaAtendEm: iso(AGORA + 100 * MIN), slaResolEm: iso(AGORA + 1000 * MIN), ...o });
t("faixas: 4 prioridades em 3 faixas ('alta' cai em Média sem esconder o selo); ordenação por urgência real e depois por antiguidade", () => {
  assert.deepEqual(["critica", "alta", "media", "baixa"].map(N.faixaDe), ["critica", "media", "media", "baixa"]);
  const g = N.agruparPorFaixa([ch({ id: "m-novo", criadoEm: iso(AGORA - 1 * MIN) }), ch({ id: "alta", prioridade: "alta", criadoEm: iso(AGORA - 2 * MIN) }), ch({ id: "m-velho", criadoEm: iso(AGORA - 90 * MIN) }), ch({ id: "crit", prioridade: "critica" }), ch({ id: "baixa", prioridade: "baixa" })]);
  assert.deepEqual(g.critica.map((x) => x.id), ["crit"]); assert.deepEqual(g.media.map((x) => x.id), ["alta", "m-velho", "m-novo"]); assert.deepEqual(g.baixa.map((x) => x.id), ["baixa"]);
  assert.deepEqual(N.agruparPorFaixa([]), { critica: [], media: [], baixa: [] }); assert.deepEqual(N.agruparPorFaixa(undefined), { critica: [], media: [], baixa: [] });
});
t("SLA: aberto conta até o 1º atendimento; em atendimento conta até a resolução; aguardando usuário PAUSA; encerrado não tem cronômetro", () => {
  const aberto = N.slaDe(ch({ prioridade: "critica", slaAtendEm: iso(AGORA + 10 * MIN) }), SLA, AGORA);
  assert.equal(aberto.fase, "atendimento"); assert.equal(aberto.restanteMs, 10 * MIN); assert.equal(aberto.rotulo, "1º atendimento");
  const emAt = N.slaDe(ch({ status: "em_atendimento", prioridade: "media", slaAtendEm: iso(AGORA - 999 * MIN), slaResolEm: iso(AGORA + 600 * MIN) }), SLA, AGORA);
  assert.equal(emAt.fase, "resolucao"); assert.equal(emAt.restanteMs, 600 * MIN, "o prazo de atendimento antigo é ignorado"); assert.equal(emAt.rotulo, "Resolução");
  const pausa = N.slaDe(ch({ status: "aguardando_usuario" }), SLA, AGORA); assert.equal(pausa.nivel, "pausado"); assert.equal(N.textoSla(pausa), "pausado"); assert.equal(pausa.restanteMs, null);
  for (const status of ["resolvido", "cancelado"]) { const x = N.slaDe(ch({ status }), SLA, AGORA); assert.equal(x.nivel, "nenhum"); assert.equal(N.textoSla(x), "—"); }
});
t("SLA: níveis ok (<70%) · atenção (70–100%) · estourado, com a janela da PRIORIDADE REAL (alta = 1 h, não a da média)", () => {
  const nivel = (prioridade, restanteMin) => N.slaDe(ch({ prioridade, slaAtendEm: iso(AGORA + restanteMin * MIN) }), SLA, AGORA);
  assert.equal(nivel("critica", 14).nivel, "ok"); assert.equal(nivel("critica", 4).nivel, "atencao"); assert.equal(nivel("critica", -1).nivel, "estourado");
  assert.equal(nivel("alta", 30).nivel, "ok", "30 de 60 min = 50%"); assert.equal(nivel("alta", 10).nivel, "atencao", "50 de 60 min = 83%");
  assert.equal(nivel("media", 10).nivel, "atencao", "230 de 240 min consumidos");
  const e = nivel("critica", -5); assert.ok(e.pct > 1); assert.equal(N.textoSla(e), "estourou há 5 min");
  assert.equal(nivel("critica", 0).nivel, "atencao", "exatamente no prazo ainda não estourou"); assert.equal(nivel("critica", 15).pct, 0, "recém-aberto: 0%");
  assert.equal(N.slaDe(ch({ slaAtendEm: null }), SLA, AGORA).nivel, "nenhum", "sem prazo gravado: não inventa");
});
t("duração e totais: cronômetro mostra segundos nos últimos 2 min; totais por faixa contam os estourados", () => {
  assert.deepEqual([0, 59_000, 119_000, 120_000, 3_600_000, 3_900_000, 7_200_000, 49 * 3_600_000].map(N.formatarDuracao), ["0 s", "59 s", "119 s", "2 min", "60 min".replace("60 min", "1 h"), "1 h 05 min", "2 h", "2 d"]);
  assert.equal(N.formatarDuracao(-5000), "0 s"); assert.equal(N.duracaoSeg(null), "—"); assert.equal(N.duracaoSeg(90), "2 min");
  const lista = [ch({ id: "a", prioridade: "critica", slaAtendEm: iso(AGORA - MIN) }), ch({ id: "b", prioridade: "critica" }), ch({ id: "c", prioridade: "alta", slaAtendEm: iso(AGORA - MIN) }), ch({ id: "d", prioridade: "baixa", status: "aguardando_usuario" })];
  assert.deepEqual(N.totaisPorFaixa(lista, SLA, AGORA), { critica: { total: 2, estourados: 1 }, media: { total: 1, estourados: 1 }, baixa: { total: 1, estourados: 0 } });
});
t("[AUTO-BUG]: reconhecido pelo cabeçalho ou pela origem; título exibido sem o cabeçalho", () => {
  assert.equal(N.ehAutoBug({ titulo: "[AUTO-BUG] TypeError: x" }), true); assert.equal(N.ehAutoBug({ titulo: "  [auto-bug] x" }), true); assert.equal(N.ehAutoBug({ origem: "automatico", titulo: "x" }), true);
  assert.equal(N.ehAutoBug({ titulo: "Pix não confirma", origem: "usuario" }), false); assert.equal(N.ehAutoBug({}), false);
  assert.equal(N.tituloLimpo({ titulo: "[AUTO-BUG] TypeError: x" }), "TypeError: x"); assert.equal(N.tituloLimpo({ titulo: "Pix" }), "Pix");
});
t("minigráfico de latência: escala pelo limite de 'lento' (rápido não parece instável), marca falhas, e não desenha com < 2 pontos", () => {
  assert.deepEqual(N.sparkline([], 120, 28), { linha: "", falhas: [] }); assert.equal(N.sparkline([{ ms: 5, s: "ok" }], 120, 28).linha, "");
  const h = [{ ms: 50, s: "ok" }, { ms: 60, s: "ok" }, { ms: 0, s: "fora" }, { ms: 55, s: "ok" }];
  const a = N.sparkline(h, 120, 28, 800), b = N.sparkline(h, 120, 28, 0);
  const ys = (l) => l.split(" ").map((p) => Number(p.split(",")[1])); assert.ok(Math.min(...ys(a.linha)) > Math.min(...ys(b.linha)), "com limite alto a linha fica baixa (serviço saudável)");
  assert.equal(a.falhas.length, 1); assert.equal(a.linha.split(" ").length, 4); assert.ok(ys(a.linha).every((y) => y >= 0 && y <= 28));
  assert.equal(N.rotuloGeral("ok", []), "Todos os serviços operacionais"); assert.equal(N.rotuloGeral("fora", [{ status: "fora" }, { status: "degradado" }, { status: "ok" }]), "2 serviços com problema"); assert.equal(N.rotuloGeral("fora", [{ status: "fora" }]), "1 serviço com problema");
});

let falhas = 0;
for (const [nome, fn] of testes) { try { await fn(); process.stdout.write(`  ✓ ${nome}\n`); } catch (e) { falhas++; process.stdout.write(`  ✗ ${nome}\n      ${String(e.stack || e).split("\n").slice(0, 5).join("\n      ")}\n`); } }
process.stdout.write(`\n${testes.length - falhas}/${testes.length} testes do rastreador de bugs e da saúde passaram\n`); process.exit(falhas ? 1 : 0);
