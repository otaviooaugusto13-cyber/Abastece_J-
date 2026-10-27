// Habilitação para aceitar turnos: TODAS as travas num lugar só, avaliadas no servidor a cada aceite.
//   1) cadastro aprovado pela equipe (status "ativo")
//   2) idade verificada (≥ 16) a partir da data de nascimento cifrada
//   3) 16–17 anos: dados do responsável legal + autorização registrada
//   4) treinamento PRATICAMENTE 100% concluído
//   5) 16–17 anos: turno dentro da janela diurna e em setor permitido
const { Falha } = require("./erros");
const C = require("./config");
const V = require("./validacao");
const Cripto = require("./cripto");

function criarHabilitacao({ db, treinamento }) {
  /** Lê o perfil completo do profissional (público + privado decifrado) — uso interno do servidor. */
  async function perfil(uid) {
    const [pub, priv] = await Promise.all([db.collection("profissionais").doc(uid).get(), db.collection("profissionais_privado").doc(uid).get()]);
    const p = pub.data() || null, x = priv.data() || {};
    let nascimento = null;
    try { nascimento = x.nascimentoEnc ? Cripto.decifrar(x.nascimentoEnc, `profissionais_privado/nascimento/${uid}`) : null; } catch { nascimento = null; }
    return { pub: p, priv: x, nascimento };
  }

  /** Lança Falha se o profissional NÃO puder aceitar o turno `s`. Retorna { menor, idade }. */
  async function exigirPodeAceitar(uid, s) {
    const { pub, priv, nascimento } = await perfil(uid);
    if (!pub || pub.status !== "ativo") throw new Falha(403, "Seu cadastro ainda não foi aprovado.", "promotor-inativo");
    if (!nascimento || !V.dataIsoValida(nascimento)) throw new Falha(403, "Informe sua data de nascimento para continuar.", "idade-nao-verificada");
    const ref = s?.data && V.dataIsoValida(s.data) ? s.data : V.hojeSP();
    const idade = V.calcularIdade(nascimento, ref);
    if (idade < C.IDADE_MINIMA) throw new Falha(403, `É preciso ter pelo menos ${C.IDADE_MINIMA} anos.`, "idade-minima");
    const menor = idade < C.IDADE_MAIORIDADE;
    if (menor && !(priv.responsavelEnc && priv.autorizacaoResponsavelEm)) throw new Falha(403, "Para trabalhar com 16 ou 17 anos é necessária a autorização do responsável legal.", "responsavel-pendente");
    if (!(await treinamento.completo(uid))) throw new Falha(403, "Conclua o treinamento obrigatório PRATICAMENTE para aceitar turnos.", "treinamento-pendente");
    if (menor && s) {
      if (s.entrada < C.MENOR.JANELA_INICIO || s.saida > C.MENOR.JANELA_FIM || s.saida <= s.entrada) throw new Falha(403, `Para menores de 18 anos o turno deve ficar entre ${C.MENOR.JANELA_INICIO} e ${C.MENOR.JANELA_FIM}.`, "menor-horario");
      if (C.MENOR.SETORES_VEDADOS.includes(s.foco)) throw new Falha(403, "Este setor não está disponível para menores de 18 anos.", "menor-setor");
    }
    return { menor, idade };
  }

  /** Resumo (sem dados sensíveis) para a UI do próprio profissional. */
  async function situacao(uid) {
    const { pub, priv, nascimento } = await perfil(uid);
    const idade = nascimento && V.dataIsoValida(nascimento) ? V.calcularIdade(nascimento) : null;
    const menor = idade !== null && idade < C.IDADE_MAIORIDADE;
    const t = await treinamento.estado(uid);
    const pendencias = [];
    if (!pub || pub.status !== "ativo") pendencias.push("aprovacao");
    if (idade === null) pendencias.push("nascimento"); else if (idade < C.IDADE_MINIMA) pendencias.push("idade-minima");
    if (menor && !(priv.responsavelEnc && priv.autorizacaoResponsavelEm)) pendencias.push("responsavel");
    if (!t.completo) pendencias.push("treinamento");
    return { habilitado: pendencias.length === 0, pendencias, menor, status: pub?.status || "inexistente", treinamento: { concluidos: t.concluidos, total: t.total, completo: t.completo } };
  }
  return { perfil, exigirPodeAceitar, situacao };
}
module.exports = { criarHabilitacao };
