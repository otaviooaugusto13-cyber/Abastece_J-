// ============================================================
// ABASTECE JÁ — Mural de Vagas / Banco de Talentos (regras de negócio). Ver MODULO-VAGAS.md.
// Tudo mora no servidor: o navegador só envia intenções. Coleções (todas negadas no firestore.rules; só o Admin SDK acessa):
//   vagas               (job_postings)     uma vaga de uma empresa/rede
//   vagas_empresas      (companies)        quem anuncia: rede, loja, marca. Guarda plano/créditos (cobrança futura)
//   vagas_candidaturas  (job_applications) id = `${vagaId}_${uid}` → 1 candidatura por pessoa por vaga (idempotente)
//   configuracoes/vagas                    chave da fase gratuita e do modelo de cobrança (editável pelo admin)
//   profissionais_privado/{uid}            + aceitaDivulgacaoVagas (opt-in LGPD) e curriculo {path, sha256, bytes}
// ============================================================
const Curriculo = require("./curriculo");

const DIA = 86_400_000;
const TIPOS = { degustacao: "Degustação", promotor: "Promotor", repositor: "Repositor" };
const STATUS_VAGA = ["rascunho", "ativa", "encerrada"];                       // draft | active | closed
const MODERACAO = ["pendente", "aprovada", "rejeitada"];
const STATUS_CANDIDATURA = ["pendente", "em_analise", "aceita", "recusada"];  // pending | under_review | accepted | rejected
const TIPOS_EMPRESA = ["rede", "loja", "marca", "outra"];
const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
// Texto EXATO que a pessoa vê ao aceitar. Mudou o texto → mude a versão: o aceite grava a versão, e isso é a prova do consentimento.
const TERMO_DIVULGACAO = { versao: "2026-11", texto: "Aceito disponibilizar meus dados e currículo para divulgação em vagas de empresas parceiras." };
const CONFIG_PADRAO = {
  faseGratuita: true,            // lançamento: parceiros postam de graça para gerar tração
  gratuitoAte: null,             // "AAAA-MM-DD" (fim do dia, horário de Brasília) ou null = até o admin desligar
  modelo: "mensalidade",         // o que vale DEPOIS da fase gratuita: "mensalidade" | "creditos"
  mensalidadeCentavos: 0, creditoCentavos: 0,   // preços (informativos até existir o checkout)
  validadeDiasPadrao: 30, maxVagasAtivasGratis: 10, moderacaoLojas: true
};
const MODELOS = ["mensalidade", "creditos"];

const ms = (t) => (t == null ? 0 : typeof t === "number" ? t : typeof t.toMillis === "function" ? t.toMillis() : 0);
const semAcento = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const chaveCidade = (cidade, uf) => `${semAcento(cidade).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${String(uf).toLowerCase()}`;
const visivel = (v, agora) => v.status === "ativa" && v.moderacao === "aprovada" && ms(v.expiraEm) > agora;

