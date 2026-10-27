// Cadastro e dados da conta. Dados sensíveis só passam por aqui (validados, cifrados) — o navegador nunca grava
// nem lê CPF, nascimento, telefone ou Pix diretamente no Firestore.
const crypto = require("crypto");

module.exports = (app, x) => {
  const { db, FieldValue, auth, V, C, Cripto, Falha, envelope, limitar, habilitacao } = x;
  const TERMOS_VERSAO = "2026-10";
  const lim = limitar({ janelaMs: 60_000, max: 12, nome: "conta" });
  const ctxCampo = (campo, uid) => `profissionais_privado/${campo}/${uid}`;
  const nomeSeguro = (n) => { try { return V.texto(n || "", "nome", { max: 100, obrigatorio: false }); } catch { return ""; } };
  const novoCodigo = () => Array.from(crypto.randomBytes(6), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");

  async function conflitoDeCpf(cpfDigitos, uid) {
    const s = await db.collection("profissionais_privado").where("cpfIdx", "==", Cripto.indiceCego(cpfDigitos)).limit(2).get();
    if (s.docs.some((d) => d.id !== uid)) throw new Falha(409, "Já existe um cadastro com este CPF. Se for seu, use a conta original ou fale com o suporte.", "cpf-duplicado");
  }

  /** Valida o responsável legal (obrigatório para 16–17 anos) e devolve o objeto a cifrar. */
  function validarResponsavel(r, cpfDoMenor) {
    if (!r || typeof r !== "object" || Array.isArray(r)) throw new Falha(400, "Informe os dados do responsável legal.", "responsavel-obrigatorio");
    const o = {
      nome: V.texto(r.nome, "nome do responsável", { min: 5, max: 100 }),
      cpf: V.cpf(r.cpf, "CPF do responsável"),
      telefone: V.telefone(r.telefone, "telefone do responsável"),
      parentesco: V.opcao(r.parentesco, ["Mãe", "Pai", "Responsável legal"], "parentesco")
    };
    if (cpfDoMenor && o.cpf === cpfDoMenor) throw new Falha(400, "O CPF do responsável deve ser diferente do seu.", "responsavel-invalido");
    return o;
  }

  /**
   * Monta os campos privados (cifrados) a partir do corpo, respeitando travas:
   * CPF e nascimento, depois de gravados, só mudam pela equipe (impede "rejuvenescer" a conta).
   */
  async function montarPrivado(uid, atual, b) {
    const novo = {}, info = {};
    if (b.cpf !== undefined) {
      const cpf = V.cpf(b.cpf);
      if (atual.cpfEnc) { if (Cripto.decifrar(atual.cpfEnc, ctxCampo("cpf", uid)) !== cpf) throw new Falha(409, "O CPF já cadastrado só pode ser alterado pelo suporte.", "dado-travado"); }
      else { await conflitoDeCpf(cpf, uid); novo.cpfEnc = Cripto.cifrar(cpf, ctxCampo("cpf", uid)); novo.cpfIdx = Cripto.indiceCego(cpf); }
    }
    if (b.nascimento !== undefined) {
      const n = V.validarNascimento(b.nascimento);                                   // ≥ 16 anos, data real, não futura
      if (atual.nascimentoEnc) { if (Cripto.decifrar(atual.nascimentoEnc, ctxCampo("nascimento", uid)) !== n.nascimento) throw new Falha(409, "A data de nascimento só pode ser alterada pelo suporte.", "dado-travado"); }
      else { novo.nascimentoEnc = Cripto.cifrar(n.nascimento, ctxCampo("nascimento", uid)); novo.nascimentoTravadoEm = FieldValue.serverTimestamp(); }
    }
    if (b.telefone !== undefined) novo.telefoneEnc = Cripto.cifrar(V.telefone(b.telefone), ctxCampo("telefone", uid));
    // idade efetiva (do dado novo ou do já gravado) decide se o responsável é exigido
    const nasc = b.nascimento !== undefined ? V.validarNascimento(b.nascimento).nascimento : atual.nascimentoEnc ? Cripto.decifrar(atual.nascimentoEnc, ctxCampo("nascimento", uid)) : null;
    if (nasc) {
      info.idade = V.calcularIdade(nasc); info.menor = info.idade < C.IDADE_MAIORIDADE;
      const cpfProprio = b.cpf !== undefined ? V.cpf(b.cpf) : atual.cpfEnc ? Cripto.decifrar(atual.cpfEnc, ctxCampo("cpf", uid)) : null;
      if (info.menor && (b.responsavel !== undefined || !atual.responsavelEnc)) {
        if (b.autorizacaoResponsavel !== true) throw new Falha(400, "Para 16 e 17 anos é preciso confirmar a autorização do responsável legal.", "responsavel-obrigatorio");
        novo.responsavelEnc = Cripto.cifrar(validarResponsavel(b.responsavel, cpfProprio), ctxCampo("responsavel", uid));
        novo.autorizacaoResponsavelEm = FieldValue.serverTimestamp(); novo.autorizacaoVersao = TERMOS_VERSAO;
      }
    }
    return { novo, info };
  }

  // ---------- Loja ----------
  app.post("/cadastro/loja", lim, envelope(async (req, res) => {
    const u = await auth.autenticar(req);
    if (u.role && u.role !== "loja") throw new Falha(409, "Esta conta Google já está registrada com outro perfil. Use outra conta.", "papel-conflito");
    if (req.body?.termos !== true) throw new Falha(400, "É preciso aceitar os Termos de Uso.", "termos-obrigatorios");
    if ((await db.collection("profissionais").doc(u.uid).get()).exists) throw new Falha(409, "Esta conta já é de promotor. Use outra conta Google para a loja.", "papel-conflito");
    const ref = db.collection("contratantes").doc(u.uid);
    if (!(await ref.get()).exists) await ref.set({ uid: u.uid, email: u.email || "", nome: nomeSeguro(u.name), termosEm: FieldValue.serverTimestamp(), termosVersao: TERMOS_VERSAO, criadoEm: FieldValue.serverTimestamp() });
    await db.collection("usuarios").doc(u.uid).set({ uid: u.uid, role: "loja", criadoEm: FieldValue.serverTimestamp() }, { merge: true });
    await auth.definirPapel(u.uid, "loja");
    res.json({ ok: true, role: "loja" });
  }));

  // ---------- Promotor / freelancer (16+) ----------
  app.post("/cadastro/promotor", lim, envelope(async (req, res) => {
    const u = await auth.autenticar(req), b = req.body || {};
    if (u.role && u.role !== "promotor") throw new Falha(409, "Esta conta Google já está registrada com outro perfil. Use outra conta.", "papel-conflito");
    if (b.termos !== true) throw new Falha(400, "É preciso aceitar os Termos de Uso.", "termos-obrigatorios");
    if (b.nascimento === undefined || b.cpf === undefined) throw new Falha(400, "Informe CPF e data de nascimento.", "dados-invalidos");
    if ((await db.collection("contratantes").doc(u.uid).get()).exists) throw new Falha(409, "Esta conta já é de loja. Use outra conta Google para o perfil de promotor.", "papel-conflito");
    const ref = db.collection("profissionais").doc(u.uid), existente = await ref.get();
    if (existente.exists) { await auth.definirPapel(u.uid, "promotor", { treinado: !!existente.data().treinamentoOk }); return res.json({ ok: true, role: "promotor", jaCadastrado: true }); }
    const privAtual = (await db.collection("profissionais_privado").doc(u.uid).get()).data() || {};
    const { novo, info } = await montarPrivado(u.uid, privAtual, { cpf: b.cpf, nascimento: b.nascimento, telefone: b.telefone, responsavel: b.responsavel, autorizacaoResponsavel: b.autorizacaoResponsavel });
    const indicado = typeof b.indicadoPor === "string" && /^[\w-]{1,40}$/.test(b.indicadoPor) ? b.indicadoPor : "";
    const lote = db.batch();
    lote.set(ref, {
      uid: u.uid, nome: nomeSeguro(b.nome) || nomeSeguro(u.name), status: "pendente", fotoGoogle: typeof u.picture === "string" && u.picture.startsWith("https://") ? u.picture.slice(0, 300) : "",
      indicadoPor: indicado, refCode: novoCodigo(), treinamentoOk: false, termosEm: FieldValue.serverTimestamp(), termosVersao: TERMOS_VERSAO, criadoEm: FieldValue.serverTimestamp()
    });
    lote.set(db.collection("profissionais_privado").doc(u.uid), { uid: u.uid, ...novo, criadoEm: FieldValue.serverTimestamp() }, { merge: true });
    lote.set(db.collection("usuarios").doc(u.uid), { uid: u.uid, role: "promotor", email: u.email || "", criadoEm: FieldValue.serverTimestamp() }, { merge: true });
    await lote.commit();
    await auth.definirPapel(u.uid, "promotor", { treinado: false });
    res.json({ ok: true, role: "promotor", idade: info.idade, menor: info.menor, status: "pendente" });
  }));

  /** Completa dados que faltam (contas antigas sem nascimento/CPF). Dados já gravados ficam travados. */
  app.put("/perfil/promotor/privado", lim, auth.exigir("promotor"), envelope(async (req, res) => {
    const uid = req.usuario.uid, b = V.somente(req.body, ["cpf", "nascimento", "telefone", "responsavel", "autorizacaoResponsavel"]);
    const ref = db.collection("profissionais_privado").doc(uid), atual = (await ref.get()).data() || {};
    const { novo, info } = await montarPrivado(uid, atual, b);
    if (Object.keys(novo).length) await ref.set({ uid, ...novo, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    await auth.auditar(req, "perfil.privado.atualizar", uid, { campos: Object.keys(b) });
    res.json({ ok: true, idade: info.idade ?? null, menor: info.menor ?? null });
  }));

  app.put("/perfil/promotor/pix", lim, auth.exigir("promotor"), envelope(async (req, res) => {
    auth.exigirRecente(req.usuario);                                                    // sensível: login recente
    const uid = req.usuario.uid, pix = V.chavePix(req.body?.tipo, req.body?.chave);
    await db.collection("profissionais_privado").doc(uid).set({ uid, pixEnc: Cripto.cifrar(pix, ctxCampo("pix", uid)), pixTipo: pix.tipo, pixAlteradoEm: FieldValue.serverTimestamp() }, { merge: true });
    await auth.auditar(req, "perfil.pix.alterar", uid, { tipo: pix.tipo });
    res.json({ ok: true, pix: { tipo: pix.tipo, chaveMascarada: V.mascararChave(pix.chave) } });
  }));

  /** Dados do próprio profissional, decifrados e mascarados quando possível. */
  app.get("/perfil/privado", auth.exigir("promotor"), envelope(async (req, res) => {
    const uid = req.usuario.uid, p = (await db.collection("profissionais_privado").doc(uid).get()).data() || {};
    const dec = (campo) => { try { return p[`${campo}Enc`] ? Cripto.decifrar(p[`${campo}Enc`], ctxCampo(campo, uid)) : null; } catch { return null; } };
    const cpf = dec("cpf"), nasc = dec("nascimento"), tel = dec("telefone"), pix = dec("pix"), resp = dec("responsavel");
    const idade = nasc ? V.calcularIdade(nasc) : null;
    res.json({
      temCpf: !!cpf, cpfMascarado: cpf ? V.mascararCPF(cpf) : "", nascimento: nasc || "", nascimentoTravado: !!nasc, telefone: tel || "",
      idade, menor: idade !== null && idade < C.IDADE_MAIORIDADE,
      pix: pix ? { tipo: pix.tipo, chaveMascarada: V.mascararChave(pix.chave) } : null,
      responsavel: resp ? { nome: resp.nome, parentesco: resp.parentesco, cpfMascarado: V.mascararCPF(resp.cpf), telefone: V.mascararTelefone(resp.telefone) } : null,
      autorizacaoResponsavel: !!p.autorizacaoResponsavelEm
    });
  }));

  app.get("/habilitacao", auth.exigir("promotor"), envelope(async (req, res) => res.json(await habilitacao.situacao(req.usuario.uid))));

  /** Contas anteriores ao RBAC não têm papel no token: resolve uma vez (e só se não houver ambiguidade). */
  app.post("/sessao", lim, envelope(async (req, res) => {
    const u = await auth.autenticar(req);
    if (u.role) return res.json({ role: u.role, atualizarToken: false });
    const [l, p] = await Promise.all([db.collection("contratantes").doc(u.uid).get(), db.collection("profissionais").doc(u.uid).get()]);
    if (l.exists && p.exists) throw new Falha(409, "Conta com dois perfis. Fale com o suporte.", "conta-ambigua");
    if (!l.exists && !p.exists) return res.json({ role: null, atualizarToken: false });
    const role = l.exists ? "loja" : "promotor";
    await auth.definirPapel(u.uid, role, role === "promotor" ? { treinado: false } : {});
    await db.collection("usuarios").doc(u.uid).set({ uid: u.uid, role, migradoEm: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ role, atualizarToken: true });
  }));
};
