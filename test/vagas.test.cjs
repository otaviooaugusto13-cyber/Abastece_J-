// Mural de Vagas / Banco de Talentos: consentimento LGPD, currículo PDF, candidatura com cruzamento Nome+CPF, moderação,
// isolamento entre empresas e a chave de cobrança (fase gratuita → mensalidade/créditos). Sem rede (ambiente falso em memória).
const crypto = require("node:crypto");
process.env.AMBIENTE = "teste"; process.env.MODO_TESTE = "1"; process.env.APP_URL = "https://app.exemplo.com";
process.env.MP_ACCESS_TOKEN = "APP_USR-teste"; process.env.MP_WEBHOOK_SECRET = "segredo-webhook"; process.env.CRON_SECRET = "cron-secreto";
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`; process.env.DATA_ENCRYPTION_KEY_ID = "1"; process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const E = require("./fake-env.cjs");
const { ctx, chamar } = E.carregarServidor();
const { V } = ctx;
const Curriculo = require("../server/lib/curriculo");
const { criarArmazenamento, criarArmazenamentoMemoria } = require("../server/lib/armazenamento");
const DIA = 86_400_000;

const dia = (n) => { const d = new Date(V.hojeSP() + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const CPFS = ["52998224725", "11144477735", "39053344705", "86288366757"].filter(V.cpfValido);
const U = {
  p1: { uid: "p1", email: "p1@x.com", email_verified: true }, p2: { uid: "p2", email: "p2@x.com", email_verified: true }, p3: { uid: "p3", email: "p3@x.com", email_verified: true },
  lojaA: { uid: "lojaA", email: "a@x.com", email_verified: true }, lojaB: { uid: "lojaB", email: "b@x.com", email_verified: true },
  adm1: { uid: "adm1", email: "adm@x.com", email_verified: true }, adm2: { uid: "adm2", email: "adm2@x.com", email_verified: true, auth_time: Math.floor(Date.now() / 1000) - 7200 }
};
let mem;
function reset() {
  E.limpar(); Object.assign(E.tokens, U);
  for (const u of ["p1", "p2", "p3"]) E.claimsStore[u] = { role: "promotor", treinado: false };
  E.claimsStore.lojaA = { role: "loja" }; E.claimsStore.lojaB = { role: "loja" }; E.claimsStore.adm1 = { role: "admin" }; E.claimsStore.adm2 = { role: "admin" };
  E.clock.now = Date.now(); ctx.__reset?.(); mem = criarArmazenamentoMemoria(); ctx.armazenamento = mem;
}
const set = (c, id, d) => ctx.db.collection(c).doc(id).set(d);
const get = async (c, id) => (await ctx.db.collection(c).doc(id).get()).data();
const ok = (r, m = "") => assert.equal(r.status, 200, `${m} esperado 200, veio ${r.status} ${JSON.stringify(r.json)}`);
const falha = (r, status, codigo) => { assert.equal(r.status, status, `esperado ${status}/${codigo}, veio ${r.status} ${JSON.stringify(r.json)}`); if (codigo) assert.equal(r.json.codigo, codigo); };
const enc = (uid, campo, v) => ctx.Cripto.cifrar(v, `profissionais_privado/${campo}/${uid}`);
const api = (m, p, token, body, extra = {}) => chamar(m, p, { token, body: body || {}, ...extra });

/** Profissional com cadastro completo (CPF e nascimento cifrados), mas SEM divulgação nem currículo. */
async function profissional(uid = "p1", { nome = `Maria ${uid.toUpperCase()} Silva`, cpfn = 0, nascimento = "1995-05-20", status = "ativo" } = {}) {
  await set("profissionais", uid, { uid, nome, status });
  await set("profissionais_privado", uid, { uid, cpfEnc: enc(uid, "cpf", CPFS[cpfn]), cpfIdx: ctx.Cripto.indiceCego(CPFS[cpfn]), nascimentoEnc: enc(uid, "nascimento", nascimento) });
}
const pdf = (extra = "", pad = 800) => Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n${extra}\n%${"x".repeat(pad)}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`, "latin1");
const url = (b) => `data:application/pdf;base64,${b.toString("base64")}`;
const aceitar = (uid) => api("PUT", "/perfil/vagas/consentimento", uid, { aceito: true, versao: ctx.vagas.TERMO_DIVULGACAO.versao });
const enviarPdf = (uid, b = pdf(), nome = "meu-curriculo.pdf") => api("PUT", "/perfil/curriculo", uid, { arquivo: url(b), nome });
/** Perfil pronto para candidatar: aceite + PDF pelas rotas reais. */
async function pronto(uid = "p1", opts) { await profissional(uid, opts); ok(await aceitar(uid)); ok(await enviarPdf(uid, pdf(`% dono ${uid}`))); }

const VAGA = { titulo: "Repositor de mercearia", descricao: "Reposição de gôndolas no turno da manhã, conferência de validade e organização de estoque.", cidade: "Itapira", uf: "SP", tipo: "repositor" };
async function rede(nome = "Rede São Vicente") { const r = await api("POST", "/admin/vagas/empresas", "adm1", { nome, tipo: "rede" }); ok(r); return r.json.id; }
async function vagaAdmin(over = {}, empresaId) { const r = await api("POST", "/admin/vagas", "adm1", { empresaId: empresaId || await rede(), ...VAGA, publicar: true, ...over }); ok(r, "criar vaga"); return r.json.id; }
async function vagaLoja(token = "lojaA", over = {}) { const r = await api("POST", "/loja/vagas", token, { ...VAGA, publicar: true, ...over }); return r; }
const config = (p) => api("PUT", "/admin/vagas/config", "adm1", p);

const testes = []; const t = (nome, fn) => testes.push([nome, fn]);

