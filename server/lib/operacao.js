// Parâmetros OPERACIONAIS globais, editáveis só pelo Admin Root, valendo em tempo real:
//   • raioKm  — raio de atendimento (1–50 km) usado na busca de vagas/promotores por proximidade
//   • master  — Master Switch (kill-switch): cadastros / missoes / pagamentos (true = funcionando, false = PAUSADO)
//
//   configuracoes/operacao   fonte da verdade (fechada no firestore.rules; só o servidor lê/escreve)
//   config_publica/operacao  ESPELHO enxuto, gravado na MESMA transação: os apps assinam por onSnapshot e reagem em milissegundos
//
// Mesmo padrão de lib/taxas.js: cache em memória + listener (onSnapshot) + TTL de garantia + controle de versão (409).
// Fail-closed: leitura falhou e não há cache → 503 (não deixamos passar uma operação que o Root talvez tenha pausado).
const { Falha } = require("./erros");

const COLECAO = "configuracoes", DOC = "operacao", PUBLICA = "config_publica";
const TTL_MS = 30_000;
const LIMITES = Object.freeze({ raioKm: [1, 50] });
const INTERRUPTORES = Object.freeze(["cadastros", "missoes", "pagamentos"]);
const PADRAO = Object.freeze({ raioKm: 20, master: Object.freeze({ cadastros: true, missoes: true, pagamentos: true }), motivoPausa: "", versao: 0 });
const MENSAGEM = Object.freeze({
  cadastros: "Novos cadastros estão temporariamente pausados. Tente novamente em instantes.",
  missoes: "A criação de novas missões está temporariamente pausada. Tente novamente em instantes.",
  pagamentos: "O processamento de pagamentos está temporariamente pausado. Tente novamente em instantes."
});

/** Valida um pedido de alteração (parcial). Retorna { erro } ou { patch }. Só números/booleanos reais; campos extras são descartados. */
function validarAlteracao(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) return { erro: "Corpo inválido." };
  const patch = {};
  if (b.raioKm !== undefined) {
    const [lo, hi] = LIMITES.raioKm;
    if (typeof b.raioKm !== "number" || !Number.isInteger(b.raioKm) || b.raioKm < lo || b.raioKm > hi) return { erro: `O raio de atendimento deve ser um número inteiro de ${lo} a ${hi} km.` };
    patch.raioKm = b.raioKm;
  }
  const master = {};
  for (const k of INTERRUPTORES) if (b[k] !== undefined) { if (typeof b[k] !== "boolean") return { erro: `Valor inválido em "${k}" (use true ou false).` }; master[k] = b[k]; }
  if (Object.keys(master).length) patch.master = master;
  if (b.motivo !== undefined) { if (typeof b.motivo !== "string" || b.motivo.length > 200) return { erro: "Motivo inválido (texto de até 200 caracteres)." }; patch.motivo = b.motivo.trim(); }
  if (!patch.raioKm && !patch.master) return { erro: "Nada para alterar." };
  if (patch.raioKm && patch.master) return { erro: "Altere o raio e o Master Switch em operações separadas." };
  if (patch.master && Object.values(patch.master).includes(false) && (patch.motivo || "").length < 5) return { erro: "Para pausar uma função, informe o motivo (mínimo de 5 caracteres): ele fica na trilha de auditoria." };
  return { patch };
}

