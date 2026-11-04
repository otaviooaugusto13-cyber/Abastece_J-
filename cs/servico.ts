/**
 * CS & B2B — SERVIÇO: carrega os dados do Firestore (com cache curto), grava as coleções cs_*, roda a manutenção periódica
 * (alertas de vaga, churn, NPS, recorrências) e materializa recorrências em pedidos reais.
 * Toda regra de negócio vive aqui/no servidor; o navegador só lê e envia intenções.
 */
import { COLECOES, PARAMETROS_PADRAO, LIMITES_PARAMETROS } from "./tipos";
import type { ParametrosCS, EnvioNps, Recorrencia, Interacao } from "./tipos";
import * as A from "./agregacao";

const LIMITE_DOCS = 20_000, TTL_CACHE_MS = 45_000, MAX_APURACAO_DIAS = 400;
const ms = (t: any): number => (t == null ? 0 : typeof t === "number" ? t : typeof t.toMillis === "function" ? t.toMillis() : 0);
const dowDe = (iso: string): number => new Date(iso + "T00:00:00Z").getUTCDay();

export function criarServicoCS(x: any) {
  const { db, FieldValue, Timestamp, Falha, V, C, S, taxas, suporte, operacao } = x;
  const col = (n: string) => db.collection(n);
  let cache: { ate: number; base: A.BaseCS } | null = null, emVoo: Promise<A.BaseCS> | null = null, cacheParams: { ate: number; p: ParametrosCS } | null = null;
  const invalidar = () => { cache = null; cacheParams = null; };

  // ───────── parâmetros ─────────
  async function parametros(): Promise<ParametrosCS> {
    if (cacheParams && Date.now() < cacheParams.ate) return cacheParams.p;
    const d = (await col(COLECOES.config).doc("parametros").get()).data() || {}, p = { ...PARAMETROS_PADRAO } as Record<string, number>;
    for (const k of Object.keys(LIMITES_PARAMETROS)) { const [lo, hi] = LIMITES_PARAMETROS[k as keyof ParametrosCS]; if (Number.isFinite(d[k]) && d[k] >= lo && d[k] <= hi) p[k] = d[k]; }
    cacheParams = { ate: Date.now() + 30_000, p: p as unknown as ParametrosCS };
    return cacheParams.p;
  }
  async function salvarParametros(body: any, uid: string): Promise<ParametrosCS> {
    const patch: Record<string, number> = {};
    for (const [k, [lo, hi, inteiro]] of Object.entries(LIMITES_PARAMETROS)) {
      if (body?.[k] === undefined) continue;
      const v = Number(body[k]);
      if (!Number.isFinite(v) || v < lo || v > hi || (inteiro && !Number.isInteger(v))) throw new Falha(400, `Parâmetro inválido: ${k} (entre ${lo} e ${hi}${inteiro ? ", inteiro" : ""}).`, "dados-invalidos", { campo: k });
      patch[k] = v;
    }
    if (!Object.keys(patch).length) throw new Falha(400, "Nenhum parâmetro válido enviado.", "dados-invalidos");
    await col(COLECOES.config).doc("parametros").set({ ...patch, atualizadoEm: FieldValue.serverTimestamp(), atualizadoPor: uid }, { merge: true });
    invalidar();
    return parametros();
  }

  // ───────── carga da base ─────────
  async function carregar(): Promise<A.BaseCS> {
    const agora = Date.now(), params = await parametros();
    const [redesS, contrS, fichasS, enviosS, lancS, acoesS] = await Promise.all([
      col(COLECOES.redes).limit(2000).get(), col("contratantes").limit(5000).get(), col(COLECOES.lojas).limit(5000).get(),
      col(COLECOES.nps).limit(5000).get(), col(COLECOES.lancamentos).limit(5000).get(), col(COLECOES.interacoes).where("tipo", "==", "acao_churn").limit(2000).get()
    ]);
    const redes: A.RedeBase[] = redesS.docs.map((d: any) => { const r = d.data(); return { id: d.id, nome: String(r.nome || "Rede"), csResponsavel: String(r.csResponsavel || ""), modelo: r.modelo === "pospago" ? "pospago" : "prepago", limiteCentavos: Number(r.limiteCentavos) || 0, cicloDia: Number(r.cicloDia) || 1, inicioApuracaoEm: ms(r.inicioApuracaoEm) }; });
    const dias = Math.min(MAX_APURACAO_DIAS, Math.max(A.JANELA_DIAS, ...redes.map((r) => Math.ceil((agora - r.inicioApuracaoEm) / A.DIA))));
    const desde = A.somaDias(A.hojeSP(agora), -dias);
    const [pedS, finS] = await Promise.all([
      col("solicitacoes").where("data", ">=", desde).limit(LIMITE_DOCS + 1).get(),
      col("solicitacoes_financeiro").where("criadoEm", ">=", Timestamp.fromMillis(agora - (dias + 95) * A.DIA)).limit(LIMITE_DOCS + 1).get()
    ]);
    const fichas = new Map<string, any>(fichasS.docs.map((d: any) => [d.id, d.data()])), total = new Map<string, number>(finS.docs.map((d: any) => [d.id, Number(d.data().total) || 0]));
    const lojas = new Map<string, A.LojaBase>();
    for (const d of contrS.docs) {
      const c = d.data(), f = fichas.get(d.id) || {};
      lojas.set(d.id, { lojaUid: d.id, nome: String(f.nome || c.nome || "Loja").slice(0, 120), redeId: f.redeId || null, criadoEm: ms(c.criadoEm), ativo: f.ativo !== false, cidade: String(f.endereco?.cidade || ""), gerente: String(f.gerente?.nome || "") });
    }
    const docs = pedS.docs.slice(0, LIMITE_DOCS), pedidos: A.PedidoCS[] = [];
    for (const d of docs) {
      const r = d.data(), uid = String(r.uid || "");
      if (uid && !lojas.has(uid)) { const f = fichas.get(uid) || {}; lojas.set(uid, { lojaUid: uid, nome: String(f.nome || r.loja || "Loja").slice(0, 120), redeId: f.redeId || null, criadoEm: 0, ativo: f.ativo !== false, cidade: String(f.endereco?.cidade || ""), gerente: String(f.gerente?.nome || "") }); }
      const p = A.normalizarPedido(d.id, r, total.get(d.id) || 0, lojas.get(uid)?.redeId || null);
      if (p) pedidos.push(p);
    }
    const envios: EnvioNps[] = enviosS.docs.map((d: any) => { const e = d.data(); return { id: d.id, lojaUid: e.lojaUid, redeId: e.redeId || null, lojaNome: String(e.lojaNome || ""), status: e.status, criadoEm: ms(e.criadoEm), respondidoEm: ms(e.respondidoEm) || null, nota: Number.isInteger(e.nota) ? e.nota : null, comentario: String(e.comentario || "") }; });
    const lancamentos: A.LancamentoBase[] = lancS.docs.map((d: any) => { const l = d.data(); return { id: d.id, redeId: l.redeId, tipo: l.tipo, valorCentavos: Number(l.valorCentavos) || 0, descricao: String(l.descricao || ""), em: ms(l.em), paga: typeof l.paga === "boolean" ? l.paga : null }; });
    const lojasComAcao = [...new Set<string>(acoesS.docs.filter((d: any) => d.data().status === "aberta").map((d: any) => d.data().lojaUid))];
    return { pedidos, lojas: [...lojas.values()], redes, envios, lancamentos, lojasComAcao, params, agora, truncado: pedS.docs.length > LIMITE_DOCS || finS.docs.length > LIMITE_DOCS };
  }
  async function base(forcar = false): Promise<A.BaseCS> {
    if (!forcar && cache && Date.now() < cache.ate) return cache.base;
    emVoo ||= carregar().then((b) => { cache = { ate: Date.now() + TTL_CACHE_MS, base: b }; return b; }).finally(() => { emVoo = null; });
    return emVoo;
  }
  const janelaCarregada = (b: A.BaseCS) => b.agora - Math.min(MAX_APURACAO_DIAS, Math.max(A.JANELA_DIAS, ...b.redes.map((r) => Math.ceil((b.agora - r.inicioApuracaoEm) / A.DIA)))) * A.DIA;

  // ───────── leituras compostas ─────────
  const painel = async (dias: number, redeId: string | null) => A.montarPainel(await base(), dias, redeId);
  async function contas(dias: number) { const b = await base(); return A.contasChave(b, A.janelaDe(dias, b.agora, b.params.toleranciaPontualMin)); }
  async function marcasPor(dias: number, redeId: string | null) { const b = A.escopo(await base(), redeId); return A.marcas(b.pedidos, A.janelaDe(dias, b.agora, b.params.toleranciaPontualMin)); }
  async function faturamentoPor(redeId: string | null) { const b = A.escopo(await base(), redeId); return A.faturamento(b, janelaCarregada(b)); }
  async function npsPor(dias: number, redeId: string | null) {
    const b = A.escopo(await base(), redeId), j = A.janelaDe(dias, b.agora, b.params.toleranciaPontualMin);
    return { ...A.nps(b.envios, j), envios: b.envios.sort((a, c) => c.criadoEm - a.criadoEm).slice(0, 60) };
  }
  async function listarLojas(busca: string, redeId: string | null) {
    const b = await base(), ch = new Map(A.churn(b).itens.map((i) => [i.lojaUid, i])), rn = new Map(b.redes.map((r) => [r.id, r.nome])), q = busca.trim().toLowerCase();
    return b.lojas.filter((l) => (!redeId || l.redeId === redeId) && (!q || l.nome.toLowerCase().includes(q) || l.gerente.toLowerCase().includes(q) || l.cidade.toLowerCase().includes(q)))
      .map((l) => ({ lojaUid: l.lojaUid, nome: l.nome, redeId: l.redeId, rede: l.redeId ? rn.get(l.redeId) || "" : "", cidade: l.cidade, gerente: l.gerente, ativo: l.ativo, nivelChurn: ch.get(l.lojaUid)?.nivel || "saudavel", diasSemMissao: ch.get(l.lojaUid)?.diasSemMissao ?? null }))
      .sort((a, c) => a.nome.localeCompare(c.nome)).slice(0, 300);
  }

  // ───────── ficha da loja ─────────
  const FICHA_VAZIA = { endereco: { logradouro: "", numero: "", bairro: "", cidade: "", uf: "", cep: "" }, acesso: { instrucoes: "", contatoPortaria: "", horarioRecebimento: "" }, gerente: { nome: "", telefone: "", email: "" }, observacoes: "", csResponsavel: "", ativo: true };
  async function detalheLoja(uid: string) {
    const [contr, fichaS, interS, fotosS] = await Promise.all([col("contratantes").doc(uid).get(), col(COLECOES.lojas).doc(uid).get(), col(COLECOES.interacoes).where("lojaUid", "==", uid).limit(200).get(), col(COLECOES.fotos).where("lojaUid", "==", uid).limit(10).get()]);
    if (!contr.exists && !fichaS.exists) throw new Falha(404, "Loja não encontrada.", "nao-encontrado");
    const b = await base(), f = { ...FICHA_VAZIA, ...(fichaS.data() || {}) }, c = contr.data() || {}, j = A.janelaDe(90, b.agora, b.params.toleranciaPontualMin);
    const ps = b.pedidos.filter((p) => p.lojaUid === uid), ch = A.churn({ ...b, pedidos: ps, lojas: b.lojas.filter((l) => l.lojaUid === uid) }).itens[0];
    return {
      lojaUid: uid, nome: String(f.nome || c.nome || "Loja"), redeId: f.redeId || null, rede: b.redes.find((r) => r.id === f.redeId)?.nome || "", email: String(c.email || ""),
      endereco: f.endereco, acesso: f.acesso, gerente: f.gerente, observacoes: f.observacoes, csResponsavel: f.csResponsavel, ativo: f.ativo !== false, atualizadoEm: ms(f.atualizadoEm) || null,
      fotos: fotosS.docs.map((d: any) => ({ id: d.id, descricao: String(d.data().descricao || ""), em: ms(d.data().em) })),
      indicadores90d: A.indicadores(ps, j), nivelChurn: ch?.nivel || "saudavel", diasSemMissao: ch?.diasSemMissao ?? 0,
      missoes: ps.sort((a, d) => d.inicioMs - a.inicioMs).slice(0, 25).map((p) => ({ id: p.id, data: p.data, entrada: p.entrada, saida: p.saida, setor: p.setor, status: p.status, concluida: A.concluido(p), atrasoMin: p.atrasoMin, estrelas: p.estrelas, comentario: p.comentario, promotor: p.promotorNome ? A.nomeCurto(p.promotorNome) : "", totalCentavos: p.totalCentavos })),
      interacoes: interS.docs.map((d: any) => ({ id: d.id, ...d.data(), em: ms(d.data().em) }) as Interacao).sort((a: Interacao, d: Interacao) => d.em - a.em)
    };
  }

  // ───────── manutenção periódica (cron) ─────────
  async function criarSeNovo(id: string, dados: Record<string, unknown>): Promise<boolean> {
    const ref = col(COLECOES.alertas).doc(id);
    if ((await ref.get()).exists) return false;
    await ref.set({ ...dados, criadoEm: FieldValue.serverTimestamp() });
    return true;
  }
  async function pedidoDeRecorrencia(rec: Recorrencia, data: string): Promise<string> {
    const id = `rec_${rec.id}_${data}`, ref = col("solicitacoes").doc(id);
    if ((await ref.get()).exists) return "";
    try {
      await x.exigirCartao(rec.lojaUid);
      const cfg = await taxas.obter(), erro = S.validarTurno(rec.entrada, rec.saida, cfg);
      if (erro) return erro;
      const sp = S.calcularTurno(S.minutosEntre(rec.entrada, rec.saida), cfg), [local, marca] = await Promise.all([x.localDaLoja(rec.lojaUid), x.marcaDoPedido(rec.marcaId)]);
      const lote = db.batch();
      lote.set(ref, { uid: rec.lojaUid, loja: rec.lojaNome, data, entrada: rec.entrada, saida: rec.saida, horario: `${rec.entrada} – ${rec.saida}`, minutos: sp.minutos, foco: rec.setor, valorPromotorCentavos: sp.promotor, modelo: sp.modelo, status: "aberta", criadoEm: FieldValue.serverTimestamp(), tipo: "padrao", exigeExecucao: true, local: { lat: local.lat, lng: local.lng }, regiao: { cidade: local.cidade, uf: local.uf }, raioM: C.GEO.RAIO_METROS, recorrenciaId: rec.id, ...(marca || {}) });
      lote.set(col("solicitacoes_financeiro").doc(id), { uid: rec.lojaUid, ...x.visaoLoja(sp), criadoEm: FieldValue.serverTimestamp() });
      lote.set(col("pagamentos_internos").doc(id), { uid: rec.lojaUid, split: sp, status: "criado", criadoEm: FieldValue.serverTimestamp() });
      await lote.commit();
      return "";
    } catch (e: any) { return e?.message ? String(e.message).slice(0, 160) : "falha desconhecida"; }
  }
  /** Gera os pedidos das recorrências que entraram no horizonte. Idempotente (id do pedido = rec_<id>_<data>). */
  async function materializar(agora = Date.now()): Promise<{ geradas: number; falhas: number }> {
    const hoje = A.hojeSP(agora), params = await parametros(), horizonte = A.somaDias(hoje, Math.min(90, params.antecedenciaRecorrenciaDias));
    if ((await operacao.obter()).master?.missoes === false) return { geradas: 0, falhas: 0 };       // Master Switch: criação de missões pausada
    const s = await col(COLECOES.recorrencias).where("ativo", "==", true).limit(200).get();
    let geradas = 0, falhas = 0;
    for (const d of s.docs) {
      const r = d.data() as any, rec: Recorrencia = { id: d.id, lojaUid: r.lojaUid, lojaNome: r.lojaNome, nome: r.nome, setor: r.setor, entrada: r.entrada, saida: r.saida, marcaId: r.marcaId || null, tipo: r.tipo, datas: r.datas || [], diasSemana: r.diasSemana || [], ate: r.ate || null, ativo: true, geradas: r.geradas || [], ultimaFalha: "", criadoEm: ms(r.criadoEm) };
      let candidatas: string[] = [];
      if (rec.tipo === "datas") candidatas = rec.datas;
      else { for (let dia = hoje; dia <= horizonte && (!rec.ate || dia <= rec.ate); dia = A.somaDias(dia, 1)) if (rec.diasSemana.includes(dowDe(dia))) candidatas.push(dia); }
      const feitas = new Set(rec.geradas); let falha = "";
      for (const data of candidatas.filter((dt) => dt >= hoje && dt <= horizonte && !feitas.has(dt))) {
        const erro = await pedidoDeRecorrencia(rec, data);
        if (!erro) { feitas.add(data); geradas++; }
        else { falhas++; falha = `${data}: ${erro}`; await criarSeNovo(`rec_${rec.id}_${data}`, { tipo: "recorrencia_falha", refId: rec.id, lojaUid: rec.lojaUid, severidade: "alta", mensagem: `Recorrência "${rec.nome}" de ${rec.lojaNome} não gerou o pedido de ${data}: ${erro}` }); }
      }
      const acabou = rec.tipo === "datas" ? rec.datas.every((dt) => dt < hoje) : !!rec.ate && rec.ate < hoje;   // encerra quando não há mais data futura
      await d.ref.set({ geradas: [...feitas].sort(), ultimaFalha: falha, ...(acabou ? { ativo: false } : {}) }, { merge: true });
    }
    if (geradas || falhas) invalidar();
    return { geradas, falhas };
  }
  /** NPS B2B: 1 pesquisa por loja a cada `npsPeriodicidadeDias`, só para quem usou a plataforma no período. */
  async function dispararNps(b: A.BaseCS, { forcar = false, redeId = null as string | null } = {}): Promise<number> {
    const per = b.params.npsPeriodicidadeDias * A.DIA, porLoja = new Map<string, EnvioNps[]>();
    for (const e of b.envios) porLoja.set(e.lojaUid, [...(porLoja.get(e.lojaUid) || []), e]);
    let n = 0;
    for (const l of b.lojas.filter((l) => l.ativo && (!redeId || l.redeId === redeId))) {
      const hist = porLoja.get(l.lojaUid) || [], ultimo = Math.max(0, ...hist.map((e) => e.criadoEm));
      if (hist.some((e) => e.status === "pendente") || (!forcar && ultimo && b.agora - ultimo < per)) continue;
      if (!b.pedidos.some((p) => p.lojaUid === l.lojaUid && A.concluido(p) && p.inicioMs >= b.agora - per)) continue;
      await col(COLECOES.nps).doc().set({ lojaUid: l.lojaUid, redeId: l.redeId, lojaNome: l.nome, status: "pendente", campanha: forcar ? "manual" : "periodica", criadoEm: FieldValue.serverTimestamp(), expiraEm: Timestamp.fromMillis(b.agora + 30 * A.DIA) });
      await suporte.enviarPush({ uid: l.lojaUid, titulo: "Como estamos atendendo sua loja?", corpo: "Leva 20 segundos: dê uma nota de 0 a 10 para o Abastece Já.", url: "painel-cs" });
      n++;
    }
    if (n) invalidar();
    return n;
  }
  async function manutencao() {
    invalidar();
    const b = await base(true), res = { vagasNovas: 0, churnNovos: 0, npsEnviados: 0, npsExpirados: 0, recorrencias: { geradas: 0, falhas: 0 } };
    const novasVagas = [];
    for (const v of A.vagasDesatendidas(b.pedidos, b.params.alertaVagaHoras, b.agora))
      if (await criarSeNovo(`vaga_${v.pedidoId}`, { tipo: "vaga_desatendida", refId: v.pedidoId, lojaUid: v.lojaUid, severidade: v.severidade, mensagem: `${v.lojaNome} · ${v.setor} · ${v.data} ${v.entrada} sem promotor (${v.minutosParaInicio <= 0 ? "já começou" : `faltam ${v.minutosParaInicio} min`})` })) novasVagas.push(v);
    res.vagasNovas = novasVagas.length;
    if (novasVagas.length) await suporte.enviarPush({ admins: true, titulo: `⚠️ ${novasVagas.length} vaga(s) sem promotor`, corpo: novasVagas.slice(0, 3).map((v) => `${v.lojaNome} ${v.entrada}`).join(" · "), url: "painel-cs#operacao" });
    const novosChurn = [];
    for (const i of A.churn(b).itens.filter((i) => i.nivel === "risco" || i.nivel === "critico"))
      if (await criarSeNovo(`churn_${i.lojaUid}_${i.ultimaMissaoEm || 0}_${i.nivel}`, { tipo: "churn", refId: i.lojaUid, lojaUid: i.lojaUid, severidade: i.nivel === "critico" ? "critica" : "alta", mensagem: `${i.nome} está há ${i.alemDaJanela ? `mais de ${i.diasSemMissao}` : i.diasSemMissao} dias sem criar missão` })) novosChurn.push(i);
    res.churnNovos = novosChurn.length;
    if (novosChurn.length) await suporte.enviarPush({ admins: true, titulo: `📉 ${novosChurn.length} loja(s) inativa(s)`, corpo: novosChurn.slice(0, 3).map((i) => i.nome).join(" · "), url: "painel-cs#churn" });
    const pend = await col(COLECOES.nps).where("status", "==", "pendente").limit(500).get();
    for (const d of pend.docs) if (ms(d.data().expiraEm) && ms(d.data().expiraEm) < b.agora) { await d.ref.set({ status: "expirado" }, { merge: true }); res.npsExpirados++; }
    res.npsEnviados = await dispararNps(b);
    res.recorrencias = await materializar(b.agora);
    invalidar();
    return res;
  }

  return { parametros, salvarParametros, base, invalidar, painel, contas, marcasPor, faturamentoPor, npsPor, listarLojas, detalheLoja, materializar, dispararNps, manutencao, FICHA_VAZIA };
}
export type ServicoCS = ReturnType<typeof criarServicoCS>;