// ===================== currículo (PDF) =====================
t("PDF: valida o conteúdo real (assinatura, fim de arquivo, tamanho) e recusa conteúdo ativo, inclusive nome ofuscado", () => {
  assert.doesNotThrow(() => Curriculo.validarPdf(pdf()));
  const recusa = (b, codigo) => assert.throws(() => Curriculo.validarPdf(b), (e) => e.codigo === codigo, codigo);
  recusa(Buffer.from("MZ" + "x".repeat(1000)), "pdf-formato");
  recusa(Buffer.from("%PDF-1.4\n" + "x".repeat(1000)), "pdf-invalido");                       // sem %%EOF: truncado
  recusa(pdf("3 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj"), "pdf-conteudo-ativo");
  recusa(pdf("3 0 obj << /S /J#61vaScr#69pt >> endobj"), "pdf-conteudo-ativo");               // /J#61vaScr#69pt = /JavaScript
  recusa(pdf("3 0 obj << /Type /Filespec /EF << /F 4 0 R >> /Subtype /EmbeddedFile >> endobj"), "pdf-conteudo-ativo");
  recusa(pdf("trailer << /Encrypt 9 0 R >>"), "pdf-conteudo-ativo");
  recusa(Buffer.from("%PDF-1.4\n%%EOF"), "pdf-invalido");                                      // pequeno demais
  assert.doesNotThrow(() => Curriculo.validarPdf(pdf("3 0 obj << /Type /Annot /A << /S /URI /URI (https://linkedin.com/in/x) >> >> endobj")), "link de LinkedIn é permitido");
});
t("PDF: limite de 5 MB é exato (5 MiB passa; 5 MiB + 1 byte não)", () => {
  const cab = Buffer.from("%PDF-1.4\n", "latin1"), fim = Buffer.from("\n%%EOF\n", "latin1"), cheio = (n) => Buffer.concat([cab, Buffer.alloc(n - cab.length - fim.length, 0x78), fim]);
  const exato = cheio(Curriculo.MAX_BYTES); assert.equal(exato.length, Curriculo.MAX_BYTES); assert.doesNotThrow(() => Curriculo.validarPdf(exato));
  assert.throws(() => Curriculo.validarPdf(cheio(Curriculo.MAX_BYTES + 1)), (e) => e.status === 413 && e.codigo === "pdf-grande");
});
t("upload: PDF válido é gravado no bucket com caminho pelo hash do conteúdo e o perfil mostra o arquivo", async () => {
  await profissional("p1"); const b = pdf();
  const r = await enviarPdf("p1", b); ok(r);
  const hash = crypto.createHash("sha256").update(b).digest("hex");
  assert.ok(mem._arquivos.has(`curriculos/p1/${hash}.pdf`)); assert.equal(r.json.curriculo.bytes, b.length); assert.equal(r.json.curriculo.nomeArquivo, "meu-curriculo.pdf");
  assert.equal((await get("profissionais_privado", "p1")).curriculo.path, `curriculos/p1/${hash}.pdf`);
});
t("upload: recusa o que não é PDF (mesmo com data URL de PDF), base64 inválido, grande demais e sem prefixo", async () => {
  await profissional("p1");
  falha(await api("PUT", "/perfil/curriculo", "p1", { arquivo: `data:application/pdf;base64,${Buffer.from("isto nao e pdf".repeat(100)).toString("base64")}` }), 400, "pdf-formato");
  falha(await api("PUT", "/perfil/curriculo", "p1", { arquivo: "data:application/pdf;base64,@@@@" }), 400, "pdf-invalido");
  falha(await api("PUT", "/perfil/curriculo", "p1", { arquivo: "data:image/jpeg;base64,/9j/4AAQ" }), 400, "pdf-formato");
  falha(await api("PUT", "/perfil/curriculo", "p1", { arquivo: pdf().toString("base64") }), 400, "pdf-formato");
  falha(await api("PUT", "/perfil/curriculo", "p1", { arquivo: 123 }), 400, "pdf-formato");
  falha(await api("PUT", "/perfil/curriculo", "p1", { arquivo: `data:application/pdf;base64,${"A".repeat(Math.ceil((Curriculo.MAX_BYTES * 4) / 3) + 100)}` }), 413, "pdf-grande");
  assert.equal(mem._arquivos.size, 0);
});
t("upload: só profissional logado (loja/admin/anônimo recusados) e no máximo 6 envios por hora", async () => {
  await profissional("p1");
  falha(await api("PUT", "/perfil/curriculo", undefined, { arquivo: url(pdf()) }), 401);
  falha(await api("PUT", "/perfil/curriculo", "lojaA", { arquivo: url(pdf()) }), 403, "sem-permissao");
  falha(await api("PUT", "/perfil/curriculo", "adm1", { arquivo: url(pdf()) }), 403, "sem-permissao");
  for (let i = 0; i < 6; i++) ok(await enviarPdf("p1", pdf(`% v${i}`)));
  falha(await enviarPdf("p1", pdf("% v7")), 429, "limite-requisicoes");
});
t("upload: sem bucket configurado só o envio fica indisponível (503), o resto continua", async () => {
  await profissional("p1"); ctx.armazenamento = criarArmazenamento({ admin: {}, nomeBucket: "" });
  falha(await enviarPdf("p1"), 503, "armazenamento-indisponivel");
  ok(await aceitar("p1")); ok(await api("GET", "/perfil/vagas", "p1"));
});
t("upload: trocar o currículo apaga a versão antiga só se nenhuma candidatura a usa", async () => {
  await pronto("p1"); const v1 = (await get("profissionais_privado", "p1")).curriculo.path;
  ok(await enviarPdf("p1", pdf("% segunda versão"))); assert.ok(!mem._arquivos.has(v1), "versão sem uso foi apagada"); assert.equal(mem._arquivos.size, 1);
  const vaga = await vagaAdmin(); ok(await api("POST", `/vagas/${vaga}/candidatar`, "p1"));
  const v2 = (await get("profissionais_privado", "p1")).curriculo.path;
  ok(await enviarPdf("p1", pdf("% terceira versão"))); assert.ok(mem._arquivos.has(v2), "versão usada por candidatura é preservada"); assert.equal(mem._arquivos.size, 2);
});
t("currículo: baixar o próprio devolve os mesmos bytes, como PDF e sem cache", async () => {
  await profissional("p1"); const b = pdf("% meu"); ok(await enviarPdf("p1", b));
  const r = await api("GET", "/perfil/curriculo", "p1"); ok(r);
  assert.ok(Buffer.compare(r.texto, b) === 0); assert.equal(r.h["Content-Type"], "application/pdf"); assert.equal(r.h["Cache-Control"], "no-store"); assert.equal(r.h["X-Content-Type-Options"], "nosniff");
  assert.ok(!/p1|meu-curriculo/.test(r.h["Content-Disposition"]), "nome do arquivo não vem do usuário");
  falha(await api("GET", "/perfil/curriculo", "p2"), 404, "nao-encontrado");
});
t("currículo: apagar remove todas as versões do bucket, limpa o perfil e avisa as candidaturas (direito de apagar)", async () => {
  await pronto("p1"); const vaga = await vagaAdmin(); ok(await api("POST", `/vagas/${vaga}/candidatar`, "p1"));
  ok(await enviarPdf("p1", pdf("% nova")));                                                      // agora há 2 versões no bucket
  ok(await api("DELETE", "/perfil/curriculo", "p1")); assert.equal(mem._arquivos.size, 0);
  assert.equal((await get("profissionais_privado", "p1")).curriculo, undefined);
  const c = await get("vagas_candidaturas", `${vaga}_p1`); assert.ok(c.curriculo.removidoEm);
  falha(await api("GET", `/admin/vagas/candidaturas/${vaga}_p1/curriculo`, "adm1"), 404, "curriculo-removido");
});