function criarOperacao({ db, FieldValue, ttlMs = TTL_MS }) {
  const ref = () => db.collection(COLECAO).doc(DOC), refPublica = () => db.collection(PUBLICA).doc(DOC);
  let cache = null, expira = 0, emVoo = null, parar = null;

  const iso = (ts) => { const d = ts?.toDate ? ts.toDate() : null; return d ? d.toISOString() : null; };
  const padrao = () => ({ raioKm: PADRAO.raioKm, master: { ...PADRAO.master }, motivoPausa: "", versao: 0, atualizadoEm: null, atualizadoPor: "", origem: "padrao" });
  /** Documento → objeto validado. Lança se estiver corrompido (nunca "adivinha" um valor). */
  function doDocumento(d) {
    if (!d) return padrao();
    const [lo, hi] = LIMITES.raioKm;
    if (!Number.isInteger(d.raioKm) || d.raioKm < lo || d.raioKm > hi) throw new Error(`documento ${COLECAO}/${DOC} inválido: raioKm`);
    const master = {}; for (const k of INTERRUPTORES) { if (typeof d.master?.[k] !== "boolean") throw new Error(`documento ${COLECAO}/${DOC} inválido: master.${k}`); master[k] = d.master[k]; }
    return { raioKm: d.raioKm, master, motivoPausa: String(d.motivoPausa || ""), versao: Number.isInteger(d.versao) ? d.versao : 0, atualizadoEm: iso(d.atualizadoEm), atualizadoPor: String(d.atualizadoPor || ""), origem: "banco" };
  }
  const guardar = (t) => { cache = Object.freeze(t); expira = Date.now() + ttlMs; return cache; };
  async function ler() {
    try { return guardar(doDocumento((await ref().get()).data())); }
    catch (e) {
      console.error("operacao: falha ao ler configuração:", e.message);
      if (cache) { expira = Date.now() + 5_000; return cache; }
      throw new Falha(503, "Configuração de operação indisponível. Tente novamente em instantes.", "operacao-indisponivel");
    }
  }
  async function obter() { if (cache && Date.now() < expira) return cache; emVoo ||= ler().finally(() => { emVoo = null; }); return emVoo; }

  function iniciar() {
    const r = ref();
    if (typeof r.onSnapshot !== "function" || parar) return;
    parar = r.onSnapshot(
      (snap) => { try { guardar(doDocumento(snap.exists ? snap.data() : null)); } catch (e) { console.error("operacao: snapshot ignorado:", e.message); } },
      (e) => { console.error("operacao: listener caiu (o TTL continua protegendo):", e.message); parar = null; setTimeout(iniciar, 10_000).unref?.(); }
    );
  }

  /** Visão pública: só o necessário para os apps filtrarem e avisarem. Nunca expõe o motivo interno nem quem alterou. */
  const visaoPublica = (t) => ({ raioKm: t.raioKm, cadastros: t.master.cadastros, missoes: t.master.missoes, pagamentos: t.master.pagamentos, versao: t.versao });

  /** Aplica `patch` (já validado) em transação com controle de versão; grava fonte + espelho público juntos. */
  async function salvar(patch, { ator, versaoEsperada } = {}) {
    const antes = await db.runTransaction(async (tx) => {
      const atual = (await tx.get(ref())).data();
      const versaoAtual = atual && Number.isInteger(atual.versao) ? atual.versao : 0;
      if (versaoEsperada !== undefined && versaoEsperada !== versaoAtual) throw new Falha(409, "Outro administrador alterou estes parâmetros enquanto você editava. Recarregamos os valores atuais — confira e tente de novo.", "operacao-desatualizada", { versaoAtual });
      const base = atual ? doDocumento(atual) : padrao();
      const novo = { raioKm: patch.raioKm ?? base.raioKm, master: { ...base.master, ...(patch.master || {}) } };
      const pausado = INTERRUPTORES.some((k) => !novo.master[k]);
      novo.motivoPausa = pausado ? (patch.motivo ?? base.motivoPausa) : "";
      const versao = versaoAtual + 1;
      tx.set(ref(), { ...novo, versao, atualizadoEm: FieldValue.serverTimestamp(), atualizadoPor: String(ator || "") });
      tx.set(refPublica(), { raioKm: novo.raioKm, cadastros: novo.master.cadastros, missoes: novo.master.missoes, pagamentos: novo.master.pagamentos, versao, atualizadoEm: FieldValue.serverTimestamp() });
      return base;
    });
    cache = null; expira = 0;
    return { antes, depois: await ler() };
  }

  /** Middleware: barra a rota com 503 enquanto a função estiver pausada pelo Root. Rotas do Root e do admin nunca usam isto. */
  const exigir = (chave) => {
    if (!INTERRUPTORES.includes(chave)) throw new Error(`interruptor desconhecido: ${chave}`);
    return async (req, res, next) => {
      try { const o = await obter(); if (!o.master[chave]) throw new Falha(503, MENSAGEM[chave], "operacao-pausada", { funcao: chave }); next(); }
      catch (e) { next(e); }
    };
  };

  return { obter, iniciar, salvar, exigir, visaoPublica, invalidar: () => { cache = null; expira = 0; }, _parar: () => { parar?.(); parar = null; } };
}

module.exports = { criarOperacao, validarAlteracao, LIMITES, INTERRUPTORES, PADRAO, COLECAO, DOC, PUBLICA };