function criarVagas({ db, FieldValue, Timestamp, V, C, Cripto, Falha, armazenamento }) {
  const col = (n) => db.collection(n);
  const ts = () => FieldValue.serverTimestamp();
  const naoEncontrada = (o = "Vaga") => new Falha(404, `${o} não encontrada.`, "nao-encontrado");
  const ctxCpfPerfil = (uid) => `profissionais_privado/cpf/${uid}`;
  const ctxCpfCandidatura = (id) => `vagas_candidaturas/cpf/${id}`;
  const fimDoDia = (iso) => Date.parse(`${iso}T23:59:59-03:00`);
  const dataIso = (x, campo) => { if (!V.dataIsoValida(x)) throw new Falha(400, `Data inválida: ${campo}.`, "dados-invalidos", { campo }); return x; };

  // ---------------- configuração e chave de cobrança ----------------
  async function lerConfig() {
    const d = (await col("configuracoes").doc("vagas").get()).data() || {};
    return { ...CONFIG_PADRAO, ...Object.fromEntries(Object.entries(d).filter(([k]) => k in CONFIG_PADRAO)) };
  }
  /** A fase gratuita vale enquanto a chave estiver ligada E a data limite (se houver) não tiver passado. */
  const faseGratuitaAtiva = (cfg, agora = Date.now()) => cfg.faseGratuita === true && (!cfg.gratuitoAte || agora <= fimDoDia(cfg.gratuitoAte));
  async function salvarConfig(body) {
    const b = V.somente(body, Object.keys(CONFIG_PADRAO)), p = {};
    if (b.faseGratuita !== undefined) p.faseGratuita = V.booleano(b.faseGratuita, "faseGratuita");
    if (b.gratuitoAte !== undefined) p.gratuitoAte = b.gratuitoAte === null || b.gratuitoAte === "" ? null : dataIso(b.gratuitoAte, "gratuitoAte");
    if (b.modelo !== undefined) p.modelo = V.opcao(b.modelo, MODELOS, "modelo");
    if (b.mensalidadeCentavos !== undefined) p.mensalidadeCentavos = V.inteiro(b.mensalidadeCentavos, "mensalidade", { min: 0, max: 1_000_000 });
    if (b.creditoCentavos !== undefined) p.creditoCentavos = V.inteiro(b.creditoCentavos, "preço do crédito", { min: 0, max: 100_000 });
    if (b.validadeDiasPadrao !== undefined) p.validadeDiasPadrao = V.inteiro(b.validadeDiasPadrao, "validade", { min: 1, max: 180 });
    if (b.maxVagasAtivasGratis !== undefined) p.maxVagasAtivasGratis = V.inteiro(b.maxVagasAtivasGratis, "limite de vagas", { min: 1, max: 100 });
    if (b.moderacaoLojas !== undefined) p.moderacaoLojas = V.booleano(b.moderacaoLojas, "moderacaoLojas");
    if (!Object.keys(p).length) throw new Falha(400, "Nenhum campo válido enviado.", "dados-invalidos");
    await col("configuracoes").doc("vagas").set({ ...p, atualizadoEm: ts() }, { merge: true });
    return lerConfig();
  }

  // ---------------- empresas (quem anuncia) ----------------
  const dtoEmpresa = (id, e, agora = Date.now()) => ({ id, nome: e.nome, tipo: e.tipo, ativo: e.ativo !== false, creditos: e.creditos || 0, assinaturaAte: ms(e.assinaturaAte) || null, assinaturaAtiva: ms(e.assinaturaAte) > agora });
  async function criarEmpresa({ nome, tipo, uid }) {
    const ref = col("vagas_empresas").doc();
    const e = { nome: V.texto(nome, "nome da empresa", { min: 2, max: 80 }), tipo: V.opcao(tipo || "rede", TIPOS_EMPRESA, "tipo"), ativo: true, creditos: 0, assinaturaAte: null, criadoPor: uid, criadoEm: ts() };
    await ref.set(e); return dtoEmpresa(ref.id, e);
  }
  async function listarEmpresas() {
    const s = await col("vagas_empresas").limit(500).get();
    return s.docs.map((d) => dtoEmpresa(d.id, d.data())).sort((a, b) => a.nome.localeCompare(b.nome));
  }
  async function empresaPorId(id) { const e = (await col("vagas_empresas").doc(V.idDoc(id, "empresa")).get()).data(); if (!e || e.ativo === false) throw naoEncontrada("Empresa"); return { id, ...e }; }
  /** A loja (papel `loja`) vira empresa automaticamente na 1ª vaga: id fixo evita duplicar em requisições simultâneas. */
  async function empresaDaLoja(uid) {
    const ref = col("vagas_empresas").doc(`loja_${uid}`), atual = (await ref.get()).data();
    if (atual) { if (atual.ativo === false) throw new Falha(403, "Sua empresa está bloqueada para anunciar vagas. Fale com o suporte.", "empresa-bloqueada"); return { id: ref.id, ...atual }; }
    const c = (await col("contratantes").doc(uid).get()).data() || {};
    const e = { nome: V.texto(c.razaoSocial || c.nome || "Loja parceira", "nome da empresa", { min: 2, max: 80 }), tipo: "loja", contratanteUid: uid, ativo: true, creditos: 0, assinaturaAte: null, criadoPor: uid, criadoEm: ts() };
    await ref.set(e); return { id: ref.id, ...e };
  }
  /** Admin: assinatura até uma data e/ou ajuste (+/-) de créditos. Aqui entra o pagamento manual; o checkout automático liga neste ponto. */
  async function ajustarPlano(id, { assinaturaAte, creditosDelta }) {
    const e = await empresaPorId(id), ref = col("vagas_empresas").doc(id), p = { atualizadoEm: ts() };
    if (assinaturaAte !== undefined) p.assinaturaAte = assinaturaAte === null || assinaturaAte === "" ? null : Timestamp.fromMillis(fimDoDia(dataIso(assinaturaAte, "assinaturaAte")));
    if (creditosDelta !== undefined) {
      const d = V.inteiro(creditosDelta, "créditos", { min: -1000, max: 1000 });
      if ((e.creditos || 0) + d < 0) throw new Falha(400, "O saldo de créditos não pode ficar negativo.", "dados-invalidos", { campo: "creditosDelta" });
      p.creditos = FieldValue.increment(d);
    }
    await ref.set(p, { merge: true });
    return dtoEmpresa(id, (await ref.get()).data());
  }

  // ---------------- vagas ----------------
  function prazo(iso) {
    if (!V.dataIsoValida(iso)) throw new Falha(400, "Data de validade inválida.", "dados-invalidos", { campo: "expiraEm" });
    const t = fimDoDia(iso);
    if (t <= Date.now()) throw new Falha(400, "A validade precisa ser uma data futura.", "dados-invalidos", { campo: "expiraEm" });
    if (t > Date.now() + 365 * DIA) throw new Falha(400, "A validade máxima é de 1 ano.", "dados-invalidos", { campo: "expiraEm" });
    return t;
  }
  function validarVaga(b, { parcial = false } = {}) {
    b = V.somente(b, ["titulo", "descricao", "cidade", "uf", "tipo", "apenasMaiores", "expiraEm"]);
    const quer = (k) => !parcial || b[k] !== undefined, o = {};
    if (quer("titulo")) o.titulo = V.texto(b.titulo, "título", { min: 5, max: 80 });
    if (quer("descricao")) o.descricao = V.texto(b.descricao, "descrição", { min: 20, max: 2000 });
    if (quer("cidade")) o.cidade = V.texto(b.cidade, "cidade", { min: 2, max: 80 });
    if (quer("uf")) o.uf = V.opcao(String(b.uf || "").toUpperCase(), UFS, "UF");
    if (quer("tipo")) o.tipo = V.opcao(b.tipo, Object.keys(TIPOS), "tipo de atuação");
    if (b.apenasMaiores !== undefined) o.apenasMaiores = V.booleano(b.apenasMaiores, "apenasMaiores"); else if (!parcial) o.apenasMaiores = true;   // padrão conservador (ECA): 16–17 só se a vaga permitir
    if (b.expiraEm !== undefined && b.expiraEm !== null && b.expiraEm !== "") o.expiraEmMs = prazo(b.expiraEm);
    return o;
  }
  const dtoVaga = (id, v, extra = {}) => ({
    id, titulo: v.titulo, descricao: v.descricao, cidade: v.cidade, uf: v.uf, tipo: v.tipo, tipoRotulo: TIPOS[v.tipo] || v.tipo, apenasMaiores: v.apenasMaiores !== false,
    empresa: { id: v.empresaId, nome: v.empresaNome }, publicadaEm: ms(v.publicadaEm) || null, expiraEm: ms(v.expiraEm) || null, ...extra
  });
  const dtoVagaGestao = (id, v) => dtoVaga(id, v, { status: v.status, moderacao: v.moderacao, moderacaoMotivo: v.moderacaoMotivo || "", gratuita: v.gratuita === true, origem: v.origem, candidaturas: v.candidaturasTotal || 0, criadaEm: ms(v.criadoEm) || null, encerradaEm: ms(v.encerradaEm) || null });

  /** Cria a vaga (sempre como rascunho) e, se pedido, publica pelo mesmo caminho que valida a cobrança. `origem`: "admin" | "empresa". */
  async function criarVaga({ empresa, dados, origem, uid, publicar = false }) {
    const o = validarVaga(dados), cfg = await lerConfig(), ref = col("vagas").doc();
    const v = {
      empresaId: empresa.id, empresaNome: empresa.nome, empresaTipo: empresa.tipo, titulo: o.titulo, descricao: o.descricao, cidade: o.cidade, uf: o.uf, cidadeChave: chaveCidade(o.cidade, o.uf), tipo: o.tipo,
      apenasMaiores: o.apenasMaiores, status: "rascunho", moderacao: origem === "admin" || !cfg.moderacaoLojas ? "aprovada" : "pendente",
      gratuita: faseGratuitaAtiva(cfg), cobranca: { modelo: "gratuito", creditosUsados: 0 }, origem, criadoPor: uid, candidaturasTotal: 0,
      expiraEm: o.expiraEmMs ? Timestamp.fromMillis(o.expiraEmMs) : null, criadoEm: ts(), atualizadoEm: ts()
    };
    await ref.set(v);
    if (publicar) return mudarStatus(ref.id, "ativa", { origem, uid, empresaId: origem === "empresa" ? empresa.id : null });
    return dtoVagaGestao(ref.id, { ...v, criadoEm: Date.now() });
  }
  async function atualizarVaga(id, dados, { origem, empresaId = null }) {
    const ref = col("vagas").doc(V.idDoc(id, "id")), v = (await ref.get()).data();
    if (!v || (empresaId && v.empresaId !== empresaId)) throw naoEncontrada();
    const o = validarVaga(dados, { parcial: true }), p = { atualizadoEm: ts() };
    for (const k of ["titulo", "descricao", "cidade", "uf", "tipo", "apenasMaiores"]) if (o[k] !== undefined) p[k] = o[k];
    if (o.expiraEmMs) p.expiraEm = Timestamp.fromMillis(o.expiraEmMs);
    if (p.cidade !== undefined || p.uf !== undefined) p.cidadeChave = chaveCidade(p.cidade ?? v.cidade, p.uf ?? v.uf);
    // Empresa mexeu no texto de uma vaga já aprovada → volta para a moderação (senão a aprovação seria um "bait and switch").
    if (origem === "empresa" && (p.titulo !== undefined || p.descricao !== undefined) && v.moderacao !== "pendente") p.moderacao = (await lerConfig()).moderacaoLojas ? "pendente" : "aprovada";
    await ref.set(p, { merge: true });
    return dtoVagaGestao(id, { ...v, ...p, criadoEm: v.criadoEm, expiraEm: p.expiraEm ?? v.expiraEm });
  }

  /**
   * Muda o status. Publicar (→ ativa) é o ponto de COBRANÇA: fase gratuita → grátis (com teto por empresa); depois dela,
   * empresa precisa de assinatura vigente ("mensalidade") ou de 1 crédito ("creditos"). O admin publica em nome de redes sem cobrança.
   * Despublicar e republicar é uma nova publicação (nova validade, nova checagem).
   */
  async function mudarStatus(id, novo, { origem, uid, empresaId = null }) {
    V.opcao(novo, STATUS_VAGA, "status");
    const ref = col("vagas").doc(V.idDoc(id, "id")), v = (await ref.get()).data();
    if (!v || (empresaId && v.empresaId !== empresaId)) throw naoEncontrada();
    if (v.status === novo) return dtoVagaGestao(id, v);
    const agora = Date.now(), p = { status: novo, atualizadoEm: ts() };
    if (novo === "encerrada") p.encerradaEm = ts();
    if (novo !== "ativa") { await ref.set(p, { merge: true }); return dtoVagaGestao(id, { ...v, ...p, criadoEm: v.criadoEm }); }

    if (origem === "empresa" && v.moderacao === "rejeitada") throw new Falha(409, "Esta vaga foi recusada pela moderação. Ajuste o texto para reenviá-la.", "vaga-rejeitada");
    const cfg = await lerConfig(), fase = faseGratuitaAtiva(cfg, agora);
    let consumir = false; p.gratuita = fase; p.cobranca = { modelo: "gratuito", creditosUsados: 0 };
    if (origem === "empresa") {
      const emp = (await col("vagas_empresas").doc(v.empresaId).get()).data() || {};
      if (emp.ativo === false) throw new Falha(403, "Sua empresa está bloqueada para anunciar vagas.", "empresa-bloqueada");
      if (fase) {
        const ativas = (await col("vagas").where("empresaId", "==", v.empresaId).get()).docs.filter((d) => d.id !== id && d.data().status === "ativa" && ms(d.data().expiraEm) > agora).length;
        if (ativas >= cfg.maxVagasAtivasGratis) throw new Falha(409, `Você já tem ${ativas} vagas ativas. Na fase gratuita o limite é ${cfg.maxVagasAtivasGratis}; encerre alguma para publicar outra.`, "limite-vagas-gratis");
      } else if (cfg.modelo === "mensalidade") {
        if (!(ms(emp.assinaturaAte) > agora)) throw new Falha(402, "A fase gratuita terminou. Para publicar vagas é preciso ter a mensalidade em dia — fale com a equipe do Abastece Já.", "plano-necessario", { modelo: "mensalidade", valorCentavos: cfg.mensalidadeCentavos });
        p.cobranca = { modelo: "mensalidade", creditosUsados: 0 };
      } else {
        if (!((emp.creditos || 0) > 0)) throw new Falha(402, "A fase gratuita terminou e você não tem créditos de vaga. Fale com a equipe do Abastece Já para comprar.", "plano-necessario", { modelo: "creditos", valorCentavos: cfg.creditoCentavos });
        consumir = true; p.cobranca = { modelo: "creditos", creditosUsados: 1 };
      }
    }
    p.publicadaEm = ts();
    p.expiraEm = ms(v.expiraEm) > agora ? v.expiraEm : Timestamp.fromMillis(agora + cfg.validadeDiasPadrao * DIA);
    if (consumir) {
      const eref = col("vagas_empresas").doc(v.empresaId);
      await db.runTransaction(async (tx) => {
        const e = (await tx.get(eref)).data() || {};
        if (!((e.creditos || 0) > 0)) throw new Falha(402, "Você não tem créditos de vaga.", "plano-necessario", { modelo: "creditos" });
        tx.update(eref, { creditos: FieldValue.increment(-1) }); tx.set(ref, p, { merge: true });
      });
    } else await ref.set(p, { merge: true });
    return dtoVagaGestao(id, { ...v, ...p, criadoEm: v.criadoEm, publicadaEm: agora });
  }
  async function moderar(id, estado, motivo, uid) {
    V.opcao(estado, MODERACAO, "moderação");
    const m = V.texto(motivo || "", "motivo", { max: 300, obrigatorio: false });
    if (estado === "rejeitada" && m.length < 5) throw new Falha(400, "Explique o motivo da recusa (a empresa vê esta mensagem).", "dados-invalidos", { campo: "motivo" });
    const ref = col("vagas").doc(V.idDoc(id, "id")), v = (await ref.get()).data(); if (!v) throw naoEncontrada();
    await ref.set({ moderacao: estado, moderacaoMotivo: estado === "rejeitada" ? m : "", moderadaPor: uid, moderadaEm: ts() }, { merge: true });
    return dtoVagaGestao(id, { ...v, moderacao: estado, moderacaoMotivo: m });
  }
  async function listarGestao({ empresaId, status, moderacao } = {}) {
    let q = col("vagas"); if (empresaId) q = q.where("empresaId", "==", empresaId); else q = q.orderBy("criadoEm", "desc");
    const s = await q.limit(300).get();
    return s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((v) => (!status || v.status === status) && (!moderacao || v.moderacao === moderacao))
      .sort((a, b) => ms(b.criadoEm) - ms(a.criadoEm)).map((v) => dtoVagaGestao(v.id, v));
  }
  /** Rotina do cron: vagas ativas vencidas viram "encerrada" (o feed já as esconde antes disso). */
  async function encerrarExpiradas() {
    const agora = Date.now(), s = await col("vagas").where("status", "==", "ativa").limit(500).get(), lote = db.batch(); let n = 0;
    for (const d of s.docs) if (ms(d.data().expiraEm) <= agora) { lote.set(d.ref, { status: "encerrada", encerradaEm: ts(), atualizadoEm: ts() }, { merge: true }); n++; }
    if (n) await lote.commit(); return n;
  }

  // ---------------- feed do freelancer ----------------
  /** Vagas abertas + filtros (cidade, tipo, rede). Filtra em memória sobre as ≤300 ativas: sem índice composto (ver MODULO-VAGAS.md para escalar). */
  async function feed(uid, { cidade, tipo, empresaId } = {}) {
    const agora = Date.now();
    const abertas = (await col("vagas").where("status", "==", "ativa").limit(300).get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((v) => visivel(v, agora));
    const jaFiz = new Map((await col("vagas_candidaturas").where("freelancerUid", "==", uid).limit(500).get()).docs.map((d) => [d.data().vagaId, d.data().status]));
    const uniq = (arr, k) => [...new Map(arr.map((x) => [k(x), x])).values()];
    const filtros = {
      cidades: uniq(abertas, (v) => v.cidadeChave).map((v) => ({ valor: v.cidadeChave, rotulo: `${v.cidade} - ${v.uf}` })).sort((a, b) => a.rotulo.localeCompare(b.rotulo)),
      redes: uniq(abertas, (v) => v.empresaId).map((v) => ({ valor: v.empresaId, rotulo: v.empresaNome })).sort((a, b) => a.rotulo.localeCompare(b.rotulo)),
      tipos: Object.entries(TIPOS).map(([valor, rotulo]) => ({ valor, rotulo }))
    };
    const lista = abertas.filter((v) => (!cidade || v.cidadeChave === cidade) && (!tipo || v.tipo === tipo) && (!empresaId || v.empresaId === empresaId))
      .sort((a, b) => ms(b.publicadaEm) - ms(a.publicadaEm)).map((v) => dtoVaga(v.id, v, { jaCandidatou: jaFiz.has(v.id), statusCandidatura: jaFiz.get(v.id) || null }));
    return { vagas: lista, filtros };
  }

  // ---------------- perfil: divulgação (opt-in LGPD) e currículo ----------------
  const dados = async (uid) => { const [pf, pv] = await Promise.all([col("profissionais").doc(uid).get(), col("profissionais_privado").doc(uid).get()]); return { perfil: pf.data() || null, priv: pv.data() || {} }; };
  const lerCpf = (priv, uid) => { try { return priv.cpfEnc ? Cripto.decifrar(priv.cpfEnc, ctxCpfPerfil(uid)) : null; } catch { return null; } };
  /** O que falta para a pessoa poder se candidatar. Os nomes são os que o app usa para montar o aviso. */
  function faltasDoPerfil(perfil, priv, uid) {
    const falta = [];
    if (String(perfil?.nome || "").trim().split(/\s+/).filter(Boolean).length < 2) falta.push("nome");
    if (!lerCpf(priv, uid)) falta.push("cpf");
    if (priv.aceitaDivulgacaoVagas !== true) falta.push("divulgacao");
    if (!priv.curriculo?.path) falta.push("curriculo");
    return falta;
  }
  async function situacaoPerfil(uid) {
    const { perfil, priv } = await dados(uid), cpf = lerCpf(priv, uid), falta = faltasDoPerfil(perfil, priv, uid);
    return {
      termo: TERMO_DIVULGACAO, aceitaDivulgacao: priv.aceitaDivulgacaoVagas === true, aceitaEm: ms(priv.aceitaDivulgacaoEm) || null,
      curriculo: priv.curriculo?.path ? { bytes: priv.curriculo.bytes, nomeArquivo: priv.curriculo.nomeArquivo || "curriculo.pdf", enviadoEm: ms(priv.curriculo.enviadoEm) || null } : null,
      nomeCompleto: perfil?.nome || "", cpfMascarado: cpf ? V.mascararCPF(cpf) : "", falta, pronto: falta.length === 0, limiteBytes: Curriculo.MAX_BYTES
    };
  }
  /** Aceite/retirada do consentimento. Retirar bloqueia NA HORA o acesso das empresas ao currículo (a checagem é a cada leitura). */
  async function definirConsentimento(uid, aceito, versao) {
    V.booleano(aceito, "aceito");
    if (aceito && versao !== TERMO_DIVULGACAO.versao) throw new Falha(409, "O texto do consentimento foi atualizado. Leia e aceite de novo.", "termo-desatualizado", { termo: TERMO_DIVULGACAO });
    await col("profissionais_privado").doc(uid).set(aceito
      ? { uid, aceitaDivulgacaoVagas: true, aceitaDivulgacaoEm: ts(), aceitaDivulgacaoVersao: TERMO_DIVULGACAO.versao }
      : { uid, aceitaDivulgacaoVagas: false, divulgacaoRevogadaEm: ts() }, { merge: true });
    await marcarCandidaturas(uid, { divulgacaoAtiva: aceito });
  }
  async function marcarCandidaturas(uid, patch) {
    const s = await col("vagas_candidaturas").where("freelancerUid", "==", uid).limit(500).get(); if (s.empty) return;
    const lote = db.batch(); for (const d of s.docs) lote.set(d.ref, patch, { merge: true }); await lote.commit();
  }
  async function salvarCurriculo(uid, dataUrl, nomeArquivo) {
    const pdf = Curriculo.decodificar(dataUrl), caminho = Curriculo.caminhoDoCurriculo(uid, pdf.sha256);
    const nome = V.texto(String(nomeArquivo || "curriculo.pdf").replace(/[\\/]/g, "_"), "nome do arquivo", { max: 100, obrigatorio: false }) || "curriculo.pdf";
    const antigo = (await col("profissionais_privado").doc(uid).get()).data()?.curriculo?.path;
    await armazenamento().salvar(caminho, pdf.buf);
    await col("profissionais_privado").doc(uid).set({ uid, curriculo: { path: caminho, sha256: pdf.sha256, bytes: pdf.bytes, nomeArquivo: nome, enviadoEm: ts() } }, { merge: true });
    // Versão antiga só some se nenhuma candidatura a usa: quem já se candidatou continua com o currículo que enviou.
    if (antigo && antigo !== caminho) {
      const usada = (await col("vagas_candidaturas").where("freelancerUid", "==", uid).get()).docs.some((d) => d.data().curriculo?.path === antigo);
      if (!usada) await armazenamento().apagar(antigo).catch((e) => console.error("vagas: não apagou versão antiga:", e.message));
    }
    return { bytes: pdf.bytes, nomeArquivo: nome };
  }
  async function lerCurriculoProprio(uid) {
    const c = (await col("profissionais_privado").doc(uid).get()).data()?.curriculo;
    if (!c?.path) throw new Falha(404, "Você ainda não enviou um currículo.", "nao-encontrado");
    return armazenamento().ler(c.path);
  }
  /** Direito de apagar (LGPD): remove todas as versões do arquivo e avisa as candidaturas de que o anexo não existe mais. */
  async function apagarCurriculo(uid) {
    await armazenamento().apagarPrefixo(Curriculo.prefixoDoUsuario(uid));
    await col("profissionais_privado").doc(uid).set({ curriculo: FieldValue.delete() }, { merge: true });
    await marcarCandidaturas(uid, { curriculo: { removidoEm: ts() } });
  }

  // ---------------- candidatura ----------------
  /**
   * Candidatura em 1 clique. O servidor — nunca o navegador — faz o CRUZAMENTO: nome completo (profissionais) + CPF (cifrado em
   * profissionais_privado, validado no cadastro) + currículo vigente + consentimento. Tudo vira um instantâneo na candidatura.
   */
  async function candidatar(uid, vagaId) {
    const vref = col("vagas").doc(V.idDoc(vagaId, "id")), v = (await vref.get()).data(); if (!v) throw naoEncontrada();
    if (!visivel(v, Date.now())) throw new Falha(409, "Esta vaga não está mais aberta.", "vaga-encerrada");
    const { perfil, priv } = await dados(uid);
    if (!perfil) throw new Falha(403, "Conclua seu cadastro de profissional para se candidatar.", "sem-cadastro");
    if (perfil.status === "bloqueado") throw new Falha(403, "Sua conta está bloqueada. Fale com o suporte.", "conta-bloqueada");
    const falta = faltasDoPerfil(perfil, priv, uid), cpf = lerCpf(priv, uid);
    if (v.apenasMaiores !== false) {
      let nasc = null; try { nasc = priv.nascimentoEnc ? Cripto.decifrar(priv.nascimentoEnc, `profissionais_privado/nascimento/${uid}`) : null; } catch { /* trata como ausente */ }
      if (!nasc) falta.push("nascimento");
      else if (V.calcularIdade(nasc) < C.IDADE_MAIORIDADE) throw new Falha(403, "Esta vaga é só para maiores de 18 anos.", "vaga-apenas-maiores");
    }
    if (falta.length) throw new Falha(409, "Complete seu perfil para se candidatar.", "perfil-incompleto", { falta });
    if (!V.cpfValido(cpf)) throw new Falha(409, "Confira seu CPF em Meus dados.", "perfil-incompleto", { falta: ["cpf"] });
    const id = `${vagaId}_${uid}`, cref = col("vagas_candidaturas").doc(id);
    await db.runTransaction(async (tx) => {
      if ((await tx.get(cref)).exists) throw new Falha(409, "Você já se candidatou a esta vaga.", "ja-candidatou");
      tx.set(cref, {
        vagaId, empresaId: v.empresaId, vagaTitulo: v.titulo, empresaNome: v.empresaNome, freelancerUid: uid,
        nome: String(perfil.nome).trim(), cpfEnc: Cripto.cifrar(cpf, ctxCpfCandidatura(id)), cpfIdx: Cripto.indiceCego(cpf), cpfMascarado: V.mascararCPF(cpf),
        curriculo: { path: priv.curriculo.path, sha256: priv.curriculo.sha256, bytes: priv.curriculo.bytes, nomeArquivo: priv.curriculo.nomeArquivo || "curriculo.pdf" },
        divulgacaoAtiva: true, termoVersao: priv.aceitaDivulgacaoVersao || TERMO_DIVULGACAO.versao, status: "pendente", criadoEm: ts(), atualizadoEm: ts()
      });
      tx.update(vref, { candidaturasTotal: FieldValue.increment(1) });
    });
    return { id, status: "pendente" };
  }
  async function minhasCandidaturas(uid) {
    const s = await col("vagas_candidaturas").where("freelancerUid", "==", uid).limit(200).get();
    return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.criadoEm) - ms(a.criadoEm))
      .map((c) => ({ id: c.id, vagaId: c.vagaId, vaga: c.vagaTitulo, empresa: c.empresaNome, status: c.status, candidatouEm: ms(c.criadoEm) || null }));
  }
  const dtoCandidatura = (id, c) => ({
    id, vagaId: c.vagaId, vaga: c.vagaTitulo, empresa: c.empresaNome, nome: c.nome, cpfMascarado: c.cpfMascarado, status: c.status, candidatouEm: ms(c.criadoEm) || null,
    divulgacaoAtiva: c.divulgacaoAtiva !== false, temCurriculo: !!c.curriculo?.path && !c.curriculo?.removidoEm && c.divulgacaoAtiva !== false, curriculoRemovido: !!c.curriculo?.removidoEm, curriculoBytes: c.curriculo?.bytes || 0
  });
  /** Candidatos de uma vaga (admin: qualquer vaga; empresa: só as suas). CPF nunca sai completo daqui. */
  async function listarCandidaturas(vagaId, { empresaId = null, status, q, cpf } = {}) {
    const v = (await col("vagas").doc(V.idDoc(vagaId, "id")).get()).data();
    if (!v || (empresaId && v.empresaId !== empresaId)) throw naoEncontrada();
    if (status) V.opcao(status, STATUS_CANDIDATURA, "status");
    const idx = cpf ? Cripto.indiceCego(V.cpf(cpf)) : null, busca = semAcento(q || "");
    const s = await col("vagas_candidaturas").where("vagaId", "==", vagaId).limit(1000).get();
    return {
      vaga: dtoVagaGestao(vagaId, v),
      candidaturas: s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => (!status || c.status === status) && (!busca || semAcento(c.nome).includes(busca)) && (!idx || c.cpfIdx === idx))
        .sort((a, b) => ms(b.criadoEm) - ms(a.criadoEm)).map((c) => dtoCandidatura(c.id, c))
    };
  }
  async function candidaturaDe(id, empresaId = null) {
    const ref = col("vagas_candidaturas").doc(V.idDoc(id, "id")), c = (await ref.get()).data();
    if (!c || (empresaId && c.empresaId !== empresaId)) throw naoEncontrada("Candidatura");   // 404 (não 403): não revela que existe
    return { ref, c };
  }
  async function mudarStatusCandidatura(id, status, { uid, empresaId = null }) {
    V.opcao(status, STATUS_CANDIDATURA, "status");
    const { ref, c } = await candidaturaDe(id, empresaId);
    await ref.set({ status, atualizadoEm: ts(), statusPor: uid }, { merge: true });
    return { id, de: c.status, status };
  }
  /** Currículo da candidatura. Revalida o consentimento A CADA leitura: retirou a autorização → ninguém mais abre. */
  async function curriculoDaCandidatura(id, empresaId = null) {
    const { c } = await candidaturaDe(id, empresaId);
    if (!c.curriculo?.path || c.curriculo.removidoEm) throw new Falha(404, "O candidato removeu o currículo.", "curriculo-removido");
    const priv = (await col("profissionais_privado").doc(c.freelancerUid).get()).data() || {};
    if (priv.aceitaDivulgacaoVagas !== true) throw new Falha(403, "O candidato retirou a autorização de divulgação do currículo.", "divulgacao-revogada");
    return armazenamento().ler(c.curriculo.path);
  }
  async function revelarCpf(id) {
    const { c } = await candidaturaDe(id);
    return Cripto.decifrar(c.cpfEnc, ctxCpfCandidatura(id));
  }

  return {
    TIPOS, STATUS_VAGA, STATUS_CANDIDATURA, MODERACAO, TERMO_DIVULGACAO, CONFIG_PADRAO,
    lerConfig, salvarConfig, faseGratuitaAtiva, criarEmpresa, listarEmpresas, empresaDaLoja, ajustarPlano,
    criarVaga, atualizarVaga, mudarStatus, moderar, listarGestao, encerrarExpiradas, feed,
    situacaoPerfil, definirConsentimento, salvarCurriculo, lerCurriculoProprio, apagarCurriculo,
    candidatar, minhasCandidaturas, listarCandidaturas, mudarStatusCandidatura, curriculoDaCandidatura, revelarCpf, empresaPorId
  };
}

module.exports = { criarVagas, TIPOS, UFS, TERMO_DIVULGACAO, CONFIG_PADRAO, chaveCidade };
