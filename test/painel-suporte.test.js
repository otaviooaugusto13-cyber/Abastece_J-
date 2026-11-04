// Regras puras do painel de suporte: link do WhatsApp (URI encode + protocolo), fila por abas, pendências, macros, ficha.
import assert from "node:assert/strict";
import { normalizarTelefoneBR, gerarLinkWhatsApp, montarMensagemWhatsApp, motivoWhatsAppIndisponivel, LIMITE_TEXTO_WHATSAPP } from "../painel-suporte/whatsapp.js";
import { ehPendente, filtrarConversas, contarAbas, formatarEspera, nivelEspera, agruparMensagens, ordenarMensagens, mascararDocumento, formatarTelefone, rotuloStatusConta, progressoTreinamento, iniciais, ms } from "../painel-suporte/logica.js";
import { MACROS, renderizarMacro, buscarMacros, macroPorAtalho, atalhoDa } from "../painel-suporte/macros.js";

const testes = []; const t = (n, f) => testes.push([n, f]);

t("telefone BR: aceita formatos comuns, rejeita fixo, DDD inválido e lixo", () => {
  for (const ok of ["(19) 99535-0637", "+55 19 99535-0637", "5519995350637", "019995350637", "19 9535-0637", "0055 19 99535-0637"]) assert.ok(normalizarTelefoneBR(ok)?.startsWith("55"), ok);
  assert.equal(normalizarTelefoneBR("(19) 99535-0637"), "5519995350637");
  assert.equal(normalizarTelefoneBR("19 9535-0637"), "551995350637");
  for (const ruim of ["", null, undefined, "abc", "123", "(19) 3535-0637", "(09) 99535-0637", "(19) 89535-0637", "551999535063799"]) assert.equal(normalizarTelefoneBR(ruim), null, String(ruim));
});

t("link wa.me: número só com dígitos, texto com encodeURIComponent, protocolo sempre presente", () => {
  const r = gerarLinkWhatsApp({ telefone: "(19) 99535-0637", protocolo: "SP-000123", nome: "João da Silva", atendente: "Ana" });
  assert.ok(r.url.startsWith("https://wa.me/5519995350637?text="));
  assert.equal(new URL(r.url).searchParams.get("text"), r.mensagem);   // ida e volta sem perda
  assert.ok(r.mensagem.includes("SP-000123") && r.mensagem.includes("Olá, João!") && r.mensagem.includes("Ana"));
  assert.ok(!/[ \n]/.test(r.url.split("?text=")[1]), "nada de espaço/quebra crua na URL");
  assert.ok(r.url.includes("%0A") && r.url.includes("Ol%C3%A1"), "quebra de linha e acento codificados");
  // texto com caracteres perigosos para a query string não vaza para outros parâmetros
  const p = gerarLinkWhatsApp({ telefone: "19995350637", protocolo: "SP-000124", mensagem: "Teste & outro=1 #fragmento ?x 😀 100%" });
  const u = new URL(p.url); assert.equal([...u.searchParams.keys()].join(), "text"); assert.equal(u.hash, ""); assert.ok(u.searchParams.get("text").includes("😀 100%"));
  // mensagem personalizada SEM protocolo: o protocolo é acrescentado
  assert.match(p.mensagem, /\*Protocolo:\* SP-000124$/);
});

t("link wa.me: protocolo inválido/ausente ou telefone inválido → null; limite de 1500 caracteres", () => {
  assert.equal(gerarLinkWhatsApp({ telefone: "(19) 99535-0637" }), null);
  assert.equal(gerarLinkWhatsApp({ telefone: "(19) 99535-0637", protocolo: "123" }), null);
  assert.equal(gerarLinkWhatsApp({ telefone: "(19) 3535-0637", protocolo: "SP-000123" }), null);
  const longo = gerarLinkWhatsApp({ telefone: "19995350637", protocolo: "SP-000123", mensagem: "a".repeat(5000) });
  assert.ok(longo.mensagem.length <= LIMITE_TEXTO_WHATSAPP);
  assert.equal(gerarLinkWhatsApp({ telefone: "19995350637", protocolo: "sp-000123" }).mensagem.includes("SP-000123"), true, "protocolo em minúsculas é normalizado");
});