// ===================== consentimento LGPD =====================
t("consentimento: começa desligado; aceitar exige a versão ATUAL do termo e grava versão e data; retirar também é registrado", async () => {
  await profissional("p1");
  const s = await api("GET", "/perfil/vagas", "p1"); ok(s); assert.equal(s.json.aceitaDivulgacao, false);
  assert.equal(s.json.termo.texto, "Aceito disponibilizar meus dados e currículo para divulgação em vagas de empresas parceiras.");
  falha(await api("PUT", "/perfil/vagas/consentimento", "p1", { aceito: true }), 409, "termo-desatualizado");
  falha(await api("PUT", "/perfil/vagas/consentimento", "p1", { aceito: true, versao: "1999-01" }), 409, "termo-desatualizado");
  falha(await api("PUT", "/perfil/vagas/consentimento", "p1", { aceito: "sim", versao: s.json.termo.versao }), 400);
  ok(await aceitar("p1")); const p = await get("profissionais_privado", "p1");
  assert.equal(p.aceitaDivulgacaoVagas, true); assert.equal(p.aceitaDivulgacaoVersao, s.json.termo.versao); assert.ok(p.aceitaDivulgacaoEm);
  ok(await api("PUT", "/perfil/vagas/consentimento", "p1", { aceito: false })); assert.equal((await get("profissionais_privado", "p1")).aceitaDivulgacaoVagas, false);
  const acoes = (await ctx.db.collection("auditoria").get()).docs.map((d) => d.data().acao); assert.ok(acoes.includes("vagas.divulgacao.aceitar") && acoes.includes("vagas.divulgacao.revogar"));
});
t("consentimento: retirar a autorização bloqueia NA HORA o currículo para admin e empresa; aceitar de novo libera", async () => {
  await pronto("p1"); const v = await vagaLoja("lojaA"); ok(v); await api("PUT", `/admin/vagas/${v.json.id}/moderacao`, "adm1", { estado: "aprovada" });
  ok(await api("POST", `/vagas/${v.json.id}/candidatar`, "p1")); const cid = `${v.json.id}_p1`;
  ok(await api("GET", `/admin/vagas/candidaturas/${cid}/curriculo`, "adm1")); ok(await api("GET", `/loja/vagas/candidaturas/${cid}/curriculo`, "lojaA"));
  ok(await api("PUT", "/perfil/vagas/consentimento", "p1", { aceito: false }));
  falha(await api("GET", `/admin/vagas/candidaturas/${cid}/curriculo`, "adm1"), 403, "divulgacao-revogada");
  falha(await api("GET", `/loja/vagas/candidaturas/${cid}/curriculo`, "lojaA"), 403, "divulgacao-revogada");
  const lista = await api("POST", `/admin/vagas/${v.json.id}/candidaturas`, "adm1"); assert.equal(lista.json.candidaturas[0].divulgacaoAtiva, false); assert.equal(lista.json.candidaturas[0].temCurriculo, false);
  ok(await aceitar("p1")); ok(await api("GET", `/admin/vagas/candidaturas/${cid}/curriculo`, "adm1"));
  await profissional("p2", { cpfn: 1 }); falha(await api("POST", `/vagas/${v.json.id}/candidatar`, "p2"), 409, "perfil-incompleto");   // quem nunca aceitou não candidata
});

