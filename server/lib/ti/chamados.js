// Chamados de TI. Quem abre: lojas, promotores e admins (POST /chamados) ou a própria equipe em nome de alguém (POST /ti/chamados).
//   chamados_ti/{id}                 o chamado (estado, prioridade, SLA, responsável, tempos)
//   chamados_ti/{id}/eventos/{evId}  linha do tempo (criado, assumido, comentário, mudança de status…) — `interno: true` nunca chega ao usuário
//   contadores/chamados_ti|_adm|_suporte  { n } — número do protocolo por departamento (TI-000123, ADM-000045, SUP-000012)
//   chamados_ti_dedupe/{hash}        mesmo erro, mesmo usuário, 1 h → reaproveita o chamado
// Todo chamado pertence a UM departamento (`departamento`: ti | adm | suporte; sem o campo = ti). Os automáticos nascem já roteados (roteador.js).
// Toda mudança roda em UMA transação que atualiza o chamado, a linha do tempo e as métricas agregadas (ver metricas.js).
const crypto = require("crypto");
const { Falha } = require("../erros");
const K = require("./constantes");
const { redigir, cortar } = require("./redacao");
const { sanitizarContexto } = require("./bug-contexto");
const { classificarBug, LIMITE_AFETADOS, LIMITE_OCORRENCIAS } = require("./classificador");
const roteador = require("./roteador");
const { redigir: redigirLogs } = require("./redigir");