t("mensagem do WhatsApp: sem nome/atendente não deixa buracos; motivo do botão desabilitado", () => {
  const m = montarMensagemWhatsApp({ protocolo: "SP-000009" }); assert.ok(m.startsWith("Olá! Aqui é do suporte") && !/undefined|null|\{/.test(m));
  assert.match(motivoWhatsAppIndisponivel({ telefone: "", protocolo: "SP-000001" }), /Telefone/);
  assert.match(motivoWhatsAppIndisponivel({ telefone: "123", protocolo: "SP-000001" }), /celular/);
  assert.match(motivoWhatsAppIndisponivel({ telefone: "19995350637", protocolo: "" }), /protocolo/);
  assert.equal(motivoWhatsAppIndisponivel({ telefone: "19995350637", protocolo: "SP-000001" }), null);
});

const agora = Date.parse("2026-11-02T15:00:00Z");
const conv = (uid, tipo, ultimaDe, minAtras, extra = {}) => ({ uid, tipo, nome: `Nome ${uid}`, ultimaMsg: `mensagem de ${uid}`, ultimaDe, ultimaEm: agora - minAtras * 60_000, naoLidasSuporte: ultimaDe === "usuario" ? 1 : 0, ...extra });
const C = [conv("p1", "promotor", "usuario", 30), conv("p2", "promotor", "suporte", 5), conv("l1", "loja", "usuario", 90), conv("l2", "loja", "usuario", 2), conv("l3", "loja", "suporte", 1)];

t("abas: contagens, filtro por segmento e pendentes (mais antigo primeiro)", () => {
  const tk = new Map();
  assert.deepEqual(contarAbas(C, tk), { todos: 5, promotores: 2, lojas: 3, pendentes: 3 });
  assert.deepEqual(filtrarConversas(C, tk, "todos").map((c) => c.uid), ["l3", "l2", "p2", "p1", "l1"], "recentes primeiro");
  assert.deepEqual(filtrarConversas(C, tk, "promotores").map((c) => c.uid), ["p2", "p1"]);
  assert.deepEqual(filtrarConversas(C, tk, "lojas").map((c) => c.uid), ["l3", "l2", "l1"]);
  assert.deepEqual(filtrarConversas(C, tk, "pendentes").map((c) => c.uid), ["l1", "p1", "l2"], "quem espera há mais tempo vem primeiro");
});

t("pendente: ticket resolvido depois da última fala do usuário tira da fila; nova fala depois da resolução volta", () => {
  const c = conv("p1", "promotor", "usuario", 30);
  assert.equal(ehPendente(c, { status: "resolvido", resolvidoMs: agora - 10 * 60_000 }), false);
  assert.equal(ehPendente(c, { status: "resolvido", resolvidoMs: agora - 40 * 60_000 }), true);
  assert.equal(ehPendente(c, { status: "escalado" }), true);
  assert.equal(ehPendente(conv("p2", "promotor", "suporte", 1), undefined), false);
  const tk = new Map([["p1", { status: "resolvido", resolvidoMs: agora - 10 * 60_000, protocolo: "SP-000042" }]]);
  assert.equal(contarAbas(C, tk).pendentes, 2);
  assert.deepEqual(filtrarConversas(C, tk, "todos", "sp-000042").map((c) => c.uid), ["p1"], "busca por protocolo");
});

t("busca: ignora acento e caixa; Timestamps do Firestore e ISO viram milissegundos", () => {
  const lista = [{ ...conv("a", "loja", "usuario", 1), nome: "Mercadão São João" }];
  assert.equal(filtrarConversas(lista, new Map(), "todos", "sao joao").length, 1);
  assert.equal(filtrarConversas(lista, new Map(), "todos", "xyz").length, 0);
  assert.equal(ms({ toMillis: () => 5 }), 5); assert.equal(ms({ seconds: 2, nanoseconds: 5e6 }), 2005); assert.equal(ms("2026-01-01T00:00:00Z"), Date.parse("2026-01-01T00:00:00Z")); assert.equal(ms(null), 0);
});

t("espera: formatação e níveis", () => {
  assert.equal(formatarEspera(10_000), "agora"); assert.equal(formatarEspera(12 * 60_000), "12 min"); assert.equal(formatarEspera(3 * 3_600_000), "3 h"); assert.equal(formatarEspera(50 * 3_600_000), "2 d");
  assert.deepEqual([5, 15, 59, 60, 300].map((m) => nivelEspera(m * 60_000)), ["ok", "atencao", "atencao", "critico", "critico"]);
});

t("mensagens: ordem pelo id, separador de dia (fuso de São Paulo) e rajadas", () => {
  const base = Date.parse("2026-11-02T15:00:00Z");   // 12:00 em São Paulo
  const mk = (n, de, t) => ({ id: `${String(base + t).padStart(13, "0")}_${n}`, de, texto: n, criadoEm: base + t });
  const ordenadas = ordenarMensagens([mk("c", "suporte", 120_000), mk("a", "usuario", 0), mk("d", "suporte", 20 * 60_000), mk("b", "usuario", 30_000), mk("antiga", "usuario", -86_400_000 * 2)]);
  const it = agruparMensagens(ordenadas, base + 3_600_000);
  assert.deepEqual(it.filter((i) => i.tipo === "dia").map((i) => i.rotulo), ["31/10/2026", "Hoje"]);
  const msgs = it.filter((i) => i.tipo === "msg");
  assert.deepEqual(msgs.map((i) => [i.msg.texto, i.inicioGrupo]), [["antiga", true], ["a", true], ["b", false], ["c", true], ["d", true]]);
  assert.equal(agruparMensagens([mk("x", "usuario", 0)], base + 86_400_000)[0].rotulo, "Ontem");
  // 23:30 em SP (02:30Z do dia seguinte) ainda é o dia anterior
  assert.equal(agruparMensagens([{ id: "1", de: "usuario", criadoEm: Date.parse("2026-11-03T02:30:00Z") }], Date.parse("2026-11-03T15:00:00Z"))[0].rotulo, "Ontem");
});

t("macros: variáveis, ausência de nome/protocolo, busca, atalhos Alt+1…9", () => {
  assert.equal(MACROS.length, 9); assert.deepEqual([...new Set(MACROS.map((m) => m.categoria))], ["cadastro", "turnos", "pagamentos"]);
  assert.equal(new Set(MACROS.map((m) => m.id)).size, 9);
  for (const m of MACROS) { const r = renderizarMacro(m.texto, { nome: "Maria Souza", protocolo: "SP-000007", atendente: "Ana" }); assert.ok(!/[{}]/.test(r), m.id); assert.ok(r.length <= 1000, "cabe no limite do chat"); }
  const pend = MACROS[0], com = renderizarMacro(pend.texto, { nome: "Maria Souza", protocolo: "SP-000007" });
  assert.ok(com.startsWith("Oi, Maria!") && com.endsWith("(protocolo SP-000007)"));
  const sem = renderizarMacro(pend.texto, {}); assert.ok(sem.startsWith("Oi!") && !sem.includes("protocolo") && !/[{}]/.test(sem), sem);
  assert.equal(macroPorAtalho(1).id, "cad-pendente"); assert.equal(macroPorAtalho(9).id, "pag-dados"); assert.equal(macroPorAtalho(0), null); assert.equal(macroPorAtalho(10), null); assert.equal(atalhoDa(MACROS[4]), 5);
  assert.deepEqual(buscarMacros("pix").map((m) => m.id), ["pag-pix"]); assert.equal(buscarMacros("").length, 9); assert.ok(buscarMacros("habilitacao").some((m) => m.id === "trn-habil"), "sem acento");
  assert.deepEqual(buscarMacros("pagamentos").map((m) => m.categoria).filter((c, i, a) => a.indexOf(c) === i), ["pagamentos"]);
});

t("ficha: CPF mascarado, CNPJ formatado, telefone, status da conta, treinamento e iniciais", () => {
  assert.equal(mascararDocumento("123.456.789-09"), "***.456.789-**"); assert.equal(mascararDocumento("12345678000195"), "12.345.678/0001-95"); assert.equal(mascararDocumento(""), "");
  assert.equal(formatarTelefone("5519995350637"), "(19) 99535-0637"); assert.equal(formatarTelefone("1935350637"), "(19) 3535-0637");
  assert.deepEqual(rotuloStatusConta("ativo"), { texto: "Ativo", tom: "ok" }); assert.equal(rotuloStatusConta("pendente").tom, "aviso"); assert.equal(rotuloStatusConta("banido").tom, "erro"); assert.equal(rotuloStatusConta("").tom, "neutro");
  assert.deepEqual(progressoTreinamento({ concluidos: 3, total: 8 }), { feitos: 3, total: 8, pct: 38 }); assert.deepEqual(progressoTreinamento({ concluidos: 9, total: 8 }), { feitos: 8, total: 8, pct: 100 }); assert.equal(progressoTreinamento(undefined).pct, 0);
  assert.equal(iniciais("maria de souza"), "MS"); assert.equal(iniciais("Loja"), "L"); assert.equal(iniciais(""), "?");
});

let f = 0; for (const [n, fn] of testes) { try { await fn(); console.log("  ✓", n); } catch (e) { f++; console.log("  ✗", n, "\n     ", String(e.message).split("\n").slice(0, 4).join("\n      ")); } }
console.log(f ? `\n${f} falha(s)` : `\n${testes.length} testes do painel de suporte passaram`); process.exit(f ? 1 : 0);
