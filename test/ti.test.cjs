// Bateria do módulo de TI: RBAC, operadores (senha, exclusão lógica, último gestor), trilha de auditoria (hash encadeado),
// chamados (máquina de estados, SLA, IDOR), métricas agregadas, ranking e presença online. Sem rede (ver fake-env.cjs).
const crypto = require("node:crypto");
process.env.AMBIENTE = "teste"; process.env.MODO_TESTE = "1"; process.env.APP_URL = "https://app.exemplo.com";
process.env.MP_ACCESS_TOKEN = "APP_USR-teste"; process.env.MP_WEBHOOK_SECRET = "segredo-webhook"; process.env.CRON_SECRET = "cron-secreto";
process.env.DATA_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString("base64")}`; process.env.DATA_ENCRYPTION_KEY_ID = "1"; process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
const assert = require("node:assert/strict");
const E = require("./fake-env.cjs");
const { ctx, chamar } = E.carregarServidor();
const { ti } = ctx;
const SENHA = "Cavalo-Bateria-Grampo-42";

/** Prepara operadores semeados direto no banco (equivale ao script de bootstrap). */
const U = {
  gest: { uid: "ti-gest", email: "gestora@abastece.ti", email_verified: true }, gest2: { uid: "ti-gest2", email: "gestor2@abastece.ti", email_verified: true },
  tec1: { uid: "ti-tec1", email: "ana@abastece.ti", email_verified: true }, tec2: { uid: "ti-tec2", email: "bruno@abastece.ti", email_verified: true },
  lojaA: { uid: "lojaA", email: "a@x.com", email_verified: true }, lojaB: { uid: "lojaB", email: "b@x.com", email_verified: true }, prom1: { uid: "prom1", email: "p@x.com", email_verified: true }, adm: { uid: "adm1", email: "adm@x.com", email_verified: true },
  semPapel: { uid: "sem", email: "s@x.com", email_verified: true }
};
const set = (col, id, d) => ctx.db.collection(col).doc(id).set(d);
const get = async (col, id) => (await ctx.db.collection(col).doc(id).get()).data();
const todos = async (col) => (await ctx.db.collection(col).get()).docs.map((d) => d.data());
async function operador(chave, nivel, extra = {}) {
  const u = U[chave]; E.claimsStore[u.uid] = { role: "ti", perfis: ["ti"], tiNivel: nivel };
  await set("ti_operadores", u.uid, { uid: u.uid, nome: { gest: "Gestora Gil", gest2: "Gestor Dois", tec1: "Ana Técnica", tec2: "Bruno Técnico" }[chave], email: u.email, nivel, status: "ativo", trocarSenha: false, criadoEm: new E.Timestamp(Date.now()), ...extra });
}
function reset() {
  E.limpar(); Object.assign(E.tokens, U);
  E.claimsStore.lojaA = { role: "loja" }; E.claimsStore.lojaB = { role: "loja" }; E.claimsStore.prom1 = { role: "promotor", treinado: false }; E.claimsStore.adm1 = { role: "admin" };
  E.clock.now = Date.now(); ctx.__reset();
}
const ok = (r, msg = "") => assert.equal(r.status, 200, `${msg} esperado 200, veio ${r.status} ${JSON.stringify(r.json)}`);
const falha = (r, status, codigo) => { assert.equal(r.status, status, `esperado ${status}/${codigo}, veio ${r.status} ${JSON.stringify(r.json)}`); if (codigo) assert.equal(r.json.codigo, codigo); };
const novoChamado = async (token = "lojaA", over = {}) => { const r = await chamar("POST", "/chamados", { token, body: { titulo: "Pix não confirma", descricao: "Paguei e o pedido continua aberto.", categoria: "pagamento", urgencia: "alta", ...over } }); ok(r, "abrir chamado"); return r.json; };
const MIN = 60_000;

const testes = []; const t = (nome, fn) => testes.push([nome, fn]);

// ======================= acesso (RBAC) =======================
t("RBAC: só operador de TI ativo entra; loja/promotor/admin/sem papel/sem login são barrados; nível limita a ação", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico");
  for (const tk of ["lojaA", "prom1", "adm", "semPapel"]) { falha(await chamar("GET", "/ti/operadores", { token: tk }), 403, "sem-permissao"); falha(await chamar("GET", "/ti/dashboard", { token: tk }), 403, "sem-permissao"); }
  falha(await chamar("GET", "/ti/dashboard", {}), 401, "nao-autenticado");
  ok(await chamar("GET", "/ti/dashboard", { token: "gest" })); ok(await chamar("GET", "/ti/dashboard", { token: "tec1" }));
  // técnico não gerencia operadores nem vê toda a auditoria / verificação
  falha(await chamar("POST", "/ti/operadores", { token: "tec1", body: { nome: "Fulano de Tal", email: "f@abastece.ti", nivel: "tecnico" } }), 403, "sem-permissao");
  falha(await chamar("GET", "/ti/auditoria/verificar", { token: "tec1" }), 403, "sem-permissao");
  falha(await chamar("GET", "/ti/auditoria/exportar", { token: "tec1" }), 403, "sem-permissao");
  const lista = await chamar("GET", "/ti/operadores", { token: "tec1" }); ok(lista);
  assert.ok(lista.json.length === 2 && lista.json.every((o) => !("email" in o)), "técnico só vê nome/nível, sem e-mail");
  // a recusa do técnico ficou registrada na trilha
  const aud = (await todos("ti_auditoria")).filter((a) => a.resultado === "negado" && a.operadorUid === "ti-tec1");
  assert.ok(aud.length >= 2, "acessos negados auditados");
});
t("operador excluído/desativado perde o acesso na hora, mesmo com token ainda válido", async () => {
  await operador("tec1", "tecnico", { status: "excluido" });
  falha(await chamar("GET", "/ti/dashboard", { token: "tec1" }), 403, "operador-inativo");
});
t("conta de TI não consegue virar loja/promotor (cadastro/sessão do app comercial)", async () => {
  await operador("gest", "gestor");
  falha(await chamar("POST", "/sessao", { token: "gest", body: { portal: "loja" } }), 403, "conta-ti");
  falha(await chamar("POST", "/cadastro/loja", { token: "gest", body: { termos: true } }), 403, "conta-ti");
  falha(await chamar("POST", "/cadastro/promotor", { token: "gest", body: { termos: true } }), 403, "conta-ti");
  assert.equal(E.claimsStore["ti-gest"].role, "ti", "claim intacta");
});

// ======================= operadores =======================
t("operadores: cadastro valida, gera senha temporária, claim role=ti, duplicado 409, exige login recente", async () => {
  await operador("gest", "gestor");
  const base = { nome: "Carla Suporte", email: "Carla@Abastece.TI", nivel: "tecnico" };
  falha(await chamar("POST", "/ti/operadores", { token: "gest", body: { ...base, senha: "curta" } }), 400, "senha-fraca");
  falha(await chamar("POST", "/ti/operadores", { token: "gest", body: { ...base, senha: "carla@abastece-2026X" } }), 400, "senha-fraca");   // contém o e-mail
  falha(await chamar("POST", "/ti/operadores", { token: "gest", body: { ...base, nivel: "root" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/ti/operadores", { token: "gest", body: { ...base, email: { $ne: 1 } } }), 400, "dados-invalidos");
  E.tokens.gest = { ...U.gest, auth_time: Math.floor(Date.now() / 1000) - 3600 };
  falha(await chamar("POST", "/ti/operadores", { token: "gest", body: base }), 401, "reautenticar");
  E.tokens.gest = U.gest;
  const r = await chamar("POST", "/ti/operadores", { token: "gest", body: base }); ok(r);
  assert.equal(r.json.operador.email, "carla@abastece.ti"); assert.equal(r.json.operador.trocarSenha, true); assert.ok(r.json.senhaTemporaria.length >= 12);
  const uid = r.json.operador.uid; assert.deepEqual({ role: E.claimsStore[uid].role, nivel: E.claimsStore[uid].tiNivel }, { role: "ti", nivel: "tecnico" });
  assert.equal(E.contas.get(uid).password, r.json.senhaTemporaria); assert.equal(E.contas.get(uid).emailVerified, true);
  falha(await chamar("POST", "/ti/operadores", { token: "gest", body: base }), 409, "email-em-uso");
  assert.ok(!JSON.stringify(await get("ti_operadores", uid)).includes(r.json.senhaTemporaria), "senha nunca persistida no Firestore");
});
t("senha temporária: tudo bloqueado (trocar-senha) até o operador definir a sua; troca revoga sessões e limpa a flag", async () => {
  await operador("gest", "gestor");
  const c = await chamar("POST", "/ti/operadores", { token: "gest", body: { nome: "Carla Suporte", email: "carla@abastece.ti", nivel: "tecnico" } }); ok(c);
  const uid = c.json.operador.uid; E.tokens.carla = { uid, email: "carla@abastece.ti", email_verified: true };
  falha(await chamar("GET", "/ti/dashboard", { token: "carla" }), 403, "trocar-senha");
  const s = await chamar("POST", "/ti/sessao", { token: "carla" }); ok(s); assert.equal(s.json.operador.trocarSenha, true);       // sessão/sair/senha continuam liberadas
  falha(await chamar("POST", "/ti/eu/senha", { token: "carla", body: { senhaNova: "fraca" } }), 400, "senha-fraca");
  falha(await chamar("POST", "/ti/eu/senha", { token: "carla", body: { senhaNova: "carla-abastece-Forte9" } }), 400, "senha-fraca");  // contém parte do e-mail
  const ok1 = await chamar("POST", "/ti/eu/senha", { token: "carla", body: { senhaNova: SENHA } }); ok(ok1); assert.equal(ok1.json.relogin, true);
  assert.equal(E.contas.get(uid).password, SENHA); assert.ok(E.revogados.has(uid), "sessões revogadas");
  assert.equal((await get("ti_operadores", uid)).trocarSenha, false);
  E.revogados.delete(uid); ok(await chamar("GET", "/ti/dashboard", { token: "carla" }));
});
t("reset de senha por gestor: temporária, revoga sessões, obriga troca; não vale para si mesmo; técnico não pode", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico");
  falha(await chamar("POST", "/ti/operadores/ti-tec1/senha", { token: "tec1" }), 403, "sem-permissao");
  falha(await chamar("POST", "/ti/operadores/ti-gest/senha", { token: "gest" }), 409, "proprio-usuario");
  E.contas.set("ti-tec1", { uid: "ti-tec1", email: "ana@abastece.ti" });
  falha(await chamar("POST", "/ti/operadores/ti-tec1/senha", { token: "gest" }), 400, "dados-invalidos");   // motivo obrigatório (e não pede mais a senha atual)
  const r = await chamar("POST", "/ti/operadores/ti-tec1/senha", { token: "gest", body: { motivo: "Esqueceu a senha" } }); ok(r);
  assert.equal(E.contas.get("ti-tec1").password, r.json.senhaTemporaria); assert.ok(E.revogados.has("ti-tec1")); assert.equal((await get("ti_operadores", "ti-tec1")).trocarSenha, true);
  falha(await chamar("POST", "/ti/operadores/nao-existe/senha", { token: "gest", body: { motivo: "Esqueceu a senha" } }), 404, "nao-encontrado");
});
t("exclusão lógica: marca, desativa login, revoga sessões, devolve chamados à fila; mantém o registro; restaurar reativa com senha nova", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico");
  E.contas.set("ti-tec1", { uid: "ti-tec1", email: "ana@abastece.ti" });
  const c = await novoChamado(); ok(await chamar("POST", `/ti/chamados/${c.id}/assumir`, { token: "tec1" }));
  falha(await chamar("POST", "/ti/operadores/ti-tec1/excluir", { token: "gest", body: {} }), 400, "dados-invalidos");   // motivo obrigatório
  const r = await chamar("POST", "/ti/operadores/ti-tec1/excluir", { token: "gest", body: { motivo: "Desligamento da empresa" } }); ok(r);
  assert.equal(r.json.chamadosDevolvidos, 1);
  const d = await get("ti_operadores", "ti-tec1"); assert.equal(d.status, "excluido"); assert.equal(d.motivoExclusao, "Desligamento da empresa"); assert.equal(d.excluidoPor, "ti-gest");
  assert.equal(E.contas.get("ti-tec1").disabled, true); assert.ok(E.revogados.has("ti-tec1"));
  falha(await chamar("GET", "/ti/dashboard", { token: "tec1" }), 401, "sessao-invalida");     // token revogado
  const ch = await chamar("GET", `/ti/chamados/${c.id}`, { token: "gest" }); assert.equal(ch.json.status, "aberto"); assert.equal(ch.json.atribuidoUid, "");
  assert.equal((await chamar("GET", "/ti/operadores", { token: "gest" })).json.length, 1);
  assert.equal((await chamar("GET", "/ti/operadores?status=excluido", { token: "gest" })).json.length, 1);
  falha(await chamar("POST", "/ti/operadores/ti-tec1/excluir", { token: "gest", body: { motivo: "de novo, para teste" } }), 409, "operador-excluido");
  const rest = await chamar("POST", "/ti/operadores/ti-tec1/restaurar", { token: "gest" }); ok(rest);
  assert.equal(E.contas.get("ti-tec1").disabled, false); assert.equal(E.contas.get("ti-tec1").password, rest.json.senhaTemporaria); assert.equal((await get("ti_operadores", "ti-tec1")).trocarSenha, true);
  falha(await chamar("POST", "/ti/operadores/ti-tec1/restaurar", { token: "gest" }), 409, "nao-excluido");
});
t("proteções: não exclui a si mesmo, não rebaixa a si mesmo, nunca deixa a TI sem gestor ativo (nem em pedidos simultâneos)", async () => {
  await operador("gest", "gestor"); await operador("gest2", "gestor");
  for (const k of ["gest", "gest2"]) E.contas.set(U[k].uid, { uid: U[k].uid, email: U[k].email });
  falha(await chamar("POST", "/ti/operadores/ti-gest/excluir", { token: "gest", body: { motivo: "teste de proteção" } }), 409, "proprio-usuario");
  falha(await chamar("PUT", "/ti/operadores/ti-gest/nivel", { token: "gest", body: { nivel: "tecnico" } }), 409, "proprio-usuario");
  // dois gestores tentam se remover ao mesmo tempo: exatamente um consegue; sempre sobra um gestor ativo
  const [x, y] = await Promise.all([chamar("POST", "/ti/operadores/ti-gest2/excluir", { token: "gest", body: { motivo: "remoção cruzada A" } }), chamar("POST", "/ti/operadores/ti-gest/excluir", { token: "gest2", body: { motivo: "remoção cruzada B" } })]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  assert.equal((await ti.operadores.listar()).filter((o) => o.nivel === "gestor").length, 1);
  const barrado = x.status === 409 ? x : y; assert.equal(barrado.json.codigo, "ultimo-gestor");
});
t("alterar nível: atualiza claim e revoga sessões; técnico rebaixado perde permissões na hora", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico");
  ok(await chamar("PUT", "/ti/operadores/ti-tec1/nivel", { token: "gest", body: { nivel: "gestor" } }));
  assert.equal(E.claimsStore["ti-tec1"].tiNivel, "gestor"); assert.ok(E.revogados.has("ti-tec1")); E.revogados.delete("ti-tec1");
  ok(await chamar("GET", "/ti/operadores", { token: "tec1" }));
  falha(await chamar("PUT", "/ti/operadores/ti-tec1/nivel", { token: "gest", body: { nivel: "chefe" } }), 400, "dados-invalidos");
});

// ======================= auditoria =======================
t("auditoria: toda ação fica registrada com quem/o quê/antes→depois/IP, SEM senhas; cadeia de hash íntegra", async () => {
  await operador("gest", "gestor");
  const c = await chamar("POST", "/ti/operadores", { token: "gest", body: { nome: "Carla Suporte", email: "carla@abastece.ti", nivel: "tecnico", senha: SENHA }, ip: "10.1.2.3", headers: { "user-agent": "Teste/1.0" } }); ok(c);
  const uid = c.json.operador.uid; ok(await chamar("PUT", `/ti/operadores/${uid}/nivel`, { token: "gest", body: { nivel: "gestor" } }));
  const regs = (await todos("ti_auditoria")).sort((a, b) => a.seq - b.seq);
  assert.deepEqual(regs.map((r) => r.acao), ["operador.criar", "operador.nivel"]);
  const [criar, nivel] = regs;
  assert.equal(criar.operadorUid, "ti-gest"); assert.equal(criar.ip, "10.1.2.3"); assert.equal(criar.ua, "Teste/1.0"); assert.equal(criar.alvoId, uid); assert.equal(criar.resultado, "ok");
  assert.deepEqual(nivel.antes, { nivel: "tecnico" }); assert.deepEqual(nivel.depois, { nivel: "gestor" });
  assert.ok(!JSON.stringify(regs).includes(SENHA), "senha em claro nunca vai para a trilha");
  const v = await chamar("GET", "/ti/auditoria/verificar", { token: "gest" }); ok(v); assert.equal(v.json.ok, true); assert.ok(v.json.verificados >= 2);
});
t("auditoria: adulterar, apagar ou reordenar um registro quebra a cadeia e a verificação acusa", async () => {
  await operador("gest", "gestor");
  for (let i = 0; i < 4; i++) await ti.auditoria.registrar({ uid: "ti-gest", nome: "G", nivel: "gestor", ip: "1.1.1.1" }, { acao: "teste.evento", resumo: "evento " + i });
  ok(await chamar("GET", "/ti/auditoria/verificar", { token: "gest" }));
  const k = "ti_auditoria/0000000002", original = JSON.parse(JSON.stringify(E.store.get(k)));
  E.store.get(k).resumo = "adulterado";
  let v = await chamar("GET", "/ti/auditoria/verificar", { token: "gest" }); assert.equal(v.json.ok, false); assert.ok(v.json.problemas.some((p) => p.seq === 2 && p.problema === "conteudo-alterado"));
  E.store.set(k, original); assert.equal((await chamar("GET", "/ti/auditoria/verificar", { token: "gest" })).json.ok, true);
  E.store.delete("ti_auditoria/0000000003");
  v = await chamar("GET", "/ti/auditoria/verificar", { token: "gest" }); assert.equal(v.json.ok, false); assert.ok(v.json.problemas.some((p) => /buraco|encadeamento/.test(p.problema)));
});
t("auditoria: gravações simultâneas não repetem nem pulam número de sequência", async () => {
  await Promise.all(Array.from({ length: 25 }, (_, i) => ti.auditoria.registrar({ uid: "x" + (i % 3), nome: "N", nivel: "tecnico" }, { acao: "teste.paralelo", resumo: String(i) })));
  const seqs = (await todos("ti_auditoria")).map((r) => r.seq).sort((a, b) => a - b); assert.deepEqual(seqs, Array.from({ length: 25 }, (_, i) => i + 1));
  assert.equal((await ti.auditoria.verificar()).ok, true);
});
t("auditoria: filtros (operador, ação, alvo, período), paginação por cursor; técnico só enxerga o que ele próprio fez", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico");
  const c1 = await novoChamado(), c2 = await novoChamado("lojaB");
  ok(await chamar("POST", `/ti/chamados/${c1.id}/assumir`, { token: "tec1" })); E.avancar(2 * MIN);
  ok(await chamar("POST", `/ti/chamados/${c2.id}/assumir`, { token: "gest" })); E.avancar(2 * MIN);
  ok(await chamar("POST", `/ti/chamados/${c2.id}/comentarios`, { token: "gest", body: { texto: "Verificando o gateway" } }));
  const g = await chamar("GET", "/ti/auditoria", { token: "gest" }); ok(g); assert.ok(g.json.itens.length >= 3);
  assert.ok(g.json.itens.every((a, i, v) => i === 0 || a.seq < v[i - 1].seq), "mais recentes primeiro");
  assert.equal((await chamar("GET", "/ti/auditoria?operador=ti-tec1", { token: "gest" })).json.itens.every((a) => a.operadorUid === "ti-tec1"), true);
  assert.equal((await chamar("GET", "/ti/auditoria?acao=chamado.comentar", { token: "gest" })).json.itens.length, 1);
  assert.equal((await chamar("GET", `/ti/auditoria?alvo=${c1.id}`, { token: "gest" })).json.itens.length, 1);
  const p1 = await chamar("GET", "/ti/auditoria?limite=2", { token: "gest" }); assert.equal(p1.json.itens.length, 2); assert.ok(p1.json.proximo);
  const p2 = await chamar("GET", `/ti/auditoria?limite=50&cursor=${p1.json.proximo}`, { token: "gest" }); assert.ok(p2.json.itens.every((a) => a.seq < p1.json.itens[1].seq));
  const hoje = new Date(Date.now()).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  assert.ok((await chamar("GET", `/ti/auditoria?de=${hoje}&ate=${hoje}`, { token: "gest" })).json.itens.length >= 3);
  assert.equal((await chamar("GET", "/ti/auditoria?de=2001-01-01&ate=2001-01-02", { token: "gest" })).json.itens.length, 0);
  falha(await chamar("GET", "/ti/auditoria?de=2026-02-31", { token: "gest" }), 400, "dados-invalidos");
  falha(await chamar("GET", "/ti/auditoria?cursor=abc", { token: "gest" }), 400, "dados-invalidos");
  const meu = await chamar("GET", "/ti/auditoria?operador=ti-gest", { token: "tec1" }); ok(meu);        // técnico tentando ver a gestora: o filtro é ignorado
  assert.ok(meu.json.itens.length > 0 && meu.json.itens.every((a) => a.operadorUid === "ti-tec1"));
});
t("auditoria: exportação CSV (BOM, ; e neutralização de fórmula) e a própria exportação/consulta ficam registradas", async () => {
  await operador("gest", "gestor");
  await ti.auditoria.registrar({ uid: "ti-gest", nome: "=HYPERLINK(\"http://x\")", nivel: "gestor" }, { acao: "teste.csv", resumo: "linha; com ponto-e-vírgula" });
  const r = await chamar("GET", "/ti/auditoria/exportar", { token: "gest" }); ok(r);
  assert.ok(r.texto.startsWith("﻿Seq;Data/hora;Operador")); assert.ok(r.texto.includes("'=HYPERLINK"), "fórmula neutralizada: " + JSON.stringify(r.texto).slice(0, 600)); assert.ok(r.texto.includes('"linha; com ponto-e-vírgula"'));
  assert.ok((await todos("ti_auditoria")).some((a) => a.acao === "auditoria.exportar"));
});
t("auditoria: tentativa recusada por regra (ex.: excluir o último gestor) também é registrada, com o motivo", async () => {
  await operador("gest", "gestor"); await operador("gest2", "gestor", { status: "excluido" });
  falha(await chamar("POST", "/ti/operadores/ti-gest/excluir", { token: "gest", body: { motivo: "teste de recusa" } }), 409, "proprio-usuario");
  const a = (await todos("ti_auditoria")).find((x) => x.acao === "operador.excluir"); assert.equal(a.resultado, "erro"); assert.equal(a.meta.codigo, "proprio-usuario");
});

// ======================= chamados =======================
t("chamado do usuário: protocolo sequencial, urgência crítica proibida, limite por hora, só o dono vê (IDOR → 404)", async () => {
  const c1 = await novoChamado(); assert.equal(c1.protocolo, "TI-000001"); assert.equal(c1.status, "aberto");
  falha(await chamar("POST", "/chamados", { token: "lojaA", body: { titulo: "Quero crítica", descricao: "tentando forçar prioridade", urgencia: "critica" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/chamados", { token: "lojaA", body: { titulo: "ab", descricao: "curto" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/chamados", { token: "lojaA", body: { titulo: { $gt: "" }, descricao: "descrição qualquer" } }), 400, "dados-invalidos");
  const c2 = await novoChamado("prom1", { urgencia: "baixa" }); assert.equal(c2.protocolo, "TI-000002");
  const d = await get("chamados_ti", c1.id); assert.equal(d.prioridade, "alta"); assert.equal(d.solicitanteUid, "lojaA"); assert.equal(d.slaAtendMs - d.criadoMs, 60 * MIN);
  assert.equal((await chamar("GET", "/chamados/meus", { token: "lojaA" })).json.length, 1);
  ok(await chamar("GET", `/chamados/${c1.id}`, { token: "lojaA" })); falha(await chamar("GET", `/chamados/${c1.id}`, { token: "lojaB" }), 404, "nao-encontrado");
  falha(await chamar("POST", `/chamados/${c1.id}/responder`, { token: "lojaB", body: { texto: "invasor" } }), 404, "nao-encontrado");
  falha(await chamar("GET", "/chamados/meus", { token: "semPapel" }), 403); falha(await chamar("GET", "/chamados/meus", {}), 401);
  for (let i = 0; i < 3; i++) await novoChamado("lojaB"); await novoChamado("lojaB"); await novoChamado("lojaB");
  falha(await chamar("POST", "/chamados", { token: "lojaB", body: { titulo: "Sexto chamado", descricao: "passou do limite por hora" } }), 429, "limite-requisicoes");
});
t("fila da equipe: mais urgentes primeiro; filtros; assumir (1 só vence); técnico não mexe no chamado do colega; gestor pode", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico"); await operador("tec2", "tecnico");
  const baixa = await novoChamado("lojaA", { urgencia: "baixa" }); E.avancar(MIN); const alta = await novoChamado("lojaB", { urgencia: "alta" });
  const fila = await chamar("GET", "/ti/chamados", { token: "tec1" }); ok(fila); assert.deepEqual(fila.json.itens.map((c) => c.id), [alta.id, baixa.id]);
  assert.equal((await chamar("GET", "/ti/chamados?prioridade=baixa", { token: "tec1" })).json.itens.length, 1);
  assert.equal((await chamar("GET", `/ti/chamados?q=${alta.protocolo}`, { token: "tec1" })).json.itens.length, 1);
  assert.equal((await chamar("GET", "/ti/chamados?atribuido=nenhum", { token: "tec1" })).json.itens.length, 2);
  const [a, b] = await Promise.all([chamar("POST", `/ti/chamados/${alta.id}/assumir`, { token: "tec1" }), chamar("POST", `/ti/chamados/${alta.id}/assumir`, { token: "tec2" })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], "assumir simultâneo: um vence"); assert.equal((a.status === 409 ? a : b).json.codigo, "ja-atribuido");
  const dono = a.status === 200 ? "tec1" : "tec2", outro = dono === "tec1" ? "tec2" : "tec1";
  falha(await chamar("POST", `/ti/chamados/${alta.id}/status`, { token: outro, body: { status: "resolvido", nota: "tentando roubar" } }), 403, "nao-e-seu");
  falha(await chamar("POST", `/ti/chamados/${baixa.id}/status`, { token: dono, body: { status: "resolvido", nota: "sem assumir antes" } }), 409);
  falha(await chamar("POST", `/ti/chamados/${alta.id}/atribuir`, { token: dono, body: { operadorUid: "ti-gest" } }), 403, "sem-permissao");   // só gestor encaminha
  ok(await chamar("POST", `/ti/chamados/${alta.id}/atribuir`, { token: "gest", body: { operadorUid: U[outro].uid } }));
  assert.equal((await get("chamados_ti", alta.id)).atribuidoUid, U[outro].uid);
  falha(await chamar("POST", `/ti/chamados/${alta.id}/atribuir`, { token: "gest", body: { operadorUid: "fantasma" } }), 404, "nao-encontrado");
});
t("ciclo completo + métricas: TMA/TMR corretos, tempo 'aguardando usuário' não conta, SLA, linha do tempo, notas internas ocultas ao usuário", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico");
  const c = await novoChamado("lojaA", { urgencia: "alta" });             // SLA alta: 1 h para atender, 8 h para resolver
  E.avancar(10 * MIN); ok(await chamar("POST", `/ti/chamados/${c.id}/assumir`, { token: "tec1" }));                    // TMA = 10 min
  ok(await chamar("POST", `/ti/chamados/${c.id}/comentarios`, { token: "tec1", body: { texto: "Suspeita: webhook atrasado (interno)", interno: true } }));
  ok(await chamar("POST", `/ti/chamados/${c.id}/comentarios`, { token: "tec1", body: { texto: "Pode me enviar o comprovante?", interno: false } }));
  ok(await chamar("POST", `/ti/chamados/${c.id}/status`, { token: "tec1", body: { status: "aguardando_usuario", nota: "Aguardando comprovante" } }));
  E.avancar(120 * MIN);                                                                                                 // 2 h esperando o usuário
  const r = await chamar("POST", `/chamados/${c.id}/responder`, { token: "lojaA", body: { texto: "Segue o comprovante." } }); ok(r); assert.equal(r.json.status, "em_atendimento");
  E.avancar(20 * MIN);
  falha(await chamar("POST", `/ti/chamados/${c.id}/status`, { token: "tec1", body: { status: "resolvido" } }), 400, "dados-invalidos");     // resolver exige nota
  ok(await chamar("POST", `/ti/chamados/${c.id}/status`, { token: "tec1", body: { status: "resolvido", nota: "Webhook reprocessado; pedido liberado." } }));
  const t1 = await get("chamados_ti", c.id); assert.equal(t1.status, "resolvido"); assert.equal(t1.tempoAtendSeg, 600);
  assert.equal(t1.tempoResolSeg, (10 + 120 + 20) * 60 - 120 * 60, "resolução líquida = total − tempo aguardando usuário"); assert.equal(t1.pausadoSeg, 7200);
  falha(await chamar("POST", `/ti/chamados/${c.id}/status`, { token: "tec1", body: { status: "aguardando_usuario" } }), 409, "transicao-invalida");
  falha(await chamar("POST", `/chamados/${c.id}/responder`, { token: "lojaA", body: { texto: "mais uma" } }), 409, "estado-invalido");
  const vis = await chamar("GET", `/chamados/${c.id}`, { token: "lojaA" }); ok(vis);
  assert.ok(!JSON.stringify(vis.json).includes("interno"), "nota interna não chega ao usuário"); assert.ok(vis.json.eventos.some((e) => e.texto === "Pode me enviar o comprovante?")); assert.equal(vis.json.resolucao, "Webhook reprocessado; pedido liberado.");
  assert.ok(!("atribuidoUid" in vis.json) && !("slaAtendEm" in vis.json), "usuário não vê dados internos");
  const full = await chamar("GET", `/ti/chamados/${c.id}`, { token: "gest" }); assert.ok(full.json.eventos.some((e) => e.interno && /webhook atrasado/.test(e.texto)));
  assert.deepEqual(full.json.eventos.map((e) => e.tipo), ["criado", "assumido", "comentario", "comentario", "status", "comentario", "status"]);
  const d = await chamar("GET", "/ti/dashboard?dias=7", { token: "gest" }); ok(d);
  assert.equal(d.json.periodo.criados, 1); assert.equal(d.json.periodo.resolvidos, 1); assert.equal(d.json.periodo.tmaSeg, 600); assert.equal(d.json.periodo.tmrSeg, 1800);
  assert.equal(d.json.periodo.slaAtendimentoPct, 100); assert.equal(d.json.periodo.slaResolucaoPct, 100);
  assert.deepEqual(d.json.ranking.map((r) => [r.nome, r.resolvidos, r.assumidos, r.tmaSeg]), [["Ana Técnica", 1, 1, 600]]);
  assert.equal(d.json.fila.totalAbertos, 0);
});
t("SLA estourado aparece como fora do prazo; reabrir um resolvido reinicia a resolução e conta a reabertura", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico");
  const c = await novoChamado("lojaA", { urgencia: "alta" });
  E.avancar(61 * MIN);
  let d = await chamar("GET", "/ti/dashboard", { token: "gest" }); assert.equal(d.json.fila.aberto, 1); assert.equal(d.json.fila.foraDoPrazo, 1, "sem atendimento além de 1 h");
  ok(await chamar("POST", `/ti/chamados/${c.id}/assumir`, { token: "tec1" }));
  ok(await chamar("POST", `/ti/chamados/${c.id}/status`, { token: "tec1", body: { status: "resolvido", nota: "Resolvido com atraso." } }));
  d = await chamar("GET", "/ti/dashboard", { token: "gest" }); assert.equal(d.json.periodo.slaAtendimentoPct, 0, "atendeu depois do prazo");
  ok(await chamar("POST", `/ti/chamados/${c.id}/status`, { token: "tec1", body: { status: "em_atendimento", nota: "Voltou a falhar" } }));
  const x = await get("chamados_ti", c.id); assert.equal(x.reaberturas, 1); assert.equal(x.status, "em_atendimento"); assert.equal(x.resolvidoMs, null);
  ok(await chamar("PUT", `/ti/chamados/${c.id}/prioridade`, { token: "tec1", body: { prioridade: "critica" } }));
  assert.equal((await get("chamados_ti", c.id)).prioridade, "critica"); falha(await chamar("PUT", `/ti/chamados/${c.id}/prioridade`, { token: "tec1", body: { prioridade: "critica" } }), 409, "sem-mudanca");
});
t("ranking: ordena por resolvidos (depois assumidos); período filtra; ignora dias fora da janela", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico"); await operador("tec2", "tecnico");
  const fechar = async (tok, n) => { for (let i = 0; i < n; i++) { const c = await novoChamado(i % 2 ? "lojaA" : "lojaB", { titulo: `Chamado ${tok} ${i}`.padEnd(8, "x") }); E.avancar(MIN); ok(await chamar("POST", `/ti/chamados/${c.id}/assumir`, { token: tok })); E.avancar(MIN); ok(await chamar("POST", `/ti/chamados/${c.id}/status`, { token: tok, body: { status: "resolvido", nota: "Feito e conferido." } })); } };
  ctx.__reset(); await fechar("tec2", 2); ctx.__reset(); await fechar("tec1", 3);
  ctx.__reset(); const c = await novoChamado("lojaA"); ok(await chamar("POST", `/ti/chamados/${c.id}/assumir`, { token: "tec2" }));    // tec2: +1 assumido (não resolvido)
  const d = await chamar("GET", "/ti/dashboard?dias=7", { token: "gest" }); ok(d);
  assert.deepEqual(d.json.ranking.map((r) => [r.posicao, r.nome, r.resolvidos, r.assumidos]), [[1, "Ana Técnica", 3, 3], [2, "Bruno Técnico", 2, 3]]);
  assert.equal(d.json.periodo.serie.length, 7); assert.equal(d.json.periodo.resolvidos, 5);
  E.avancar(10 * 86_400_000); ctx.__reset();
  assert.equal((await chamar("GET", "/ti/dashboard?dias=7", { token: "gest" })).json.ranking.length, 0, "tudo ficou fora dos 7 dias");
  assert.equal((await chamar("GET", "/ti/dashboard?dias=30", { token: "gest" })).json.ranking.length, 2);
  assert.equal((await chamar("GET", "/ti/dashboard?dias=999", { token: "gest" })).json.periodo.dias, 7, "período inválido cai no padrão");
});
t("chamado aberto por operador em nome de alguém; transições inválidas e cancelamento; paginação dos resolvidos", async () => {
  await operador("gest", "gestor"); await operador("tec1", "tecnico");
  const r = await chamar("POST", "/ti/chamados", { token: "tec1", body: { titulo: "Impressora da loja X", descricao: "Cliente ligou: não imprime nota.", categoria: "infra", prioridade: "critica", solicitanteNome: "Dona Maria (telefone)" } }); ok(r);
  assert.equal(r.json.origem, "ti"); assert.equal(r.json.solicitante.tipo, "externo");
  falha(await chamar("POST", "/ti/chamados", { token: "tec1", body: { titulo: "Sem solicitante", descricao: "faltou informar quem pediu" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/ti/chamados", { token: "tec1", body: { titulo: "Usuário fantasma", descricao: "uid inexistente", solicitanteNome: "Xavier", solicitanteUid: "ninguem" } }), 404, "nao-encontrado");
  falha(await chamar("POST", `/ti/chamados/${r.json.id}/status`, { token: "tec1", body: { status: "resolvido", nota: "pulou etapas" } }), 409);
  ok(await chamar("POST", `/ti/chamados/${r.json.id}/status`, { token: "gest", body: { status: "cancelado", nota: "Duplicado do TI-000009" } }));
  falha(await chamar("POST", `/ti/chamados/${r.json.id}/assumir`, { token: "tec1" }), 409);
  falha(await chamar("GET", "/ti/chamados/a..b", { token: "tec1" }), 400, "dados-invalidos");
  falha(await chamar("GET", "/ti/chamados?visao=tudo", { token: "tec1" }), 400, "dados-invalidos");
  for (let i = 0; i < 3; i++) { const c = await novoChamado(); E.avancar(MIN); ok(await chamar("POST", `/ti/chamados/${c.id}/assumir`, { token: "tec1" })); E.avancar(MIN); ok(await chamar("POST", `/ti/chamados/${c.id}/status`, { token: "tec1", body: { status: "resolvido", nota: "Ok conferido" } })); }
  const p1 = await chamar("GET", "/ti/chamados?visao=resolvidos&limite=2", { token: "tec1" }); ok(p1); assert.equal(p1.json.itens.length, 2); assert.ok(p1.json.proximo);
  const p2 = await chamar("GET", `/ti/chamados?visao=resolvidos&limite=2&cursor=${p1.json.proximo}`, { token: "tec1" }); assert.equal(p2.json.itens.length, 1); assert.equal(p2.json.proximo, null);
});

// ======================= presença / tempo real =======================
t("presença: conta quem pingou nos últimos 75 s, separa por tipo, expira, ignora ping rápido e sem papel; 1 usuário = 1", async () => {
  await operador("gest", "gestor");
  for (const tk of ["lojaA", "lojaB", "prom1", "adm", "gest"]) ok(await chamar("POST", "/presenca/ping", { token: tk }));
  assert.equal((await chamar("POST", "/presenca/ping", { token: "semPapel" })).json.contado, false);
  assert.equal((await chamar("POST", "/presenca/ping", { token: "lojaA" })).json.contado, false, "ping em < 10 s é ignorado");
  falha(await chamar("POST", "/presenca/ping", {}), 401);
  let d = (await chamar("GET", "/ti/dashboard", { token: "gest" })).json.online; assert.deepEqual([d.total, d.lojas, d.promotores, d.admins, d.ti], [5, 2, 1, 1, 1]);
  E.avancar(40_000); ok(await chamar("POST", "/presenca/ping", { token: "lojaA" })); ti.presenca.limparCache();
  E.avancar(40_000); ti.presenca.limparCache();                                          // 80 s desde o ping dos outros; lojaA pingou há 40 s
  d = (await chamar("GET", "/ti/dashboard", { token: "gest" })).json.online; assert.deepEqual([d.total, d.lojas], [1, 1], "só quem pingou há < 75 s");
  E.avancar(80_000); ti.presenca.limparCache(); assert.equal((await chamar("GET", "/ti/dashboard", { token: "gest" })).json.online.total, 0);
});
t("presença com várias instâncias: união dos ids publicados (sem contar duas vezes o mesmo usuário) e limpeza de instâncias antigas", async () => {
  await operador("gest", "gestor");
  ok(await chamar("POST", "/presenca/ping", { token: "lojaA" }));
  const hash = (uid) => crypto.createHash("sha256").update(uid).digest("base64url").slice(0, 10);
  await set("presenca_instancias", "outra", { instancia: "outra", emMs: Date.now(), ids: ["l" + hash("lojaA"), "l" + hash("lojaZ"), "p" + hash("promQ")] });     // lojaA repetida
  await set("presenca_instancias", "morta", { instancia: "morta", emMs: Date.now() - 11 * MIN, ids: ["lxxxxxxxxxx"] });
  ti.presenca.limparCache(); const d = (await chamar("GET", "/ti/dashboard", { token: "gest" })).json.online;
  assert.deepEqual([d.total, d.lojas, d.promotores], [3, 2, 1]); assert.equal(E.store.has("presenca_instancias/morta"), false, "instância morta removida");
  await ti.presenca.publicar(); assert.ok(E.store.get(`presenca_instancias/${ti.presenca._instancia}`).ids.length >= 1);
});
t("tempo real (SSE): retrato com online+fila; limite de streams por operador; encerrarDe derruba", async () => {
  await operador("gest", "gestor"); ok(await chamar("POST", "/presenca/ping", { token: "lojaA" })); await novoChamado();
  const r = await ti.tempoReal.retrato(); assert.equal(r.online.total >= 1, true); assert.equal(r.fila.aberto, 1);
  const escritas = []; const mk = () => ({ status() { return this; }, setHeader() {}, flushHeaders() {}, write: (s) => escritas.push(s), end() { this.fechado = true; } });
  const req = { usuario: { uid: "ti-gest" }, on() {} }, resp = [mk(), mk(), mk(), mk()];
  for (let i = 0; i < 3; i++) await ti.tempoReal.assinar(req, resp[i]);
  await assert.rejects(() => ti.tempoReal.assinar(req, resp[3]), (e) => e.status === 429);
  assert.ok(escritas.some((s) => s.startsWith("event: tick") && s.includes('"aberto":1')));
  ti.tempoReal.encerrarDe("ti-gest"); assert.ok(resp.slice(0, 3).every((x) => x.fechado)); assert.equal(ti.tempoReal._assinantes.size, 0);
});
t("sessão: login é auditado uma única vez por autenticação; logout também; config para a tela", async () => {
  await operador("gest", "gestor");
  const s = await chamar("POST", "/ti/sessao", { token: "gest" }); ok(s); assert.ok(s.json.permissoes.includes("operadores.gerir")); assert.deepEqual(s.json.config.prioridades, ["baixa", "media", "alta", "critica"]);
  ok(await chamar("POST", "/ti/sessao", { token: "gest" })); ok(await chamar("POST", "/ti/sessao/sair", { token: "gest" }));
  const acoes = (await todos("ti_auditoria")).map((a) => a.acao); assert.equal(acoes.filter((a) => a === "sessao.login").length, 1); assert.equal(acoes.filter((a) => a === "sessao.logout").length, 1);
  assert.ok((await get("ti_operadores", "ti-gest")).ultimoLoginEm);
});
t("segurança: cabeçalho de token inválido, injeção NoSQL em filtros e IDs maliciosos são recusados", async () => {
  await operador("gest", "gestor");
  falha(await chamar("GET", "/ti/auditoria", { token: "gest", query: { operador: { $ne: "x" } } }), 400, "dados-invalidos");
  falha(await chamar("GET", "/ti/auditoria?acao=a%20OR%201=1", { token: "gest" }), 400, "dados-invalidos");
  falha(await chamar("PUT", "/ti/operadores/a..b/nivel", { token: "gest", body: { nivel: "gestor" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/ti/operadores/ti-gest/excluir", { token: "ruim.ruim.ruim", body: {} }), 401);
});


// ======================= admin gerencia a equipe de TI (/admin/ti/*) =======================
const { criarBootstrapAdmin } = require("../server/lib/bootstrap-admin");
const darToken = (chave, op) => { E.tokens[chave] = { uid: op.uid, email: op.email, email_verified: true }; };

t("admin: só o papel admin gerencia a equipe de TI (loja, promotor, operador de TI e sem papel são barrados)", async () => {
  await operador("gest", "gestor");
  for (const tk of ["lojaA", "prom1", "semPapel", "gest"]) falha(await chamar("GET", "/admin/ti/operadores", { token: tk }), 403, "sem-permissao");
  falha(await chamar("GET", "/admin/ti/operadores", {}), 401, "nao-autenticado");
  ok(await chamar("GET", "/admin/ti/operadores", { token: "adm" }));
});
t("admin: cadastra operador com senha própria (troca no 1º acesso), com senha temporária e só-Google; valida, recusa duplicado e exige login recente", async () => {
  const corpo = { nome: "Carla Souza", email: "carla@abastece.ti", nivel: "tecnico", acesso: "senha", senha: SENHA, exigirTroca: true };
  E.tokens.velho = { ...U.adm, auth_time: Math.floor(Date.now() / 1000) - 3600 };
  falha(await chamar("POST", "/admin/ti/operadores", { token: "velho", body: corpo }), 401, "reautenticar");
  falha(await chamar("POST", "/admin/ti/operadores", { token: "adm", body: { ...corpo, senha: "curta" } }), 400);
  falha(await chamar("POST", "/admin/ti/operadores", { token: "adm", body: { ...corpo, nivel: "dono" } }), 400);
  falha(await chamar("POST", "/admin/ti/operadores", { token: "adm", body: { ...corpo, acesso: "sms" } }), 400);
  const a = await chamar("POST", "/admin/ti/operadores", { token: "adm", body: corpo }); ok(a, "com senha");
  assert.equal(a.json.senhaTemporaria, undefined, "a senha que o admin digitou não volta na resposta");
  assert.deepEqual(E.claimsStore[a.json.operador.uid], { role: "ti", perfis: ["ti"], tiNivel: "tecnico" });
  const da = await get("ti_operadores", a.json.operador.uid); assert.equal(da.trocarSenha, true); assert.equal(da.acesso, "senha"); assert.equal(da.status, "ativo");
  falha(await chamar("POST", "/admin/ti/operadores", { token: "adm", body: corpo }), 409, "email-em-uso");
  const b = await chamar("POST", "/admin/ti/operadores", { token: "adm", body: { nome: "Davi Lima", email: "davi@abastece.ti", nivel: "gestor" } }); ok(b, "temporária");
  assert.ok(b.json.senhaTemporaria && b.json.senhaTemporaria.length >= 12); assert.equal((await get("ti_operadores", b.json.operador.uid)).trocarSenha, true);
  const g = await chamar("POST", "/admin/ti/operadores", { token: "adm", body: { nome: "Elisa Ramos", email: "elisa@gmail.com", nivel: "tecnico", acesso: "google" } }); ok(g, "google");
  assert.equal(g.json.senhaTemporaria, undefined); const dg = await get("ti_operadores", g.json.operador.uid); assert.equal(dg.acesso, "google"); assert.equal(dg.trocarSenha, false);
  const lista = await chamar("GET", "/admin/ti/operadores", { token: "adm" }); ok(lista); assert.equal(lista.json.length, 3);
  // quem foi cadastrado entra no painel de TI (o login Google casa pelo e-mail → mesmo uid → mesma claim)
  darToken("elisa", g.json.operador); const ses = await chamar("POST", "/ti/sessao", { token: "elisa", body: {} }); ok(ses, "sessão do só-Google");
  assert.equal(ses.json.operador.trocarSenha, false); assert.equal(ses.json.operador.acesso, "google");
  darToken("carla", a.json.operador); falha(await chamar("GET", "/ti/dashboard", { token: "carla" }), 403, "trocar-senha");   // senha definida pelo admin: troca obrigatória
});
t("admin: altera nível, redefine senha, remove e libera de volta; removido perde o acesso na hora; o admin pode remover o último gestor", async () => {
  const c = await chamar("POST", "/admin/ti/operadores", { token: "adm", body: { nome: "Gil Gestor", email: "gil@abastece.ti", nivel: "gestor", acesso: "google" } }); ok(c);
  const uid = c.json.operador.uid; darToken("gil", c.json.operador);
  ok(await chamar("GET", "/ti/dashboard", { token: "gil" }));
  ok(await chamar("PUT", `/admin/ti/operadores/${uid}/nivel`, { token: "adm", body: { nivel: "tecnico" } })); assert.equal(E.claimsStore[uid].tiNivel, "tecnico");
  falha(await chamar("PUT", `/admin/ti/operadores/${uid}/nivel`, { token: "adm", body: { nivel: "chefe" } }), 400);
  ok(await chamar("PUT", `/admin/ti/operadores/${uid}/nivel`, { token: "adm", body: { nivel: "gestor" } }));
  // senha: informada pelo admin → troca obrigatória; sem corpo → temporária devolvida uma vez; fraca → 400
  falha(await chamar("POST", `/admin/ti/operadores/${uid}/senha`, { token: "adm", body: { senha: "fraca" } }), 400);
  const r1 = await chamar("POST", `/admin/ti/operadores/${uid}/senha`, { token: "adm", body: { senha: SENHA, motivo: "Esqueceu a senha" } }); ok(r1); assert.equal(r1.json.senhaTemporaria, undefined);
  const dop = await get("ti_operadores", uid); assert.equal(dop.trocarSenha, true); assert.equal(dop.acesso, "senha");
  const r2 = await chamar("POST", `/admin/ti/operadores/${uid}/senha`, { token: "adm", body: { motivo: "Esqueceu a senha" } }); ok(r2); assert.ok(r2.json.senhaTemporaria);
  // remover exige motivo; é o ÚNICO gestor e mesmo assim o admin consegue (a trava de "último gestor" é do TI, não do admin)
  falha(await chamar("POST", `/admin/ti/operadores/${uid}/excluir`, { token: "adm", body: { motivo: "x" } }), 400);
  const ex = await chamar("POST", `/admin/ti/operadores/${uid}/excluir`, { token: "adm", body: { motivo: "Saiu da empresa" } }); ok(ex, "remover");
  assert.equal((await get("ti_operadores", uid)).status, "excluido"); assert.equal(E.contas.get(uid).disabled, true);
  falha(await chamar("GET", "/ti/dashboard", { token: "gil" }), 401);   // login desativado/sessão revogada: o token antigo não vale mais
  const lx = await chamar("GET", "/admin/ti/operadores?status=excluido", { token: "adm" }); ok(lx); assert.equal(lx.json.length, 1); assert.equal(lx.json[0].motivoExclusao, "Saiu da empresa");
  falha(await chamar("POST", `/admin/ti/operadores/${uid}/excluir`, { token: "adm", body: { motivo: "de novo, sem efeito" } }), 409, "operador-excluido");
  // liberar de volta: só-Google restaura sem senha; quem tinha senha ganha temporária
  const rs = await chamar("POST", `/admin/ti/operadores/${uid}/restaurar`, { token: "adm", body: {} }); ok(rs, "restaurar");
  assert.equal((await get("ti_operadores", uid)).status, "ativo"); assert.equal(E.contas.get(uid).disabled, false);
  falha(await chamar("POST", `/admin/ti/operadores/${uid}/restaurar`, { token: "adm", body: {} }), 409, "nao-excluido");
  falha(await chamar("POST", "/admin/ti/operadores/nao-existe/excluir", { token: "adm", body: { motivo: "teste de motivo" } }), 404);
  falha(await chamar("POST", `/admin/ti/operadores/a..b/excluir`, { token: "adm", body: { motivo: "teste de motivo" } }), 400, "dados-invalidos");
});
t("admin: tudo fica nos DOIS logs (auditoria do admin e trilha de TI, com a cadeia íntegra) e sem segredos", async () => {
  await operador("gest", "gestor");
  const c = await chamar("POST", "/admin/ti/operadores", { token: "adm", body: { nome: "Hugo Reis", email: "hugo@abastece.ti", nivel: "tecnico", senha: SENHA } }); ok(c);
  ok(await chamar("POST", `/admin/ti/operadores/${c.json.operador.uid}/excluir`, { token: "adm", body: { motivo: "Fim do contrato" } }));
  const trilha = await todos("ti_auditoria"), meu = trilha.filter((a) => a.nivel === "admin");
  assert.deepEqual(meu.map((a) => a.acao).sort(), ["operador.criar", "operador.excluir"]);
  assert.ok(meu.every((a) => a.operadorUid === "adm1" && a.resumo.startsWith("[Admin]") && a.meta.origem === "painel-admin"));
  assert.ok(!JSON.stringify(trilha).includes(SENHA), "a senha nunca vai para a trilha");
  const logAdmin = await todos("auditoria"); assert.ok(logAdmin.some((a) => a.acao === "admin.ti.criar") && logAdmin.some((a) => a.acao === "admin.ti.excluir"));
  assert.ok(!JSON.stringify(logAdmin).includes(SENHA), "nem no log do admin");
  const v = await chamar("GET", "/ti/auditoria/verificar", { token: "gest" }); ok(v); assert.deepEqual(v.json.problemas, [], JSON.stringify(v.json)); assert.ok(v.json.verificados >= 2);
});
t("bootstrap do admin: ADMIN_BOOTSTRAP_EMAIL concede o papel sem terminal; idempotente; não converte conta de TI; e-mail inexistente só avisa", async () => {
  const bs = criarBootstrapAdmin({ admin: ctx.admin, db: ctx.db, FieldValue: ctx.FieldValue, auth: ctx.auth });
  falha(await chamar("GET", "/admin/ti/operadores", { token: "semPapel" }), 403, "sem-permissao");
  assert.deepEqual(await bs.rodar({}), []);
  const [r] = await bs.rodar({ ADMIN_BOOTSTRAP_EMAIL: " S@x.com " }); assert.equal(r.feito, true);
  assert.equal(E.claimsStore.sem.admin, true); assert.equal(E.claimsStore.sem.role, "admin"); assert.ok(E.claimsStore.sem.perfis.includes("admin"));
  assert.equal((await get("usuarios", "sem")).admin, true);
  ok(await chamar("GET", "/admin/ti/operadores", { token: "semPapel" }), "depois do bootstrap");
  assert.equal((await bs.rodar({ ADMIN_BOOTSTRAP_EMAIL: "s@x.com" }))[0].motivo, "ja-e-admin");
  assert.equal((await bs.rodar({ ADMIN_BOOTSTRAP_EMAIL: "ninguem@x.com" }))[0].motivo, "conta-inexistente");
  await operador("tec1", "tecnico"); const [t1] = await bs.rodar({ ADMIN_BOOTSTRAP_EMAIL: "ana@abastece.ti" }); assert.equal(t1.motivo, "conta-ti");
  assert.equal(E.claimsStore["ti-tec1"].role, "ti");
  const dois = await bs.rodar({ ADMIN_BOOTSTRAP_EMAIL: "a@x.com, b@x.com;a@x.com" }); assert.equal(dois.length, 2);   // vários e-mails, sem repetir
});

t("bootstrap: cria o 1º gestor por variáveis de ambiente, com troca de senha obrigatória, e não age de novo", async () => {
  const env = { TI_BOOTSTRAP_EMAIL: "Chefe+ti@Exemplo.com", TI_BOOTSTRAP_NOME: "Chefe", TI_BOOTSTRAP_SENHA: "Cavalo-Bateria-Grampo-42" };
  assert.equal((await ti.bootstrapGestor({})).motivo, "nao-configurado");
  const r = await ti.bootstrapGestor(env); assert.equal(r.feito, true);
  const op = await get("ti_operadores", r.uid);
  assert.equal(op.nivel, "gestor"); assert.equal(op.status, "ativo"); assert.equal(op.trocarSenha, true); assert.equal(op.email, "chefe+ti@exemplo.com");
  assert.ok((await todos("ti_auditoria")).some((a) => a.acao === "operador.criar"));
  assert.equal((await ti.bootstrapGestor(env)).motivo, "ja-existem-operadores");      // idempotente
});
t("bootstrap: senha fraca é recusada e nada é criado", async () => {
  const r = await ti.bootstrapGestor({ TI_BOOTSTRAP_EMAIL: "x@exemplo.com", TI_BOOTSTRAP_SENHA: "curta" });
  assert.equal(r.feito, false); assert.equal((await todos("ti_operadores")).length, 0);
});

// ======================= chamado automático (erro capturado no app) =======================
t("chamado automático: abre com protocolo sequencial, categoria bug e origem 'automatico'; mesmo erro do mesmo usuário reaproveita o protocolo", async () => {
  const corpo = { impressao: "a1b2c3d4e5f60718", titulo: "Erro automático: TypeError", descricao: "TypeError: x is not a function\nTela: screen-main" };
  const a = await chamar("POST", "/chamados/automatico", { token: "lojaA", body: corpo }); ok(a, "abrir automático");
  assert.match(a.json.protocolo, /^TI-\d{6}$/); assert.equal(a.json.repetido, false);
  const d = await get("chamados_ti", a.json.id);
  assert.equal(d.categoria, "bug"); assert.equal(d.origem, "automatico"); assert.equal(d.solicitanteUid, "lojaA"); assert.equal(d.prioridade, "media");
  const b = await chamar("POST", "/chamados/automatico", { token: "lojaA", body: corpo }); ok(b);
  assert.equal(b.json.protocolo, a.json.protocolo); assert.equal(b.json.repetido, true);
  assert.equal((await todos("chamados_ti")).length, 1);                                     // nada duplicado na fila
  const c = await chamar("POST", "/chamados/automatico", { token: "lojaA", body: { ...corpo, impressao: "ffffeeeeddddcccc" } }); ok(c);
  assert.notEqual(c.json.protocolo, a.json.protocolo); assert.equal(c.json.repetido, false);   // outro erro → outro protocolo (sequencial)
  const e = await chamar("POST", "/chamados/automatico", { token: "lojaB", body: corpo }); ok(e);
  assert.notEqual(e.json.protocolo, a.json.protocolo);                                       // dedupe é por usuário: lojaB não herda o chamado da lojaA
  E.avancar(61 * MIN);
  const f = await chamar("POST", "/chamados/automatico", { token: "lojaA", body: corpo }); ok(f);
  assert.equal(f.json.repetido, false); assert.notEqual(f.json.protocolo, a.json.protocolo);  // passada a janela de 1 h, um novo chamado
});
t("chamado automático: exige login, valida a impressão, corta relatório gigante (nunca 400 por tamanho) e aparece em /chamados/meus", async () => {
  falha(await chamar("POST", "/chamados/automatico", { body: { impressao: "abcdef123456", titulo: "Erro", descricao: "descrição qualquer" } }), 401);
  falha(await chamar("POST", "/chamados/automatico", { token: "semPapel", body: { impressao: "abcdef123456", titulo: "Erro automático", descricao: "descrição qualquer" } }), 403);
  falha(await chamar("POST", "/chamados/automatico", { token: "lojaA", body: { impressao: "../../etc", titulo: "Erro automático", descricao: "descrição qualquer" } }), 400, "dados-invalidos");
  falha(await chamar("POST", "/chamados/automatico", { token: "lojaA", body: { impressao: { $gt: "" }, titulo: "Erro automático", descricao: "descrição qualquer" } }), 400, "dados-invalidos");
  const r = await chamar("POST", "/chamados/automatico", { token: "prom1", body: { impressao: "abcdef123456", titulo: "x".repeat(500), descricao: "y".repeat(9000) } }); ok(r, "relatório gigante");
  const d = await get("chamados_ti", r.json.id); assert.equal(d.titulo.length, 120); assert.equal(d.descricao.length, 2000);
  assert.equal((await chamar("GET", "/chamados/meus", { token: "prom1" })).json[0].protocolo, r.json.protocolo);
});

// ======================= [AUTO-BUG]: contexto estruturado, classificação, alcance e saúde =======================
const auto = (token, impressao, extra = {}, ctxo = {}) => chamar("POST", "/chamados/automatico", { token, body: { impressao, titulo: "TypeError: x is not a function", descricao: "TypeError: x is not a function\n\nStack:\nat a (s.js:1:1)", contexto: { nome: "TypeError", mensagem: "x is not a function", origem: "window.onerror", rota: "/painel-loja", perfil: "loja", ...ctxo }, ...extra } });
const novoUsuario = (uid, role = "loja") => { E.tokens[uid] = { uid, email: `${uid}@x.com`, email_verified: true }; E.claimsStore[uid] = { role }; };

t("auto-bug: título [AUTO-BUG], contexto estruturado gravado (rota, versão, dispositivo, stack) e usuário vindo do TOKEN, nunca do corpo", async () => {
  const r = await auto("lojaA", "aaaa1111bbbb2222", {}, { rota: "/painel-loja?token=segredo#x", versao: "abastece-v15", tela: "screen-main", viewport: "390x844", online: true, usuario: { uid: "OUTRA", tipo: "admin" }, uid: "OUTRA",
    mensagem: "falhou para joao@x.com", navegador: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36", stack: "TypeError: x\n    at abrir (s.js:10:5)\n    at b (s.js:99:1)" }); ok(r);
  const d = await get("chamados_ti", r.json.id);
  assert.ok(d.titulo.startsWith("[AUTO-BUG] ")); assert.equal(d.bug.rota, "/painel-loja"); assert.equal(d.bug.versao, "abastece-v15"); assert.deepEqual(d.bug.usuario, { uid: "lojaA", tipo: "loja" });
  assert.deepEqual(d.bug.dispositivo, { tipo: "celular", so: "Android 14", navegador: "Chrome 126" }); assert.equal(d.bug.stack.split("\n").length, 3);
  const bruto = JSON.stringify(d); for (const proibido of ["segredo", "joao@x.com", "OUTRA"]) assert.ok(!bruto.includes(proibido), `vazou: ${proibido}`);
  assert.equal(d.prioridade, "media"); assert.equal(d.slaAtendMs - d.criadoMs, 240 * MIN, "SLA de média: 1º atendimento em 4 h"); assert.equal(d.bug.afetados, 1);
  const rep = await auto("lojaA", "aaaa1111bbbb2222"); assert.equal(rep.json.protocolo, r.json.protocolo); assert.equal(rep.json.repetido, true);
});
t("auto-bug: classificação automática define a prioridade E o SLA — pagamento = crítica (15 min), falha tratada = baixa (24 h)", async () => {
  const c = await auto("lojaA", "cccc1111dddd2222", {}, { rota: "/pagar.html" }); assert.equal(c.json.prioridade, "critica");
  const dc = await get("chamados_ti", c.json.id); assert.equal(dc.slaAtendMs - dc.criadoMs, 15 * MIN); assert.equal(dc.slaResolMs - dc.criadoMs, 240 * MIN); assert.match(dc.bug.classificacao.motivos[0], /financeiro/);
  const b = await auto("lojaA", "eeee1111ffff2222", {}, { origem: "manual" }); assert.equal(b.json.prioridade, "baixa");
  const db_ = await get("chamados_ti", b.json.id); assert.equal(db_.slaAtendMs - db_.criadoMs, 1440 * MIN);
});
t("auto-bug: o MESMO erro em 5 usuários vira incidente — os chamados abertos sobem para crítica (com registro na linha do tempo) e o SLA é recalculado", async () => {
  await operador("gest", "gestor"); const us = ["lojaA", "lojaB", "lojaC", "lojaD", "lojaE", "lojaF"]; for (const u of us.slice(2)) novoUsuario(u);
  const ids = []; for (const u of us.slice(0, 4)) { const r = await auto(u, "inc01inc01inc01aa"); ok(r); assert.equal(r.json.prioridade, "media"); ids.push(r.json.id); }
  const quinta = await auto("lojaE", "inc01inc01inc01aa"); assert.equal(quinta.json.prioridade, "critica", "o 5º já nasce crítico");
  for (const id of [...ids, quinta.json.id]) { const d = await get("chamados_ti", id); assert.equal(d.prioridade, "critica", id); assert.equal(d.slaAtendMs - d.criadoMs, 15 * MIN); }
  const det = await chamar("GET", `/ti/chamados/${ids[0]}`, { token: "gest" }); ok(det);
  assert.ok(det.json.eventos.some((e) => e.tipo === "prioridade" && /Escalonado automaticamente: atinge 5 usuários/.test(e.texto)), "motivo na linha do tempo");
  const sexta = await auto("lojaF", "inc01inc01inc01aa"); assert.equal(sexta.json.prioridade, "critica");
  assert.equal((await get("bug_impressoes", "inc01inc01inc01aa")).afetados, 6);
  E.avancar(61 * MIN); const nova = await auto("lojaA", "inc01inc01inc01aa"); assert.equal(nova.json.prioridade, "media", "passada a janela de 1 h, a contagem recomeça");
});
t("auto-bug: um único usuário repetindo o mesmo erro 20× também escala (mesmo protocolo, sem inundar a fila)", async () => {
  let ultimo; for (let i = 0; i < 20; i++) { ultimo = await auto("lojaA", "loop0loop0loop0aa"); ok(ultimo); }
  assert.equal((await todos("chamados_ti")).length, 1); const d = await get("chamados_ti", ultimo.json.id); assert.equal(d.prioridade, "critica");
});
t("auto-bug: contexto hostil nunca vira 400 (o erro já aconteceu) e fica dentro dos limites", async () => {
  for (const [i, lixo] of [null, "texto", 42, [1], { rota: { a: 1 }, stack: 9, origem: "evil", mensagem: "m".repeat(9000), navegador: "n".repeat(9000) }].entries()) {
    const r = await chamar("POST", "/chamados/automatico", { token: "lojaA", body: { impressao: `hostil${i}hostil${i}`, titulo: "Erro", descricao: "descrição qualquer", contexto: lixo } }); ok(r, `contexto ${i}`);
    const d = await get("chamados_ti", r.json.id); assert.ok(d.bug.mensagem.length <= 300 && d.bug.navegador.length <= 160); assert.equal(d.bug.usuario.uid, "lojaA");
  }
});
t("fila da equipe: filtra por origem automática e expõe o contexto só para a TI (o solicitante não recebe o campo bug)", async () => {
  await operador("tec1", "tecnico"); const a = await auto("lojaA", "visao1visao1visao"); const m = await novoChamado("lojaB");
  const lista = await chamar("GET", "/ti/chamados?origem=automatico", { token: "tec1" }); ok(lista); assert.deepEqual(lista.json.itens.map((x) => x.id), [a.json.id]);
  falha(await chamar("GET", "/ti/chamados?origem=hack", { token: "tec1" }), 400, "dados-invalidos");
  assert.equal(lista.json.itens[0].bug.rota, "/painel-loja"); assert.equal(lista.json.itens[0].origem, "automatico");
  const meu = await chamar("GET", `/chamados/${a.json.id}`, { token: "lojaA" }); ok(meu); assert.ok(!("bug" in meu.json)); assert.ok(!("bug" in (await chamar("GET", "/chamados/meus", { token: "lojaA" })).json[0]));
  assert.ok(m.id);
});
t("saúde (rota): só a equipe de TI; mede na 1ª vez, usa cache, 'forcar' respeita 10 s; dashboard traz o cache sem disparar medição", async () => {
  await operador("tec1", "tecnico"); let n = 0;
  ti.saude.definirSondas({ svc: { nome: "Serviço X", tipo: "externo", fn: async () => { n++; return { detalhe: "ok" }; } } });
  falha(await chamar("GET", "/ti/saude", { token: "lojaA" }), 403, "sem-permissao"); falha(await chamar("GET", "/ti/saude", {}), 401);
  const dash0 = await chamar("GET", "/ti/dashboard", { token: "tec1" }); ok(dash0); assert.equal(n, 0, "dashboard não dispara medição"); assert.equal(dash0.json.saude.geral, "desconhecido");
  const r = await chamar("GET", "/ti/saude", { token: "tec1" }); ok(r); assert.equal(n, 1); assert.equal(r.json.geral, "ok"); assert.equal(r.json.servicos[0].nome, "Serviço X");
  await chamar("GET", "/ti/saude?forcar=1", { token: "tec1" }); assert.equal(n, 1); E.avancar(11_000); await chamar("GET", "/ti/saude?forcar=1", { token: "tec1" }); assert.equal(n, 2);
  assert.equal((await chamar("GET", "/ti/dashboard", { token: "tec1" })).json.saude.servicos[0].status, "ok");
});
t("webhook: chamada sem assinatura (401) não entra na telemetria passiva de saúde", async () => {
  await chamar("POST", "/webhookMP", { body: { data: { id: "123456" } } }); await chamar("POST", "/webhookMP", { body: {} });
  assert.equal(ti.saude.webhookRecente().total, 0);
});

// ======================= roteador: chamado automático vai para o departamento certo =======================
const autoRot = (token, imp, erro, extra = {}) => chamar("POST", "/chamados/automatico", { token, body: { impressao: imp, titulo: "Erro automático: ApiError", descricao: `Erro: ${erro.nome}: ${erro.mensagem}\nOrigem: api`, erro, ...extra } });
const E_ADM = { nome: "ApiError", mensagem: "POST pagamentos/confirmar: valor divergente [code=valor-divergente]", rota: "POST pagamentos/confirmar", status: 409, codigo: "valor-divergente" };
const E_SUP = { nome: "ApiError", mensagem: "A janela de check-in expirou", codigo: "checkin-expirado", status: 409 };
const E_TI = { nome: "TypeError", mensagem: "x is not a function", stack: "TypeError: x is not a function\n    at f (https://x/app.js:1:1)" };

t("roteador: cada erro vai para o departamento certo, com protocolo e mensagem do setor; contadores independentes", async () => {
  const a = await autoRot("lojaA", "adm00000001", E_ADM); ok(a); assert.match(a.json.protocolo, /^ADM-000001$/); assert.equal(a.json.departamento, "adm");
  assert.match(a.json.mensagem, /ADM-000001/); assert.match(a.json.mensagem, /Administrativo\/Financeiro/); assert.equal(a.json.setor, "Administrativo / Financeiro"); assert.match(a.json.titulo, /Administrativo/);
  const s = await autoRot("lojaA", "sup00000001", E_SUP); ok(s); assert.equal(s.json.protocolo, "SUP-000001"); assert.equal(s.json.departamento, "suporte");
  const i = await autoRot("lojaA", "ti000000001", E_TI); ok(i); assert.equal(i.json.protocolo, "TI-000001"); assert.equal(i.json.departamento, "ti");
  const a2 = await autoRot("lojaB", "adm00000002", E_ADM); ok(a2); assert.equal(a2.json.protocolo, "ADM-000002");
  const d = await get("chamados_ti", a.json.id);
  assert.equal(d.departamento, "adm"); assert.equal(d.categoria, "pagamento"); assert.equal(d.classificacao.automatica, true); assert.ok(d.classificacao.motivo && d.classificacao.sinais.length);
  assert.equal(d.logsTecnicos.rota, "POST pagamentos/confirmar"); assert.equal(d.logsTecnicos.codigo, "valor-divergente"); assert.match(d.mensagemAmigavel, /ADM-000001/);
  const r = await autoRot("lojaA", "adm00000001", E_ADM); ok(r); assert.equal(r.json.repetido, true); assert.equal(r.json.protocolo, "ADM-000001"); assert.equal(r.json.departamento, "adm"); assert.match(r.json.mensagem, /já estava registrado/);
});
t("roteador: sem o campo 'erro' (cliente antigo) deduz do relatório; dados pessoais são removidos dos logs; 'erro' malformado não dá 400", async () => {
  const velho = await chamar("POST", "/chamados/automatico", { token: "lojaA", body: { impressao: "velho0000001", titulo: "Erro automático: Error", descricao: "Erro: Error: Saldo insuficiente [code=saldo-insuficiente]\nOrigem: api" } }); ok(velho);
  assert.equal(velho.json.departamento, "adm");
  const pii = await autoRot("lojaA", "pii00000001", { nome: "Error", mensagem: "falha p/ ana@loja.com cpf 123.456.789-09 Bearer abcdefghij123456", stack: "token=SEGREDO" }); ok(pii);
  const l = (await get("chamados_ti", pii.json.id)).logsTecnicos; for (const v of ["ana@loja.com", "123.456.789-09", "abcdefghij123456"]) assert.ok(!JSON.stringify(l).includes(v), v);
  ok(await chamar("POST", "/chamados/automatico", { token: "lojaA", body: { impressao: "ruim00000001", titulo: "Erro automático", descricao: "descrição qualquer", erro: "texto" } }));
  ok(await chamar("POST", "/chamados/automatico", { token: "lojaA", body: { impressao: "ruim00000002", titulo: "Erro automático", descricao: "descrição qualquer", erro: { nome: { x: 1 }, stack: 7, status: "abc" } } }));
});
t("roteador: filas por departamento (painel de TI e painel admin); chamado do TI é invisível para o admin; usuário não vê logs", async () => {
  await operador("tec1", "tecnico");
  const a = await autoRot("lojaA", "adm00000001", E_ADM), s = await autoRot("lojaA", "sup00000001", E_SUP), i = await autoRot("lojaA", "ti000000001", E_TI);
  const fila = async (q) => (await chamar("GET", `/ti/chamados?${q}`, { token: "tec1" })).json.itens.map((c) => c.protocolo).sort();
  assert.deepEqual(await fila("departamento=adm"), ["ADM-000001"]); assert.deepEqual(await fila("departamento=ti"), ["TI-000001"]); assert.deepEqual(await fila(""), ["ADM-000001", "SUP-000001", "TI-000001"]);
  const ad = await chamar("GET", "/admin/chamados", { token: "adm" }); ok(ad); assert.deepEqual(ad.json.itens.map((c) => c.protocolo).sort(), ["ADM-000001", "SUP-000001"]);
  assert.deepEqual((await chamar("GET", "/admin/chamados?departamento=suporte", { token: "adm" })).json.itens.map((c) => c.protocolo), ["SUP-000001"]);
  falha(await chamar("GET", `/admin/chamados/${i.json.id}`, { token: "adm" }), 404, "nao-encontrado");
  falha(await chamar("POST", `/admin/chamados/${i.json.id}/assumir`, { token: "adm" }), 404, "nao-encontrado");
  falha(await chamar("GET", "/admin/chamados", { token: "lojaA" }), 403); falha(await chamar("GET", "/admin/chamados", { token: "tec1" }), 403);
  const det = await chamar("GET", `/admin/chamados/${a.json.id}`, { token: "adm" }); ok(det); assert.equal(det.json.departamento, "adm"); assert.ok(!("stack" in det.json.logsTecnicos) && !("arquivo" in det.json.logsTecnicos)); assert.equal(det.json.logsTecnicos.codigo, "valor-divergente");
  assert.match((await chamar("GET", `/ti/chamados/${i.json.id}`, { token: "tec1" })).json.logsTecnicos.stack, /at f/);       // o TI continua vendo a stack completa
  const r = await chamar("GET", "/admin/chamados/resumo", { token: "adm" }); ok(r); assert.equal(r.json.adm.totalAbertos, 1); assert.equal(r.json.suporte.totalAbertos, 1);
  const painel = await chamar("GET", "/ti/dashboard", { token: "tec1" }); ok(painel); assert.equal(painel.json.fila.totalAbertos, 1);               // fila do TI só conta o TI
  assert.equal(painel.json.fila.departamentos.adm.totalAbertos, 1);
  const meu = await chamar("GET", `/chamados/${a.json.id}`, { token: "lojaA" }); ok(meu); assert.equal(meu.json.departamento, "adm"); assert.ok(!("logsTecnicos" in meu.json)); assert.ok(!("classificacao" in meu.json));
});
t("roteador: admin atende o chamado do ADM (assumir, responder, resolver) sem poluir métricas do TI; usuário vê a resposta", async () => {
  const a = await autoRot("lojaA", "adm00000001", E_ADM), id = a.json.id;
  ok(await chamar("POST", `/admin/chamados/${id}/assumir`, { token: "adm" }), "assumir");
  ok(await chamar("POST", `/admin/chamados/${id}/comentarios`, { token: "adm", body: { texto: "Conferindo o repasse agora.", interno: false } }));
  ok(await chamar("POST", `/admin/chamados/${id}/comentarios`, { token: "adm", body: { texto: "nota só da equipe", interno: true } }));
  falha(await chamar("POST", `/admin/chamados/${id}/status`, { token: "adm", body: { status: "resolvido", nota: "" } }), 400);
  ok(await chamar("POST", `/admin/chamados/${id}/status`, { token: "adm", body: { status: "resolvido", nota: "Repasse corrigido e conferido." } }), "resolver");
  const meu = (await chamar("GET", `/chamados/${id}`, { token: "lojaA" })).json;
  assert.equal(meu.status, "resolvido"); assert.ok(meu.eventos.some((e) => e.texto === "Conferindo o repasse agora." && e.autor === "Equipe de Administrativo / Financeiro")); assert.ok(!meu.eventos.some((e) => /nota só da equipe/.test(e.texto)));
  assert.equal((await todos("ti_produtividade")).length, 0); assert.equal((await todos("ti_metricas_dia")).length, 0);
});
t("roteador: transferir corrige o roteamento (protocolo igual, volta à fila do novo setor); técnico só transfere o que é seu", async () => {
  await operador("tec1", "tecnico"); await operador("tec2", "tecnico");
  const a = await autoRot("lojaA", "ti000000001", { nome: "Error", mensagem: "Falha ao conferir comissão do mês" }), id = a.json.id; assert.equal(a.json.departamento, "adm");
  falha(await chamar("POST", `/ti/chamados/${id}/transferir`, { token: "tec1", body: { departamento: "adm", motivo: "mesmo setor" } }), 409, "sem-mudanca");
  falha(await chamar("POST", `/ti/chamados/${id}/transferir`, { token: "tec1", body: { departamento: "xx", motivo: "motivo válido" } }), 400);
  falha(await chamar("POST", `/ti/chamados/${id}/transferir`, { token: "tec1", body: { departamento: "suporte", motivo: "ok" } }), 400);
  ok(await chamar("POST", `/ti/chamados/${id}/assumir`, { token: "tec1" }));
  falha(await chamar("POST", `/ti/chamados/${id}/transferir`, { token: "tec2", body: { departamento: "suporte", motivo: "não é meu chamado" } }), 403, "nao-e-seu");
  const t1 = await chamar("POST", `/ti/chamados/${id}/transferir`, { token: "tec1", body: { departamento: "suporte", motivo: "É dúvida de uso, não de dinheiro." } }); ok(t1);
  assert.equal(t1.json.departamento, "suporte"); assert.equal(t1.json.protocolo, a.json.protocolo); assert.equal(t1.json.status, "aberto"); assert.equal(t1.json.atribuidoUid, ""); assert.equal(t1.json.transferencias, 1);
  assert.equal((await get("chamados_ti", id)).classificacao.departamento, "adm");                          // a decisão do robô fica preservada
  assert.deepEqual((await chamar("GET", "/admin/chamados?departamento=suporte", { token: "adm" })).json.itens.map((c) => c.id), [id]);
  const meu = (await chamar("GET", `/chamados/${id}`, { token: "lojaA" })).json; assert.ok(!meu.eventos.some((e) => e.tipo === "transferido"));
  ok(await chamar("POST", `/admin/chamados/${id}/transferir`, { token: "adm", body: { departamento: "ti", motivo: "Na verdade é bug técnico." } }));
  assert.equal((await get("chamados_ti", id)).departamento, "ti");
});
t("roteador: chamados antigos (sem 'departamento') continuam na fila do TI; chamado manual segue TI-", async () => {
  await operador("tec1", "tecnico");
  const m = await novoChamado("lojaA"); assert.match(m.protocolo, /^TI-\d{6}$/);
  const d = await get("chamados_ti", m.id); delete d.departamento; await set("chamados_ti", m.id, d);       // simula chamado de antes do roteador
  assert.equal((await chamar("GET", "/ti/chamados?departamento=ti", { token: "tec1" })).json.itens.length, 1);
  assert.equal((await chamar("GET", "/ti/chamados?departamento=adm", { token: "tec1" })).json.itens.length, 0);
  assert.equal((await chamar("GET", "/ti/dashboard", { token: "tec1" })).json.fila.totalAbertos, 1);
});
t("roteador: a equipe é avisada (push ADM/Suporte + webhook do departamento) em segundo plano, sem atrasar nem quebrar a resposta", async () => {
  const antes = { ...process.env }, fetchReal = globalThis.fetch, envios = [];
  process.env.CHAMADOS_WEBHOOK_ADM = "https://hooks.slack.com/services/T/B/X"; process.env.CHAMADOS_WEBHOOK_SUPORTE = "https://chat.exemplo.com/h";
  globalThis.fetch = async (url, op) => { envios.push({ url, corpo: JSON.parse(op.body) }); return { ok: true, status: 200 }; };
  try {
    await set("push_tokens", "t1", { uid: "adm1", token: "tok-admin", admin: true });
    const a = await autoRot("lojaA", "adm00000001", E_ADM); ok(a); await ctx.despacho.aguardar();
    assert.equal(envios.length, 1); assert.equal(envios[0].url, "https://hooks.slack.com/services/T/B/X"); assert.match(envios[0].corpo.text, /ADM-000001/); assert.ok(!/at f \(/.test(envios[0].corpo.text));
    assert.equal(E.pushes.length, 1); assert.match(E.pushes[0].data.titulo, /ADM-000001/);
    const nota = (await ctx.db.collection(`chamados_ti/${a.json.id}/eventos`).get()).docs.map((d) => d.data()).find((e) => e.tipo === "notificacao"); assert.ok(nota && nota.interno === true && /webhook ok/.test(nota.texto));
    await autoRot("lojaA", "ti000000001", E_TI); await ctx.despacho.aguardar(); assert.equal(envios.length, 1);        // TI sem webhook configurado: nada sai
    globalThis.fetch = async () => { throw new Error("chat fora do ar"); };
    const b = await autoRot("lojaB", "adm00000009", E_ADM); ok(b, "resposta não depende do chat"); await ctx.despacho.aguardar(); assert.match(b.json.protocolo, /^ADM-/);
  } finally { globalThis.fetch = fetchReal; for (const k of ["CHAMADOS_WEBHOOK_ADM", "CHAMADOS_WEBHOOK_SUPORTE"]) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; } }
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    reset(); const log = console.warn; console.warn = () => {}; const err = console.error; console.error = () => {};
    try { await fn(); process.stdout.write(`  ✓ ${nome}\n`); }
    catch (e) { falhas++; process.stdout.write(`  ✗ ${nome}\n      ${String(e.stack || e).split("\n").slice(0, 5).join("\n      ")}\n`); }
    finally { console.warn = log; console.error = err; }
  }
  E.restaurarRelogio(); process.stdout.write(`\n${testes.length - falhas}/${testes.length} testes do módulo de TI passaram\n`); process.exit(falhas ? 1 : 0);
})();