// ===================== candidatura =====================
t("candidatura: perfil incompleto → 409 com a lista do que falta (o app abre o modal de conclusão)", async () => {
  await profissional("p1"); const vaga = await vagaAdmin();
  let r = await api("POST", `/vagas/${vaga}/candidatar`, "p1"); falha(r, 409, "perfil-incompleto"); assert.deepEqual(r.json.detalhe.falta, ["divulgacao", "curriculo"]);
  ok(await aceitar("p1")); r = await api("POST", `/vagas/${vaga}/candidatar`, "p1"); assert.deepEqual(r.json.detalhe.falta, ["curriculo"]);
  await profissional("p2", { nome: "Maria" }); r = await api("POST", `/vagas/${vaga}/candidatar`, "p2"); assert.ok(r.json.detalhe.falta.includes("nome"), "nome de uma palavra só não é nome completo");
  await set("profissionais", "p3", { uid: "p3", nome: "Fulano de Tal", status: "ativo" }); r = await api("POST", `/vagas/${vaga}/candidatar`, "p3"); assert.ok(r.json.detalhe.falta.includes("cpf"));
  assert.equal((await ctx.db.collection("vagas_candidaturas").get()).size, 0);
});
t("candidatura: cruza Nome + CPF do cadastro e anexa o currículo; CPF fica cifrado e mascarado, nunca em claro", async () => {
  await pronto("p1", { cpfn: 1, nome: "Joana Souza Lima" }); const vaga = await vagaAdmin();
  const r = await api("POST", `/vagas/${vaga}/candidatar`, "p1"); ok(r); assert.equal(r.json.id, `${vaga}_p1`); assert.equal(r.json.status, "pendente");
  const c = await get("vagas_candidaturas", `${vaga}_p1`), priv = await get("profissionais_privado", "p1");
  assert.equal(c.nome, "Joana Souza Lima"); assert.equal(c.freelancerUid, "p1"); assert.equal(c.cpfMascarado, V.mascararCPF(CPFS[1]));
  assert.equal(ctx.Cripto.decifrar(c.cpfEnc, `vagas_candidaturas/cpf/${vaga}_p1`), CPFS[1]);
  assert.ok(!JSON.stringify(c).includes(CPFS[1]), "CPF em claro não pode estar no documento");
  assert.throws(() => ctx.Cripto.decifrar(c.cpfEnc, `vagas_candidaturas/cpf/${vaga}_p2`), "cifra amarrada ao id da candidatura");
  assert.deepEqual({ p: c.curriculo.path, h: c.curriculo.sha256, b: c.curriculo.bytes }, { p: priv.curriculo.path, h: priv.curriculo.sha256, b: priv.curriculo.bytes });
  assert.equal(c.termoVersao, ctx.vagas.TERMO_DIVULGACAO.versao); assert.equal(c.status, "pendente"); assert.equal((await get("vagas", vaga)).candidaturasTotal, 1);
});
t("candidatura: é única por pessoa e vaga, mesmo com cliques simultâneos (contador não duplica)", async () => {
  await pronto("p1"); const vaga = await vagaAdmin();
  const rs = await Promise.all([1, 2, 3].map(() => api("POST", `/vagas/${vaga}/candidatar`, "p1")));
  assert.equal(rs.filter((r) => r.status === 200).length, 1); assert.equal(rs.filter((r) => r.json?.codigo === "ja-candidatou").length, 2);
  assert.equal((await get("vagas", vaga)).candidaturasTotal, 1);
});
t("candidatura: vaga rascunho, encerrada, vencida, em moderação ou inexistente não aceita candidatos", async () => {
  await pronto("p1"); const emp = await rede();
  const rasc = await vagaAdmin({ publicar: false }, emp); falha(await api("POST", `/vagas/${rasc}/candidatar`, "p1"), 409, "vaga-encerrada");
  const enc2 = await vagaAdmin({}, emp); ok(await api("PUT", `/admin/vagas/${enc2}/status`, "adm1", { status: "encerrada" })); falha(await api("POST", `/vagas/${enc2}/candidatar`, "p1"), 409, "vaga-encerrada");
  const mod = await vagaAdmin({}, emp); ok(await api("PUT", `/admin/vagas/${mod}/moderacao`, "adm1", { estado: "pendente" })); falha(await api("POST", `/vagas/${mod}/candidatar`, "p1"), 409, "vaga-encerrada");
  const venc = await vagaAdmin({ expiraEm: dia(3) }, emp); E.avancar(4 * DIA); falha(await api("POST", `/vagas/${venc}/candidatar`, "p1"), 409, "vaga-encerrada");
  falha(await api("POST", "/vagas/naoexiste/candidatar", "p1"), 404, "nao-encontrado");
  assert.equal((await ctx.db.collection("vagas_candidaturas").get()).size, 0);
});
t("candidatura: vaga só para maiores barra 16–17 anos; vaga que permite menores aceita quem tem responsável cadastrado", async () => {
  const nasc17 = dia(-(17 * 365 + 120)); await pronto("p1", { nascimento: nasc17 }); const emp = await rede();
  const fechada = await vagaAdmin({}, emp); falha(await api("POST", `/vagas/${fechada}/candidatar`, "p1"), 403, "vaga-apenas-maiores");
  const aberta = await vagaAdmin({ apenasMaiores: false }, emp); ok(await api("POST", `/vagas/${aberta}/candidatar`, "p1"));
  await profissional("p2"); await set("profissionais_privado", "p2", { uid: "p2", cpfEnc: enc("p2", "cpf", CPFS[0]), aceitaDivulgacaoVagas: true, curriculo: { path: "x", sha256: "y", bytes: 1 } });
  assert.ok((await api("POST", `/vagas/${fechada}/candidatar`, "p2")).json.detalhe.falta.includes("nascimento"), "sem nascimento não dá para provar maioridade");
});
t("candidatura: conta bloqueada não se candidata; conta ainda em análise pode", async () => {
  await pronto("p1", { status: "bloqueado" }); await pronto("p2", { status: "pendente", cpfn: 1 }); const vaga = await vagaAdmin();
  falha(await api("POST", `/vagas/${vaga}/candidatar`, "p1"), 403, "conta-bloqueada"); ok(await api("POST", `/vagas/${vaga}/candidatar`, "p2"));
});
t("candidatura: o currículo é um instantâneo — trocar o PDF depois não muda o que a empresa recebe", async () => {
  await pronto("p1"); const vaga = await vagaAdmin(); ok(await api("POST", `/vagas/${vaga}/candidatar`, "p1"));
  const antes = (await get("vagas_candidaturas", `${vaga}_p1`)).curriculo.sha256; ok(await enviarPdf("p1", pdf("% completamente outro")));
  const r = await api("GET", `/admin/vagas/candidaturas/${vaga}_p1/curriculo`, "adm1"); ok(r);
  assert.equal(crypto.createHash("sha256").update(r.texto).digest("hex"), antes);
});
t("candidatura: 'minhas candidaturas' mostra só as da própria pessoa e acompanha o status que o admin define", async () => {
  await pronto("p1"); await pronto("p2", { cpfn: 1 }); const vaga = await vagaAdmin(); ok(await api("POST", `/vagas/${vaga}/candidatar`, "p1"));
  assert.equal((await api("GET", "/vagas/minhas-candidaturas", "p2")).json.length, 0);
  ok(await api("PUT", `/admin/vagas/candidaturas/${vaga}_p1/status`, "adm1", { status: "em_analise" }));
  const m = (await api("GET", "/vagas/minhas-candidaturas", "p1")).json; assert.equal(m.length, 1); assert.equal(m[0].status, "em_analise"); assert.equal(m[0].empresa, "Rede São Vicente");
  assert.ok(!JSON.stringify(m).includes("cpf"), "nada de CPF na resposta do app");
});

// ===================== mural (feed) =====================
t("mural: só vagas ativas, aprovadas e dentro da validade; filtros por cidade, tipo e rede; facetas para os seletores", async () => {
  const sv = await rede("Rede São Vicente"), outra = await rede("Mercado Beta");
  const a = await vagaAdmin({}, sv); const b = await vagaAdmin({ cidade: "Mogi Guaçu", tipo: "degustacao", titulo: "Promotor de degustação" }, outra);
  await vagaAdmin({ publicar: false, titulo: "Rascunho escondido" }, sv); const enc2 = await vagaAdmin({ titulo: "Encerrada escondida" }, sv); await api("PUT", `/admin/vagas/${enc2}/status`, "adm1", { status: "encerrada" });
  await profissional("p1"); const todas = await api("GET", "/vagas", "p1"); ok(todas);
  assert.deepEqual(todas.json.vagas.map((v) => v.id).sort(), [a, b].sort());
  assert.deepEqual(todas.json.filtros.cidades.map((c) => c.rotulo), ["Itapira - SP", "Mogi Guaçu - SP"]); assert.equal(todas.json.filtros.redes.length, 2); assert.deepEqual(todas.json.filtros.tipos.map((x) => x.rotulo), ["Degustação", "Promotor", "Repositor"]);
  assert.deepEqual((await api("GET", "/vagas?cidade=mogi-guacu-sp", "p1")).json.vagas.map((v) => v.id), [b]);
  assert.deepEqual((await api("GET", "/vagas?tipo=repositor", "p1")).json.vagas.map((v) => v.id), [a]);
  assert.deepEqual((await api("GET", `/vagas?rede=${sv}`, "p1")).json.vagas.map((v) => v.id), [a]);
  assert.equal((await api("GET", `/vagas?rede=${sv}&tipo=degustacao`, "p1")).json.vagas.length, 0);
  const v = todas.json.vagas.find((x) => x.id === a); assert.ok(!("gratuita" in v) && !("moderacao" in v) && !("candidaturas" in v), "dados de gestão não vazam para o app");
  E.avancar(31 * DIA); assert.equal((await api("GET", "/vagas", "p1")).json.vagas.length, 0, "vencidas somem do mural");
});
t("mural: marca as vagas em que a pessoa já se candidatou; filtros inválidos são recusados; só profissional acessa", async () => {
  await pronto("p1"); const vaga = await vagaAdmin(); ok(await api("POST", `/vagas/${vaga}/candidatar`, "p1"));
  const v = (await api("GET", "/vagas", "p1")).json.vagas[0]; assert.equal(v.jaCandidatou, true); assert.equal(v.statusCandidatura, "pendente");
  await profissional("p2", { cpfn: 1 }); assert.equal((await api("GET", "/vagas", "p2")).json.vagas[0].jaCandidatou, false);
  falha(await api("GET", "/vagas?tipo=hacker", "p1"), 400); falha(await api("GET", "/vagas?cidade=../etc", "p1"), 400); falha(await api("GET", "/vagas?rede=a/b", "p1"), 400);
  falha(await api("GET", "/vagas", "lojaA"), 403, "sem-permissao"); falha(await api("GET", "/vagas"), 401);
});