function criarChamados({ db, FieldValue, Timestamp, V, metricas }) {
  const COL = "chamados_ti";
  const ref = (id) => db.collection(COL).doc(id);
  const evCol = (id) => db.collection(`${COL}/${id}/eventos`);
  let ultimo = 0;   // ids de evento estritamente crescentes (ordem cronológica = ordem do id)
  const novoEv = () => { ultimo = Math.max(Date.now(), ultimo + 1); return `${String(ultimo).padStart(13, "0")}_${crypto.randomBytes(3).toString("hex")}`; };
  const SISTEMA = { uid: "SISTEMA", nome: "Sistema", nivel: "gestor" };
  const sla = (prioridade, baseMs) => ({ atendMs: baseMs + K.SLA_MIN[prioridade].atend * 60_000, resolMs: baseMs + K.SLA_MIN[prioridade].resol * 60_000 });
  const toIso = (m) => (m ? new Date(m).toISOString() : null);
  const falhaEstado = (de, para) => new Falha(409, `Não é possível ir de "${de}" para "${para}".`, "transicao-invalida", { de, para });

  const depDe = (t) => t.departamento || K.DEPARTAMENTO_PADRAO;   // chamados antigos (anteriores ao roteador) não têm o campo: são do TI
  const visaoTI = (t) => ({ id: t.id, protocolo: t.protocolo, titulo: t.titulo, descricao: t.descricao, categoria: t.categoria, prioridade: t.prioridade, status: t.status, origem: t.origem,
    departamento: depDe(t), setor: K.DEPARTAMENTO_NOME[depDe(t)], classificacao: t.classificacao ? { motivo: t.classificacao.motivo, confianca: t.classificacao.confianca, sinais: t.classificacao.sinais || [], automatica: t.classificacao.automatica !== false } : null, transferencias: t.transferencias || 0,
    solicitante: { uid: t.solicitanteUid || "", tipo: t.solicitanteTipo || "", nome: t.solicitanteNome || "" }, atribuidoUid: t.atribuidoUid || "", atribuidoNome: t.atribuidoNome || "",
    criadoEm: toIso(t.criadoMs), atualizadoEm: toIso(t.atualizadoMs), atendidoEm: toIso(t.atendidoMs), resolvidoEm: toIso(t.resolvidoMs), tempoAtendSeg: t.tempoAtendSeg ?? null, tempoResolSeg: t.tempoResolSeg ?? null,
    slaAtendEm: toIso(t.slaAtendMs), slaResolEm: toIso(t.slaResolMs), reaberturas: t.reaberturas || 0, resolucao: t.resolucao || "", comentarios: t.nComentarios || 0, bug: t.bug || null, fila: t.filaDestino || "", suporteProtocolo: t.suporteProtocolo || "" });
  /** O que o SOLICITANTE vê: sem notas internas, sem SLA, sem dados de outros usuários. */
  const visaoUsuario = (t) => ({ id: t.id, protocolo: t.protocolo, titulo: t.titulo, descricao: t.descricao, categoria: t.categoria, status: t.status, departamento: depDe(t), setor: K.DEPARTAMENTO_NOME[depDe(t)], mensagem: t.mensagemAmigavel || "", criadoEm: toIso(t.criadoMs), atualizadoEm: toIso(t.atualizadoMs), resolvidoEm: toIso(t.resolvidoMs), resolucao: t.resolucao || "" });
  const visaoEv = (e) => ({ id: e.id, tipo: e.tipo, autor: e.autorNome, autorTipo: e.autorTipo, texto: e.texto || "", interno: !!e.interno, de: e.de || "", para: e.para || "", em: toIso(e.emMs) });

  // ---------- criação ----------
  /**
   * `solicitante`: { uid, tipo: "loja"|"promotor"|"admin"|"ti"|"externo", nome }. `criador`: quem registrou (o próprio usuário ou o operador).
   * `departamento` (padrão "ti") escolhe a fila, o prefixo e o contador do protocolo. `extra(protocolo)` devolve campos que dependem do protocolo
   * (mensagem amigável) e `registro` guarda a classificação e os logs técnicos — ambos só para os automáticos.
   */
  async function criar({ titulo, descricao, categoria, prioridade }, { solicitante, origem, criador, departamento = K.DEPARTAMENTO_PADRAO, registro = {}, extra }) {
    departamento = V.opcao(departamento, K.DEPARTAMENTOS, "departamento");
    titulo = V.texto(titulo, "título", { min: 5, max: 120 }); descricao = V.texto(descricao, "descrição", { min: 10, max: 2000 });
    categoria = V.opcao(categoria || "outro", K.CATEGORIAS, "categoria"); prioridade = V.opcao(prioridade || "media", K.PRIORIDADES, "prioridade");
    const r = db.collection(COL).doc(), agora = Date.now(), s = sla(prioridade, agora);
    const nome = V.texto(solicitante.nome || "", "solicitante", { max: 100, obrigatorio: false }) || solicitante.tipo;
    return db.runTransaction(async (tx) => {
      const cref = db.collection("contadores").doc(K.CONTADOR[departamento]), n = ((await tx.get(cref)).data()?.n || 0) + 1;
      const protocolo = `${K.PREFIXO_PROTOCOLO[departamento]}-${String(n).padStart(6, "0")}`;
      const t = { id: r.id, protocolo, departamento, ...registro, ...(typeof extra === "function" ? extra(protocolo) : extra || {}), titulo, descricao, categoria, prioridade, status: "aberto", origem, solicitanteUid: solicitante.uid || "", solicitanteTipo: solicitante.tipo, solicitanteNome: nome,
        atribuidoUid: "", atribuidoNome: "", criadoMs: agora, atualizadoMs: agora, slaAtendMs: s.atendMs, slaResolMs: s.resolMs, atendidoMs: null, tempoAtendSeg: null, resolvidoMs: null, tempoResolSeg: null, pausadoSeg: 0, pausadoDesdeMs: null, reaberturas: 0, resolucao: "", nComentarios: 0 };
      tx.set(cref, { n }, { merge: true });
      tx.set(r, { ...t, criadoEm: Timestamp.fromMillis(agora), atualizadoEm: Timestamp.fromMillis(agora) });
      tx.set(evCol(r.id).doc(novoEv()), { tipo: "criado", autorUid: criador.uid, autorNome: criador.nome || "", autorTipo: criador.tipo, texto: "", interno: false, emMs: agora, em: Timestamp.fromMillis(agora) });
      if (departamento === K.DEPARTAMENTO_PADRAO) metricas.aplicarCriacao(tx, { ms: agora, prioridade });   // métricas e ranking de hoje são do time de TI
      return t;
    });
  }

  // ---------- abertura AUTOMÁTICA (erro capturado no app) ----------
  const JANELA_DEDUPE_MS = 60 * 60_000;   // mesmo erro, mesmo usuário, dentro de 1 h → reaproveita o chamado (não gera fila de duplicados)
  const PREFIXO_BUG = "[AUTO-BUG]";
  const tituloBug = (t) => cortar(`${PREFIXO_BUG} ${String(t || "").replace(/^\s*(\[AUTO-BUG\]\s*)+/i, "").replace(/^Erro automático:\s*/i, "").trim() || "Erro no aplicativo"}`, 120);
  const hashUid = (uid) => crypto.createHash("sha256").update(String(uid)).digest("hex").slice(0, 12);   // contagem de pessoas sem guardar o uid em claro
  const MAX_USUARIOS = 50, MAX_CHAMADOS = 25;

  /**
   * ALCANCE do erro: quantas PESSOAS distintas e quantas vezes (janela deslizante de 1 h sem novidade). Doc `bug_impressoes/{impressão}`.
   * É a única medida que o navegador não consegue forjar. Transação própria (só leitura + escrita de 1 doc) para não perder contagens simultâneas.
   */
  function contarAlcance(impressao, uid, { novaOcorrencia = true } = {}) {
    const r = db.collection("bug_impressoes").doc(impressao);
    return db.runTransaction(async (tx) => {
      const agora = Date.now(), d = (await tx.get(r)).data(), vivo = d && d.ultimaMs > agora - JANELA_DEDUPE_MS;
      const base = vivo ? d : { impressao, primeiraMs: agora, ocorrencias: 0, usuarios: [], afetados: 0, chamados: [], escalado: false };
      const h = hashUid(uid), novo = !base.usuarios.includes(h);
      const n = { ...base, ultimaMs: agora, ocorrencias: base.ocorrencias + (novaOcorrencia ? 1 : 0),
        usuarios: novo && base.usuarios.length < MAX_USUARIOS ? [...base.usuarios, h] : base.usuarios, afetados: base.afetados + (novo ? 1 : 0) };
      tx.set(r, n); return n;
    });
  }
  const anexarChamado = (impressao, id) => db.runTransaction(async (tx) => {
    const r = db.collection("bug_impressoes").doc(impressao), d = (await tx.get(r)).data(); if (!d) return;
    tx.set(r, { ...d, chamados: [...d.chamados.filter((x) => x !== id), id].slice(-MAX_CHAMADOS) });
  });
  /** Quando o alcance cruza o limite, TODOS os chamados abertos do mesmo erro sobem para crítica (uma única vez por janela). */
  async function escalarSeNecessario(impressao, alcance, extraIds = []) {
    if (alcance.escalado || (alcance.afetados < LIMITE_AFETADOS && alcance.ocorrencias < LIMITE_OCORRENCIAS)) return;
    const motivo = alcance.afetados >= LIMITE_AFETADOS ? `atinge ${alcance.afetados} usuários` : `repetiu ${alcance.ocorrencias} vezes`;
    const ref = db.collection("bug_impressoes").doc(impressao);
    await db.runTransaction(async (tx) => { const d = (await tx.get(ref)).data(); if (d) tx.set(ref, { ...d, escalado: true }); });
    for (const id of new Set([...alcance.chamados, ...extraIds])) {
      try { await alterarPrioridade(id, SISTEMA, "critica", `Escalonado automaticamente: ${motivo} na última hora.`); }
      catch (e) { /* já crítica, resolvido ou cancelado: nada a fazer */ }
    }
  }

  /**
   * Abre um chamado `[AUTO-BUG]` (categoria bug, origem automatico) a partir de um erro capturado no navegador.
   *   `impressao`: assinatura estável do erro (calculada no cliente). A mesma assinatura do mesmo usuário reaproveita o chamado aberto
   *   na última hora e devolve o MESMO protocolo (`repetido: true`): um erro em loop não inunda a fila nem esgota o limite.
   *   `contexto`: rota, versão, dispositivo, stack… — saneado aqui (nunca confiável). Usuário e perfil vêm do token, não do corpo.
   *   A prioridade é decidida pelo servidor (classificador.js) e define o SLA do chamado.
   * O corte de tamanho é feito aqui (e não só no cliente) para que um relatório longo nunca vire 400 justamente na hora do erro.
   */
  const str = (v, n) => (typeof v === "string" ? v : v == null || typeof v === "object" ? "" : String(v)).slice(0, n);
  /** Campos técnicos que o app mandou (`erro`) ou, em cliente antigo, o que dá para extrair do texto do relatório. Tudo redigido (LGPD) e limitado. */
  function montarLogs({ erro, descricao, impressao }) {
    const e = erro && typeof erro === "object" && !Array.isArray(erro) ? erro : {};
    const d = roteador.extrairDaDescricao(descricao);
    const pega = (k, n) => redigirLogs(str(e[k], n) || str(d[k], n));
    return { nome: pega("nome", 80), mensagem: pega("mensagem", 600), origem: pega("origem", 40), rota: redigirLogs(str(e.rota, 140)), status: Number(e.status) || 0, codigo: str(e.codigo, 60), arquivo: redigirLogs(str(e.arquivo, 200)),
      stack: pega("stack", 3000), tela: pega("tela", 60), perfil: pega("perfil", 20), impressao };
  }
  async function abrirAutomatico({ impressao, titulo, descricao, contexto, erro }, { solicitante }) {
    impressao = V.texto(impressao, "impressão", { min: 6, max: 64, re: /^[a-z0-9]+$/i });
    titulo = V.texto(tituloBug(titulo), "título", { min: 5, max: 120 });
    descricao = V.texto(redigir(String(descricao || "")).slice(0, 2000), "descrição", { min: 10, max: 2000 });
    const dref = db.collection("chamados_ti_dedupe").doc(crypto.createHash("sha256").update(`${solicitante.uid}|${impressao}`).digest("hex"));
    const atual = (await dref.get()).data();
    if (atual && atual.ateMs > Date.now()) {
      const alc = await contarAlcance(impressao, solicitante.uid);        // a repetição também conta (pode cruzar o limite de ocorrências)
      await escalarSeNecessario(impressao, alc, [atual.chamadoId]);
      const dep = atual.departamento || K.DEPARTAMENTO_PADRAO, pri = atual.prioridade || "media";
      return { id: atual.chamadoId, protocolo: atual.protocolo, repetido: true, departamento: dep, prioridade: pri, mensagem: roteador.mensagemParaUsuario({ departamento: dep, protocolo: atual.protocolo, prioridade: pri, repetido: true }) };
    }
    const alcance = await contarAlcance(impressao, solicitante.uid);
    const logs = montarLogs({ erro, descricao, impressao });                                    // campos técnicos redigidos (LGPD)
    const c = roteador.classificarErro({ ...logs, codigo: logs.codigo, perfil: logs.perfil || solicitante.tipo });   // departamento: decidido só aqui
    const bug = sanitizarContexto(contexto, { uid: solicitante.uid, tipo: solicitante.tipo, impressao, stack: String(descricao.split("Stack:\n")[1] || logs.stack || "") });
    const cls = classificarBug({ nome: bug.nome || logs.nome, mensagem: bug.mensagem || logs.mensagem || titulo, origem: bug.origem || logs.origem, rota: bug.rota || logs.rota, perfil: bug.perfil || logs.perfil, afetados: alcance.afetados, ocorrencias: alcance.ocorrencias });
    bug.ocorrencias = alcance.ocorrencias; bug.afetados = alcance.afetados; bug.classificacao = cls;
    const ehTI = c.departamento === K.DEPARTAMENTO_PADRAO;
    // Prioridade: na fila de TI vale o classificador de bugs (alcance + fluxo financeiro; "falha tratada" = baixa); nas filas ADM/Suporte, a do roteador.
    // O roteador pode ELEVAR para "alta" (dinheiro/infra) e o alcance pode elevar para "crítica" em qualquer fila.
    let prioridade = ehTI ? cls.prioridade : c.prioridade;
    if (c.prioridade === "alta" && prioridade !== "critica") prioridade = "alta";
    if (cls.prioridade === "critica") prioridade = "critica";
    if (!ehTI) titulo = titulo.replace(/^\[AUTO-BUG\]\s*/, "");                                  // o selo AUTO-BUG é da fila de TI
    const texto = (protocolo) => roteador.mensagemParaUsuario({ departamento: c.departamento, protocolo, prioridade });
    const t = await criar({ titulo, descricao, categoria: ehTI ? "bug" : c.categoria, prioridade }, {
      solicitante, origem: "automatico", criador: solicitante, departamento: c.departamento,
      registro: { classificacao: { departamento: c.departamento, categoria: c.categoria, prioridade: c.prioridade, confianca: c.confianca, motivo: c.motivo, sinais: c.sinais, pontos: c.pontos, versao: c.versao, automatica: true }, logsTecnicos: logs },
      extra: (protocolo) => ({ bug, mensagemAmigavel: `${texto(protocolo).titulo}. ${texto(protocolo).texto}` })
    });
    await dref.set({ chamadoId: t.id, protocolo: t.protocolo, uid: solicitante.uid, ateMs: Date.now() + JANELA_DEDUPE_MS, departamento: t.departamento, prioridade: t.prioridade });
    await anexarChamado(impressao, t.id);
    await escalarSeNecessario(impressao, { ...alcance, chamados: [...alcance.chamados, t.id] });
    return { id: t.id, protocolo: t.protocolo, repetido: false, departamento: t.departamento, prioridade: t.prioridade, mensagem: texto(t.protocolo), chamado: t, classificacao: c };
  }

  // ---------- transação genérica ----------
  /** `fn(t, agora)` valida e devolve { patch, evento, metrica?(tx) }; qualquer Falha cancela a transação inteira. */
  async function aplicar(id, ator, fn) {
    V.idDoc(id, "id");
    return db.runTransaction(async (tx) => {
      const t = (await tx.get(ref(id))).data(); if (!t) throw new Falha(404, "Chamado não encontrado.", "nao-encontrado");
      const agora = Date.now(), { patch, evento, metrica } = fn(t, agora);
      tx.update(ref(id), { ...patch, atualizadoMs: agora, atualizadoEm: Timestamp.fromMillis(agora) });
      tx.set(evCol(id).doc(novoEv()), { autorUid: ator.uid, autorNome: ator.nome || "", autorTipo: ator.tipo || "ti", interno: false, ...evento, emMs: agora, em: Timestamp.fromMillis(agora) });
      if (depDe(t) === K.DEPARTAMENTO_PADRAO) metrica?.(tx, agora);   // TMA/TMR/ranking do painel de TI contam só chamados do TI
      return { ...t, ...patch, atualizadoMs: agora };
    });
  }
  const gestor = (a) => a.nivel === "gestor";
  const donoOuGestor = (t, a) => { if (t.atribuidoUid && t.atribuidoUid !== a.uid && !gestor(a)) throw new Falha(403, `Este chamado está com ${t.atribuidoNome || "outro operador"}.`, "nao-e-seu"); };
  /** Primeira vez que alguém assume: fixa o tempo de atendimento e credita o operador. */
  const primeiroAtendimento = (t, agora, op) => {
    if (t.atendidoMs) return { patch: {}, metrica: null };
    const seg = Math.max(0, Math.round((agora - t.criadoMs) / 1000));
    return { patch: { atendidoMs: agora, tempoAtendSeg: seg }, metrica: (tx, ms) => metricas.aplicarAtendimento(tx, { ms, uid: op.uid, nome: op.nome, seg, noPrazo: agora <= t.slaAtendMs }) };
  };

  const assumir = (id, ator) => aplicar(id, ator, (t, agora) => {
    if (t.status === "aberto" || (t.status === "em_atendimento" && !t.atribuidoUid)) { /* ok */ }
    else if (t.atribuidoUid && t.atribuidoUid !== ator.uid) throw new Falha(409, `Já está com ${t.atribuidoNome}.`, "ja-atribuido");
    else throw falhaEstado(t.status, "em_atendimento");
    const pa = primeiroAtendimento(t, agora, ator);
    return { patch: { status: "em_atendimento", atribuidoUid: ator.uid, atribuidoNome: ator.nome, ...pa.patch }, evento: { tipo: "assumido", texto: "" }, metrica: pa.metrica };
  });

  const atribuir = (id, ator, alvo) => aplicar(id, ator, (t, agora) => {
    if (!["aberto", "em_atendimento", "aguardando_usuario"].includes(t.status)) throw falhaEstado(t.status, "atribuído");
    if (t.atribuidoUid === alvo.uid) throw new Falha(409, "O chamado já está com este operador.", "ja-atribuido");
    const pa = primeiroAtendimento(t, agora, alvo);
    return { patch: { atribuidoUid: alvo.uid, atribuidoNome: alvo.nome, status: t.status === "aberto" ? "em_atendimento" : t.status, ...pa.patch }, evento: { tipo: "atribuido", texto: `Encaminhado para ${alvo.nome}`, para: alvo.nome, de: t.atribuidoNome || "" }, metrica: pa.metrica };
  });

  const mudarStatus = (id, ator, para, nota = "") => aplicar(id, ator, (t, agora) => {
    para = V.opcao(para, K.STATUS, "status");
    if (!K.TRANSICOES[t.status].includes(para)) throw falhaEstado(t.status, para);
    if (!t.atribuidoUid && !gestor(ator) && para !== "em_atendimento") throw new Falha(409, "Assuma o chamado antes de alterá-lo.", "assuma-primeiro");
    donoOuGestor(t, ator);
    const texto = V.texto(nota, "nota", { max: 1000, min: para === "resolvido" || para === "cancelado" ? 5 : 0 });
    const patch = { status: para }; let metrica = null;
    // saindo de "aguardando usuário": o tempo parado não conta para o prazo de resolução (empurra o SLA)
    if (t.status === "aguardando_usuario") { const parado = Math.max(0, Math.round((agora - (t.pausadoDesdeMs || agora)) / 1000)); patch.pausadoSeg = (t.pausadoSeg || 0) + parado; patch.pausadoDesdeMs = null; patch.slaResolMs = t.slaResolMs + parado * 1000; }
    if (para === "aguardando_usuario") patch.pausadoDesdeMs = agora;
    if (para === "aberto") { patch.atribuidoUid = ""; patch.atribuidoNome = ""; patch.slaAtendMs = agora + K.SLA_MIN[t.prioridade].atend * 60_000; }   // voltou para a fila: novo prazo de pegada
    if (para === "em_atendimento" && t.status === "resolvido") { patch.reaberturas = (t.reaberturas || 0) + 1; patch.resolvidoMs = null; patch.tempoResolSeg = null; patch.resolucao = ""; patch.slaResolMs = agora + K.SLA_MIN[t.prioridade].resol * 60_000; }
    if (para === "em_atendimento" && !t.atribuidoUid) { patch.atribuidoUid = ator.uid; patch.atribuidoNome = ator.nome; const pa = primeiroAtendimento(t, agora, ator); Object.assign(patch, pa.patch); metrica = pa.metrica; }
    if (para === "resolvido") {
      const credito = t.atribuidoUid ? { uid: t.atribuidoUid, nome: t.atribuidoNome } : ator;
      const pausadoFinal = patch.pausadoSeg ?? t.pausadoSeg ?? 0, slaFinal = patch.slaResolMs ?? t.slaResolMs;
      const seg = Math.max(0, Math.round((agora - t.criadoMs) / 1000) - pausadoFinal);
      Object.assign(patch, { resolvidoMs: agora, tempoResolSeg: seg, resolucao: texto });
      metrica = (tx, ms) => metricas.aplicarResolucao(tx, { ms, uid: credito.uid, nome: credito.nome, seg, noPrazo: agora <= slaFinal });
    }
    if (para === "cancelado") metrica = (tx, ms) => metricas.aplicarCancelamento(tx, { ms });
    return { patch, evento: { tipo: "status", de: t.status, para, texto }, metrica };
  });

  const comentar = (id, ator, texto, interno = true) => aplicar(id, ator, (t) => {
    if (t.status === "cancelado") throw new Falha(409, "Chamado cancelado.", "estado-invalido");
    return { patch: { nComentarios: (t.nComentarios || 0) + 1 }, evento: { tipo: "comentario", texto: V.texto(texto, "comentário", { min: 1, max: 1000 }), interno: !!interno } };
  });

  const alterarPrioridade = (id, ator, prioridade, motivo = "") => aplicar(id, ator, (t) => {
    prioridade = V.opcao(prioridade, K.PRIORIDADES, "prioridade");
    if (!["aberto", "em_atendimento", "aguardando_usuario"].includes(t.status)) throw falhaEstado(t.status, "outra prioridade");
    if (t.prioridade === prioridade) throw new Falha(409, "Já está com esta prioridade.", "sem-mudanca");
    const s = sla(prioridade, t.criadoMs);
    return { patch: { prioridade, ...(t.atendidoMs ? {} : { slaAtendMs: s.atendMs }), slaResolMs: s.resolMs + (t.pausadoSeg || 0) * 1000 }, evento: { tipo: "prioridade", de: t.prioridade, para: prioridade, texto: `Prioridade: ${t.prioridade} → ${prioridade}${motivo ? ` — ${V.texto(motivo, "motivo", { max: 200 })}` : ""}` } };
  });

  /** Resposta do SOLICITANTE (só no próprio chamado). Se estava "aguardando usuário", o atendimento é retomado. */
  const responderComoUsuario = (id, usuario, texto) => aplicar(id, { uid: usuario.uid, nome: usuario.nome, tipo: usuario.tipo }, (t, agora) => {
    if (t.solicitanteUid !== usuario.uid) throw new Falha(404, "Chamado não encontrado.", "nao-encontrado");
    if (!["aberto", "em_atendimento", "aguardando_usuario"].includes(t.status)) throw new Falha(409, "Este chamado já foi encerrado. Abra um novo, se precisar.", "estado-invalido");
    const patch = { nComentarios: (t.nComentarios || 0) + 1 };
    if (t.status === "aguardando_usuario") { const parado = Math.max(0, Math.round((agora - (t.pausadoDesdeMs || agora)) / 1000)); Object.assign(patch, { status: t.atribuidoUid ? "em_atendimento" : "aberto", pausadoSeg: (t.pausadoSeg || 0) + parado, pausadoDesdeMs: null, slaResolMs: t.slaResolMs + parado * 1000 }); }
    return { patch, evento: { tipo: "comentario", texto: V.texto(texto, "mensagem", { min: 1, max: 1000 }), interno: false } };
  });

  /**
   * Muda o chamado de departamento (o roteador automático pode errar; uma pessoa corrige). O protocolo NÃO muda: a pessoa já o recebeu.
   * Volta para a fila do novo setor, sem responsável e com novo prazo de primeiro atendimento. A decisão do roteador fica preservada em `classificacao`.
   */
  const transferir = (id, ator, para, nota) => aplicar(id, ator, (t, agora) => {
    para = V.opcao(para, K.DEPARTAMENTOS, "departamento"); const de = depDe(t);
    if (de === para) throw new Falha(409, "O chamado já está neste departamento.", "sem-mudanca");
    if (!K.STATUS_ABERTOS.includes(t.status)) throw falhaEstado(t.status, "outro departamento");
    donoOuGestor(t, ator);
    const texto = V.texto(nota, "motivo", { min: 5, max: 500 });
    const patch = { departamento: para, status: "aberto", atribuidoUid: "", atribuidoNome: "", slaAtendMs: agora + K.SLA_MIN[t.prioridade].atend * 60_000, transferencias: (t.transferencias || 0) + 1 };
    if (t.status === "aguardando_usuario") { const parado = Math.max(0, Math.round((agora - (t.pausadoDesdeMs || agora)) / 1000)); patch.pausadoSeg = (t.pausadoSeg || 0) + parado; patch.pausadoDesdeMs = null; patch.slaResolMs = t.slaResolMs + parado * 1000; }
    return { patch, evento: { tipo: "transferido", de, para, texto: `Transferido de ${K.DEPARTAMENTO_NOME[de]} para ${K.DEPARTAMENTO_NOME[para]}: ${texto}`, interno: true } };
  });
  /** Nota interna gravada pelo sistema (ex.: quem foi notificado). Não passa por transação: é só registro, e falhar aqui nunca pode afetar o chamado. */
  async function anotar(id, texto) {
    try { const agora = Date.now(); await evCol(id).doc(novoEv()).set({ tipo: "notificacao", autorUid: SISTEMA.uid, autorNome: SISTEMA.nome, autorTipo: "ti", texto: String(texto).slice(0, 1000), interno: true, emMs: agora, em: Timestamp.fromMillis(agora) }); }
    catch (e) { console.warn("anotar:", e.message); }
  }

  /** Chamados em andamento de um operador voltam para a fila (usado ao excluir o operador). */
  async function devolverFila(operadorUid, ator = SISTEMA) {
    const s = await db.collection(COL).where("atribuidoUid", "==", operadorUid).where("status", "in", ["em_atendimento", "aguardando_usuario"]).limit(200).get();
    let n = 0; for (const d of s.docs) { try { await mudarStatus(d.id, { ...ator, nivel: "gestor" }, "aberto", "Devolvido à fila: operador removido da equipe."); n++; } catch (e) { console.warn("devolverFila:", d.id, e.message); } }
    return n;
  }

  // ---------- leitura ----------
  const peso = (t) => K.PESO_PRIORIDADE[t.prioridade] || 0;
  /** visao: "abertos" (fila de trabalho, mais urgentes primeiro) | "resolvidos" (paginado) | "todos" (recentes). Filtros extras são aplicados sobre a página. */
  async function listar({ visao = "abertos", prioridade, atribuidoUid, categoria, origem, departamento, departamentos, q, limite = 100, cursor } = {}) {
    V.opcao(visao, ["abertos", "resolvidos", "todos"], "visão"); if (prioridade) V.opcao(prioridade, K.PRIORIDADES, "prioridade"); if (categoria) V.opcao(categoria, K.CATEGORIAS, "categoria"); if (origem) V.opcao(origem, ["automatico", "usuario", "ti"], "origem");
    const deps = [...new Set([].concat(departamentos || departamento || []))].map((d) => V.opcao(d, K.DEPARTAMENTOS, "departamento"));
    // "ti" inclui os chamados antigos, que não têm o campo: filtro em memória (a fila de abertos é pequena). adm/suporte filtram no banco (índices em firestore.indexes.json).
    const emMemoria = deps.includes("ti") && deps.length < K.DEPARTAMENTOS.length, noBanco = !emMemoria && deps.length > 0 && deps.length < K.DEPARTAMENTOS.length;
    limite = Math.max(1, Math.min(Number(limite) || 100, visao === "abertos" ? 300 : 100));
    let consulta = db.collection(COL);
    if (noBanco) consulta = deps.length === 1 ? consulta.where("departamento", "==", deps[0]) : consulta.where("departamento", "in", deps);
    if (visao === "abertos") consulta = consulta.where("status", "in", K.STATUS_ABERTOS).orderBy("criadoMs", "asc");
    else if (visao === "resolvidos") { consulta = consulta.where("status", "==", "resolvido"); if (cursor) consulta = consulta.where("resolvidoMs", "<", Number(cursor)); consulta = consulta.orderBy("resolvidoMs", "desc"); }
    else { if (cursor) consulta = consulta.where("criadoMs", "<", Number(cursor)); consulta = consulta.orderBy("criadoMs", "desc"); }
    const s = await consulta.limit(limite + 1).get(), todos = s.docs.map((d) => d.data()), pagina = todos.slice(0, limite);
    const termo = String(q || "").trim().toLowerCase();
    let itens = pagina.filter((t) => (!emMemoria || deps.includes(depDe(t))) && (!prioridade || t.prioridade === prioridade) && (!categoria || t.categoria === categoria) && (!origem || t.origem === origem) && (!atribuidoUid || (atribuidoUid === "nenhum" ? !t.atribuidoUid : t.atribuidoUid === atribuidoUid))
      && (!termo || `${t.protocolo} ${t.titulo} ${t.solicitanteNome}`.toLowerCase().includes(termo)));
    if (visao === "abertos") itens = itens.sort((a, b) => peso(b) - peso(a) || a.criadoMs - b.criadoMs);
    const ultimaPagina = pagina[pagina.length - 1];
    return { itens: itens.map(visaoTI), truncado: todos.length > limite, proximo: visao !== "abertos" && todos.length > limite ? String(visao === "resolvidos" ? ultimaPagina.resolvidoMs : ultimaPagina.criadoMs) : null };
  }

  async function detalhe(id) {
    const t = (await ref(V.idDoc(id, "id")).get()).data(); if (!t) throw new Falha(404, "Chamado não encontrado.", "nao-encontrado");
    const ev = (await evCol(id).orderBy("__name__", "asc").limit(300).get()).docs.map((d) => visaoEv({ id: d.id, ...d.data() }));
    return { ...visaoTI(t), mensagemAmigavel: t.mensagemAmigavel || "", logsTecnicos: t.logsTecnicos || null, eventos: ev };
  }

  const meus = async (uid) => (await db.collection(COL).where("solicitanteUid", "==", uid).orderBy("criadoMs", "desc").limit(30).get()).docs.map((d) => visaoUsuario(d.data()));
  async function detalheDoUsuario(uid, id) {
    const t = (await ref(V.idDoc(id, "id")).get()).data(); if (!t || t.solicitanteUid !== uid) throw new Falha(404, "Chamado não encontrado.", "nao-encontrado");   // IDOR: chamado alheio = 404
    const ev = (await evCol(id).orderBy("__name__", "asc").limit(300).get()).docs.map((d) => visaoEv({ id: d.id, ...d.data() })).filter((e) => !e.interno)
      .map((e) => ({ tipo: e.tipo, autor: e.autorTipo === "ti" ? "Equipe de TI" : e.autorTipo === "admin" ? `Equipe de ${K.DEPARTAMENTO_NOME[depDe(t)]}` : e.autor, texto: e.texto, em: e.em, de: e.de, para: e.para })).filter((e) => !["atribuido", "prioridade", "transferido", "notificacao"].includes(e.tipo));
    return { ...visaoUsuario(t), eventos: ev };
  }

  // ---------- contagens (agregação no servidor do banco: 1 leitura a cada 1000 itens do índice) ----------
  // Os campos de topo (aberto, emAtendimento…) são da fila do TI; `departamentos` traz o resumo de cada fila. TI = total − adm − suporte
  // (assim os chamados antigos, sem o campo `departamento`, continuam contando como TI).
  let cacheCont = null;
  async function contagens() {
    if (cacheCont && Date.now() - cacheCont.t < 4000) return cacheCont.v;
    const agora = Date.now(), n = async (q) => (await q.count().get()).data().count, col = db.collection(COL);
    const contar = (base) => Promise.all([
      n(base.where("status", "==", "aberto")), n(base.where("status", "==", "em_atendimento")), n(base.where("status", "==", "aguardando_usuario")),
      n(base.where("status", "==", "aberto").where("slaAtendMs", "<", agora)), n(base.where("status", "==", "em_atendimento").where("slaResolMs", "<", agora))])
      .then(([aberto, emAtendimento, aguardandoUsuario, vencidosFila, vencidosResolucao]) => ({ aberto, emAtendimento, aguardandoUsuario, totalAbertos: aberto + emAtendimento + aguardandoUsuario, foraDoPrazo: vencidosFila + vencidosResolucao }));
    const [todos, adm, suporte] = await Promise.all([contar(col), contar(col.where("departamento", "==", "adm")), contar(col.where("departamento", "==", "suporte"))]);
    const sub = (a, b, c) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] - b[k] - c[k]]));
    const ti = sub(todos, adm, suporte);
    const v = { ...ti, departamentos: { ti, adm, suporte } };
    cacheCont = { t: Date.now(), v }; return v;
  }

  return { visaoTI, criar, abrirAutomatico, transferir, anotar, assumir, atribuir, mudarStatus, comentar, alterarPrioridade, responderComoUsuario, devolverFila, listar, detalhe, meus, detalheDoUsuario, contagens, invalidarCache: () => { cacheCont = null; }, SISTEMA };
}
module.exports = { criarChamados };