// ===================== admin =====================
t("admin: todas as rotas de vagas exigem o papel admin (promotor, loja e anônimo recusados)", async () => {
  const rotas = [["GET", "/admin/vagas"], ["POST", "/admin/vagas"], ["GET", "/admin/vagas/config"], ["PUT", "/admin/vagas/config"], ["GET", "/admin/vagas/empresas"], ["POST", "/admin/vagas/empresas"],
    ["PUT", "/admin/vagas/empresas/e1/plano"], ["PUT", "/admin/vagas/v1"], ["PUT", "/admin/vagas/v1/status"], ["PUT", "/admin/vagas/v1/moderacao"], ["POST", "/admin/vagas/v1/candidaturas"],
    ["PUT", "/admin/vagas/candidaturas/c1/status"], ["GET", "/admin/vagas/candidaturas/c1/curriculo"], ["POST", "/admin/vagas/candidaturas/c1/cpf"]];
  for (const [m, p] of rotas) { falha(await api(m, p, "p1"), 403, "sem-permissao"); falha(await api(m, p, "lojaA"), 403, "sem-permissao"); falha(await api(m, p), 401); }
});
t("admin: cadastra a rede parceira e publica a vaga em nome dela — aprovada, grátis na fase de lançamento, visível no mural", async () => {
  const emp = await rede("Rede São Vicente"); const r = await api("POST", "/admin/vagas", "adm1", { empresaId: emp, ...VAGA, publicar: true, expiraEm: dia(15) }); ok(r);
  assert.equal(r.json.status, "ativa"); assert.equal(r.json.moderacao, "aprovada"); assert.equal(r.json.gratuita, true); assert.equal(r.json.empresa.nome, "Rede São Vicente"); assert.equal(r.json.apenasMaiores, true);
  const d = await get("vagas", r.json.id); assert.equal(d.origem, "admin"); assert.equal(d.criadoPor, "adm1"); assert.equal(d.cidadeChave, "itapira-sp"); assert.equal(d.cobranca.modelo, "gratuito");
  assert.equal(Math.round((d.expiraEm.toMillis() - Date.now()) / DIA), 16, "validade = fim do dia escolhido");
  const rascunho = await api("POST", "/admin/vagas", "adm1", { empresaId: emp, ...VAGA }); assert.equal(rascunho.json.status, "rascunho");
  assert.equal((await api("GET", "/admin/vagas?status=ativa", "adm1")).json.length, 1); assert.equal((await api("GET", "/admin/vagas", "adm1")).json.length, 2);
});
t("admin: valida a vaga (título, descrição, UF, tipo, validade, empresa) e ignora campos que não deve aceitar", async () => {
  const emp = await rede(); const novo = (over) => api("POST", "/admin/vagas", "adm1", { empresaId: emp, ...VAGA, ...over });
  falha(await novo({ titulo: "ab" }), 400, "dados-invalidos"); falha(await novo({ descricao: "curta" }), 400); falha(await novo({ uf: "XX" }), 400); falha(await novo({ tipo: "gerente" }), 400);
  falha(await novo({ expiraEm: dia(-1) }), 400); falha(await novo({ expiraEm: dia(400) }), 400); falha(await novo({ expiraEm: "2026-02-31" }), 400); falha(await novo({ titulo: 123 }), 400);
  falha(await novo({ empresaId: "naoexiste" }), 404); falha(await novo({ empresaId: "../x" }), 400); falha(await novo({ publicar: "sim" }), 400);
  const r = await novo({ status: "encerrada", candidaturasTotal: 99, gratuita: false, moderacao: "rejeitada", criadoPor: "outro" }); ok(r);
  const d = await get("vagas", r.json.id); assert.equal(d.status, "rascunho"); assert.equal(d.candidaturasTotal, 0); assert.equal(d.criadoPor, "adm1"); assert.equal(d.moderacao, "aprovada");
  falha(await api("POST", "/admin/vagas/empresas", "adm1", { nome: "x", tipo: "rede" }), 400); falha(await api("POST", "/admin/vagas/empresas", "adm1", { nome: "Rede Boa", tipo: "governo" }), 400);
});
t("admin: edita a vaga, muda o status e modera; recusar exige motivo e tira a vaga do mural", async () => {
  const emp = await rede(); const id = await vagaAdmin({}, emp);
  const e = await api("PUT", `/admin/vagas/${id}`, "adm1", { titulo: "Repositor noturno", cidade: "Mogi Mirim" }); ok(e); assert.equal(e.json.titulo, "Repositor noturno"); assert.equal((await get("vagas", id)).cidadeChave, "mogi-mirim-sp");
  falha(await api("PUT", `/admin/vagas/${id}`, "adm1", { uf: "ZZ" }), 400); falha(await api("PUT", "/admin/vagas/naoexiste", "adm1", { titulo: "Qualquer título" }), 404);
  falha(await api("PUT", `/admin/vagas/${id}/moderacao`, "adm1", { estado: "rejeitada" }), 400, "dados-invalidos"); falha(await api("PUT", `/admin/vagas/${id}/moderacao`, "adm1", { estado: "talvez" }), 400);
  ok(await api("PUT", `/admin/vagas/${id}/moderacao`, "adm1", { estado: "rejeitada", motivo: "Texto com contato pessoal" })); assert.equal((await api("GET", "/vagas", "p1")).json.vagas.length, 0);
  falha(await api("PUT", `/admin/vagas/${id}/status`, "adm1", { status: "voando" }), 400);
  const acoes = (await ctx.db.collection("auditoria").get()).docs.map((d) => d.data().acao); for (const a of ["vagas.empresa.criar", "vagas.admin.criar", "vagas.admin.editar", "vagas.admin.moderar"]) assert.ok(acoes.includes(a), a);
});
t("admin: lista candidatos por vaga com filtros (status, nome sem acento, CPF) e CPF sempre mascarado; CPF completo só com login recente e rastro", async () => {
  await pronto("p1", { nome: "José Antônio Pereira", cpfn: 0 }); await pronto("p2", { nome: "Ana Paula Souza", cpfn: 1 }); const vaga = await vagaAdmin(); const outra = await vagaAdmin({ titulo: "Outra vaga qualquer" });
  ok(await api("POST", `/vagas/${vaga}/candidatar`, "p1")); ok(await api("POST", `/vagas/${vaga}/candidatar`, "p2")); ok(await api("PUT", `/admin/vagas/candidaturas/${vaga}_p2/status`, "adm1", { status: "aceita" }));
  const lista = (b) => api("POST", `/admin/vagas/${vaga}/candidaturas`, "adm1", b);
  const todos = await lista({}); ok(todos); assert.equal(todos.json.candidaturas.length, 2); assert.equal(todos.json.vaga.candidaturas, 2); assert.equal(todos.json.candidaturas[0].temCurriculo, true);
  assert.ok(!/cpfEnc|cpfIdx/.test(JSON.stringify(todos.json)) && !JSON.stringify(todos.json).includes(CPFS[0]), "lista nunca traz o CPF completo");
  assert.deepEqual((await lista({ status: "aceita" })).json.candidaturas.map((c) => c.nome), ["Ana Paula Souza"]);
  assert.deepEqual((await lista({ q: "jose antonio" })).json.candidaturas.map((c) => c.nome), ["José Antônio Pereira"]);
  assert.deepEqual((await lista({ cpf: "529.982.247-25" })).json.candidaturas.map((c) => c.nome), ["José Antônio Pereira"]);
  assert.equal((await lista({ cpf: "11144477735" })).json.candidaturas.length, 1); falha(await lista({ cpf: "123" }), 400); falha(await lista({ cpf: "11111111111" }), 400, "cpf-invalido"); falha(await lista({ status: "xyz" }), 400);
  assert.equal((await api("POST", `/admin/vagas/${outra}/candidaturas`, "adm1")).json.candidaturas.length, 0); falha(await api("POST", "/admin/vagas/naoexiste/candidaturas", "adm1"), 404);
  const cpf = await api("POST", `/admin/vagas/candidaturas/${vaga}_p1/cpf`, "adm1"); ok(cpf); assert.equal(cpf.json.cpf, CPFS[0]); assert.match(cpf.json.cpfFormatado, /^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
  falha(await api("POST", `/admin/vagas/candidaturas/${vaga}_p1/cpf`, "adm2"), 401, "reautenticar");
  const aud = (await ctx.db.collection("auditoria").get()).docs.map((d) => d.data()).filter((a) => a.acao === "vagas.candidatura.ver_cpf"); assert.equal(aud.length, 1); assert.equal(aud[0].uid, "adm1"); assert.ok(!JSON.stringify(aud[0]).includes(CPFS[0]), "o CPF não vai para o log");
});
t("admin: abre o currículo da candidatura (PDF íntegro) e cada abertura fica na auditoria", async () => {
  await pronto("p1"); const vaga = await vagaAdmin(); ok(await api("POST", `/vagas/${vaga}/candidatar`, "p1"));
  const guardado = mem._arquivos.get((await get("profissionais_privado", "p1")).curriculo.path);
  const r = await api("GET", `/admin/vagas/candidaturas/${vaga}_p1/curriculo`, "adm1"); ok(r); assert.ok(Buffer.compare(r.texto, guardado) === 0); assert.equal(r.h["Content-Type"], "application/pdf");
  await api("GET", `/admin/vagas/candidaturas/${vaga}_p1/curriculo`, "adm1"); falha(await api("GET", "/admin/vagas/candidaturas/nada_p9/curriculo", "adm1"), 404);
  assert.equal((await ctx.db.collection("auditoria").get()).docs.filter((d) => d.data().acao === "vagas.curriculo.ver").length, 2);
  falha(await api("PUT", `/admin/vagas/candidaturas/${vaga}_p1/status`, "adm1", { status: "contratado" }), 400);
});

// ===================== empresa (loja) e cobrança =====================
t("loja: publica na fase gratuita; com moderação ligada a vaga só aparece no mural depois da aprovação do admin", async () => {
  await profissional("p1"); await set("contratantes", "lojaA", { uid: "lojaA", razaoSocial: "Mercado do Zé" });
  const r = await vagaLoja("lojaA"); ok(r); assert.equal(r.json.status, "ativa"); assert.equal(r.json.moderacao, "pendente"); assert.equal(r.json.gratuita, true); assert.equal(r.json.empresa.nome, "Mercado do Zé");
  assert.equal((await get("vagas_empresas", "loja_lojaA")).tipo, "loja"); assert.equal((await api("GET", "/vagas", "p1")).json.vagas.length, 0);
  assert.equal((await api("GET", "/admin/vagas?moderacao=pendente", "adm1")).json.length, 1);
  ok(await api("PUT", `/admin/vagas/${r.json.id}/moderacao`, "adm1", { estado: "aprovada" })); assert.equal((await api("GET", "/vagas", "p1")).json.vagas.length, 1);
  ok(await config({ moderacaoLojas: false })); const r2 = await vagaLoja("lojaA", { titulo: "Promotor sem moderação" }); assert.equal(r2.json.moderacao, "aprovada");
});
t("loja: editar o texto de uma vaga aprovada devolve à moderação (sem 'trocar o anúncio depois de aprovado')", async () => {
  const r = await vagaLoja("lojaA"); await api("PUT", `/admin/vagas/${r.json.id}/moderacao`, "adm1", { estado: "aprovada" });
  ok(await api("PUT", `/loja/vagas/${r.json.id}`, "lojaA", { cidade: "Mogi Mirim" })); assert.equal((await get("vagas", r.json.id)).moderacao, "aprovada", "só local/validade: segue aprovada");
  ok(await api("PUT", `/loja/vagas/${r.json.id}`, "lojaA", { descricao: "Agora a descrição é completamente diferente da aprovada." })); assert.equal((await get("vagas", r.json.id)).moderacao, "pendente");
  ok(await api("PUT", `/admin/vagas/${r.json.id}/moderacao`, "adm1", { estado: "rejeitada", motivo: "Fora das regras da plataforma" }));
  falha(await api("PUT", `/loja/vagas/${r.json.id}/status`, "lojaA", { status: "rascunho" }).then(async () => api("PUT", `/loja/vagas/${r.json.id}/status`, "lojaA", { status: "ativa" })), 409, "vaga-rejeitada");
});
t("loja: uma empresa nunca vê, edita ou encerra vaga de outra, nem candidatos nem currículos dela (IDOR → 404)", async () => {
  await pronto("p1"); const v = await vagaLoja("lojaA"); await api("PUT", `/admin/vagas/${v.json.id}/moderacao`, "adm1", { estado: "aprovada" }); ok(await api("POST", `/vagas/${v.json.id}/candidatar`, "p1")); const cid = `${v.json.id}_p1`;
  assert.equal((await api("GET", "/loja/vagas", "lojaB")).json.vagas.length, 0); assert.equal((await api("GET", "/loja/vagas", "lojaA")).json.vagas.length, 1);
  falha(await api("PUT", `/loja/vagas/${v.json.id}`, "lojaB", { titulo: "Invadido por outra loja" }), 404); falha(await api("PUT", `/loja/vagas/${v.json.id}/status`, "lojaB", { status: "encerrada" }), 404);
  falha(await api("GET", `/loja/vagas/${v.json.id}/candidaturas`, "lojaB"), 404); falha(await api("PUT", `/loja/vagas/candidaturas/${cid}/status`, "lojaB", { status: "aceita" }), 404);
  falha(await api("GET", `/loja/vagas/candidaturas/${cid}/curriculo`, "lojaB"), 404, "nao-encontrado"); assert.equal((await get("vagas", v.json.id)).status, "ativa");
  falha(await api("GET", "/loja/vagas", "p1"), 403, "sem-permissao");
});
t("loja: acompanha os candidatos da própria vaga (nome, CPF mascarado, currículo) e muda o status; CPF completo nunca chega à empresa", async () => {
  await pronto("p1", { nome: "Carla Mendes Rocha" }); const v = await vagaLoja("lojaA"); await api("PUT", `/admin/vagas/${v.json.id}/moderacao`, "adm1", { estado: "aprovada" }); ok(await api("POST", `/vagas/${v.json.id}/candidatar`, "p1"));
  const l = await api("GET", `/loja/vagas/${v.json.id}/candidaturas?status=pendente`, "lojaA"); ok(l); assert.equal(l.json.candidaturas[0].nome, "Carla Mendes Rocha"); assert.equal(l.json.candidaturas[0].cpfMascarado, V.mascararCPF(CPFS[0]));
  assert.ok(!JSON.stringify(l.json).includes(CPFS[0]) && !/cpfEnc|cpfIdx/.test(JSON.stringify(l.json)));
  assert.equal((await api("GET", `/loja/vagas/${v.json.id}/candidaturas?status=aceita`, "lojaA")).json.candidaturas.length, 0);
  ok(await api("PUT", `/loja/vagas/candidaturas/${v.json.id}_p1/status`, "lojaA", { status: "aceita" })); assert.equal((await get("vagas_candidaturas", `${v.json.id}_p1`)).status, "aceita");
  ok(await api("GET", `/loja/vagas/candidaturas/${v.json.id}_p1/curriculo`, "lojaA"));
  falha(await api("POST", `/admin/vagas/candidaturas/${v.json.id}_p1/cpf`, "lojaA"), 403, "sem-permissao");
});
t("cobrança: teto de vagas ativas por empresa na fase gratuita (anti-abuso); encerrar uma libera outra", async () => {
  ok(await config({ maxVagasAtivasGratis: 2 })); const a = await vagaLoja("lojaA", { titulo: "Vaga número um" }), b = await vagaLoja("lojaA", { titulo: "Vaga número dois" });
  ok(a); ok(b); falha(await vagaLoja("lojaA", { titulo: "Vaga número três" }), 409, "limite-vagas-gratis");
  ok(await api("PUT", `/loja/vagas/${a.json.id}/status`, "lojaA", { status: "encerrada" })); ok(await vagaLoja("lojaA", { titulo: "Vaga número três" }));
  ok(await vagaLoja("lojaB", { titulo: "Outra empresa não é afetada" }));
});
t("cobrança: virar a chave encerra a gratuidade só para NOVAS publicações; quem publicou de graça segue grátis até vencer", async () => {
  const antiga = await vagaLoja("lojaA", { titulo: "Publicada no lançamento" }); assert.equal(antiga.json.gratuita, true);
  const cfg = await config({ faseGratuita: false, modelo: "mensalidade", mensalidadeCentavos: 19900 }); ok(cfg); assert.equal(cfg.json.faseGratuitaAtiva, false);
  assert.equal((await get("vagas", antiga.json.id)).gratuita, true, "vaga antiga continua gratuita");
  const nova = await vagaLoja("lojaA", { titulo: "Publicada depois da virada" }); falha(nova, 402, "plano-necessario"); assert.equal(nova.json.detalhe.modelo, "mensalidade"); assert.equal(nova.json.detalhe.valorCentavos, 19900);
  const emp = (await api("GET", "/admin/vagas/empresas", "adm1")).json.find((e) => e.id === "loja_lojaA"); assert.equal(emp.assinaturaAtiva, false);
  ok(await api("PUT", `/admin/vagas/empresas/${emp.id}/plano`, "adm1", { assinaturaAte: dia(30) }));
  const paga = await vagaLoja("lojaA", { titulo: "Publicada com mensalidade" }); ok(paga); assert.equal(paga.json.gratuita, false); assert.equal((await get("vagas", paga.json.id)).cobranca.modelo, "mensalidade");
  ok(await api("PUT", `/admin/vagas/empresas/${emp.id}/plano`, "adm1", { assinaturaAte: null })); falha(await vagaLoja("lojaA", { titulo: "Mensalidade cancelada" }), 402, "plano-necessario");
  E.avancar(1); const vencida = await api("PUT", `/admin/vagas/empresas/${emp.id}/plano`, "adm1", { assinaturaAte: dia(-1) }); ok(vencida); assert.equal(vencida.json.assinaturaAtiva, false);
});
t("cobrança: a fase gratuita acaba sozinha na data limite, sem ninguém mexer na chave", async () => {
  ok(await config({ gratuitoAte: dia(5) })); ok(await vagaLoja("lojaA", { titulo: "Dentro do prazo gratuito" }));
  E.avancar(6 * DIA); const cfg = await api("GET", "/admin/vagas/config", "adm1"); assert.equal(cfg.json.faseGratuita, true); assert.equal(cfg.json.faseGratuitaAtiva, false);
  falha(await vagaLoja("lojaA", { titulo: "Fora do prazo gratuito" }), 402, "plano-necessario");
  ok(await config({ gratuitoAte: null })); ok(await vagaLoja("lojaA", { titulo: "Prazo removido, volta a ser grátis" }));
});
t("cobrança: modelo de créditos consome 1 por publicação, atômico (com 1 crédito, só 1 de 2 publicações simultâneas passa)", async () => {
  ok(await config({ faseGratuita: false, modelo: "creditos", creditoCentavos: 4900 })); const a = await api("POST", "/loja/vagas", "lojaA", { ...VAGA, titulo: "Rascunho um" }), b = await api("POST", "/loja/vagas", "lojaA", { ...VAGA, titulo: "Rascunho dois" });
  ok(a); ok(b); falha(await api("PUT", `/loja/vagas/${a.json.id}/status`, "lojaA", { status: "ativa" }), 402, "plano-necessario");
  falha(await api("PUT", "/admin/vagas/empresas/loja_lojaA/plano", "adm1", { creditosDelta: -1 }), 400, "dados-invalidos"); ok(await api("PUT", "/admin/vagas/empresas/loja_lojaA/plano", "adm1", { creditosDelta: 1 }));
  const rs = await Promise.all([a, b].map((v) => api("PUT", `/loja/vagas/${v.json.id}/status`, "lojaA", { status: "ativa" })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1); assert.equal(rs.filter((r) => r.json?.codigo === "plano-necessario").length, 1);
  assert.equal((await get("vagas_empresas", "loja_lojaA")).creditos, 0); const ativa = rs.find((r) => r.status === 200).json; assert.equal((await get("vagas", ativa.id)).cobranca.creditosUsados, 1);
  falha(await api("PUT", "/admin/vagas/empresas/naoexiste/plano", "adm1", { creditosDelta: 1 }), 404); falha(await api("PUT", "/admin/vagas/empresas/loja_lojaA/plano", "adm1", { creditosDelta: 1.5 }), 400);
});
t("cobrança: o admin publica em nome de redes parceiras sem cobrança, mesmo com a fase gratuita encerrada (onboarding)", async () => {
  ok(await config({ faseGratuita: false, modelo: "mensalidade" })); const emp = await rede("Rede São Vicente");
  const r = await api("POST", "/admin/vagas", "adm1", { empresaId: emp, ...VAGA, publicar: true }); ok(r); assert.equal(r.json.status, "ativa"); assert.equal(r.json.gratuita, false);
  assert.equal((await get("vagas_empresas", emp)).creditos, 0); assert.equal((await api("GET", "/vagas", "p1")).json.vagas.length, 1);
});
t("cobrança: configuração só pelo admin, validada, e cada virada de chave fica na auditoria com antes e depois", async () => {
  falha(await api("PUT", "/admin/vagas/config", "lojaA", { faseGratuita: false }), 403, "sem-permissao");
  for (const mau of [{ modelo: "boleto" }, { faseGratuita: "nao" }, { mensalidadeCentavos: -1 }, { mensalidadeCentavos: 1.5 }, { validadeDiasPadrao: 0 }, { validadeDiasPadrao: 999 }, { maxVagasAtivasGratis: 0 }, { gratuitoAte: "ontem" }, {}, { inventado: true }]) falha(await config(mau), 400, "dados-invalidos");
  assert.equal((await api("GET", "/admin/vagas/config", "adm1")).json.faseGratuita, true, "padrão: lançamento gratuito");
  ok(await config({ faseGratuita: false, validadeDiasPadrao: 45, mensalidadeCentavos: 9900 }));
  const a = (await ctx.db.collection("auditoria").get()).docs.map((d) => d.data()).find((x) => x.acao === "vagas.config.alterar"); assert.equal(a.detalhes.antes.faseGratuita, true); assert.equal(a.detalhes.depois.faseGratuita, false); assert.equal(a.uid, "adm1");
  const v = await vagaLoja("lojaA").catch(() => null); assert.ok(v);
});
t("validade: a vaga publicada recebe a validade padrão da configuração e o cron encerra as vencidas", async () => {
  ok(await config({ validadeDiasPadrao: 10 })); const id = await vagaAdmin(); const exp = (await get("vagas", id)).expiraEm.toMillis(); assert.equal(Math.round((exp - Date.now()) / DIA), 10);
  E.avancar(11 * DIA); assert.equal((await get("vagas", id)).status, "ativa", "ainda marcada como ativa até o cron");
  const m = await api("POST", "/interno/manutencao", undefined, {}, { headers: { "x-cron-secret": "cron-secreto" } }); ok(m); assert.equal(m.json.vagasEncerradas, 1);
  assert.equal((await get("vagas", id)).status, "encerrada"); assert.ok((await get("vagas", id)).encerradaEm);
});
t("segurança: regras do Firestore e do Storage negam acesso direto de clientes às coleções e ao bucket de currículos", () => {
  const raiz = path.join(__dirname, ".."), fr = fs.readFileSync(path.join(raiz, "firestore.rules"), "utf8"), sr = fs.readFileSync(path.join(raiz, "storage.rules"), "utf8");
  for (const c of ["vagas", "vagas_empresas", "vagas_candidaturas"]) assert.match(fr, new RegExp(`match /${c}/\\{id\\}\\s*\\{ allow read, write: if false; \\}`), c);
  assert.match(sr, /match \/\{allPaths=\*\*\}\s*\{ allow read, write: if false; \}/); assert.ok(!/allow (read|write|get|list|create)[^;]*:\s*if (true|request\.auth)/.test(sr), "nenhum allow para clientes");
  assert.equal(JSON.parse(fs.readFileSync(path.join(raiz, "firebase.json"), "utf8")).storage.rules, "storage.rules");
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    reset(); const w = console.warn, er = console.error; console.warn = () => {}; console.error = () => {};
    try { await fn(); process.stdout.write(`  ✓ ${nome}\n`); }
    catch (e) { falhas++; process.stdout.write(`  ✗ ${nome}\n      ${String(e.stack || e).split("\n").slice(0, 5).join("\n      ")}\n`); }
    finally { console.warn = w; console.error = er; }
  }
  E.restaurarRelogio(); process.stdout.write(`\n${testes.length - falhas}/${testes.length} testes do mural de vagas passaram\n`); process.exit(falhas ? 1 : 0);
})();
