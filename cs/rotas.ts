/**
 * CS & B2B — ROTAS HTTP  (/cs/*). Montadas em server/server.js:  require("./lib/cs/rotas")(app, { ...ctx, Img })
 *
 *   Admin (CS)  GET  /cs/painel · /cs/contas · /cs/redes · /cs/lojas · /cs/lojas/:uid · /cs/faturamento · /cs/marcas · /cs/nps · /cs/alertas · /cs/config · /cs/exportar
 *               POST/PUT/DELETE: redes, ficha da loja, fotos, interações, faturamento, NPS manual, parâmetros
 *   Loja        /cs/loja/recorrencias (programar demandas) · /cs/loja/nps/pendente|:id/responder
 *   Cron        POST /interno/cs-manutencao (x-cron-secret)
 * RBAC: papel "admin" para tudo do CS; papel "loja" só nas próprias recorrências/NPS (IDOR = 404). Escritas auditadas em `auditoria`.
 */
import { COLECOES } from "./tipos";
import type { Recorrencia } from "./tipos";
import { criarServicoCS } from "./servico";
import * as R from "./relatorio";
import { hojeSP, somaDias } from "./agregacao";

const ms = (t: any): number => (t == null ? 0 : typeof t === "number" ? t : typeof t.toMillis === "function" ? t.toMillis() : 0);
const MIME: Record<string, string> = { pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", html: "text/html; charset=utf-8", csv: "text/csv; charset=utf-8" };

export = function registrarRotasCS(app: any, x: any) {
  const { db, express, FieldValue, Timestamp, auth, V, C, Falha, envelope, limitar, Cripto, Img, CRON_SECRET } = x;
  const svc = criarServicoCS(x), col = (n: string) => db.collection(n), G = globalThis as any;
  const lim = (nome: string, max: number, janelaMs = 60_000) => limitar({ janelaMs, max, nome, porUsuario: true });
  const ADM = (nome: string, max = 120) => [auth.exigir("admin"), lim(nome, max)];
  const LOJA = (nome: string, max = 40) => [auth.exigir("loja"), lim(nome, max)];
  const periodo = (q: any) => Number(V.opcao(String(q.dias || "30"), ["7", "14", "30", "60", "90"], "período"));
  const redeOpc = async (q: any): Promise<string | null> => {
    if (!q.redeId) return null;
    const id = V.idDoc(String(q.redeId), "redeId");
    if (!(await col(COLECOES.redes).doc(id).get()).exists) throw new Falha(404, "Rede não encontrada.", "nao-encontrado");
    return id;
  };
  const autor = (req: any) => String(req.usuario.name || req.usuario.email || "CS").slice(0, 80);
  const txt = (v: any, campo: string, max: number, min = 0) => V.texto(v, campo, { min, max, obrigatorio: min > 0 });
  const iso = (v: any, campo: string) => { if (!V.dataIsoValida(v)) throw new Falha(400, `Campo inválido: ${campo} — use AAAA-MM-DD`, "dados-invalidos", { campo }); return v as string; };
  const existeLoja = async (uid: string) => { if (!(await col("contratantes").doc(uid).get()).exists) throw new Falha(404, "Loja não encontrada.", "nao-encontrado"); };
  const jsonFoto = express.json({ limit: "400kb" });

  // ───────────────────────── leituras (admin) ─────────────────────────
  app.get("/cs/painel", ...ADM("cspainel", 60), envelope(async (req: any, res: any) => res.json(await svc.painel(periodo(req.query), await redeOpc(req.query)))));
  app.get("/cs/contas", ...ADM("cscontas", 60), envelope(async (req: any, res: any) => res.json(await svc.contas(periodo(req.query)))));
  app.get("/cs/marcas", ...ADM("csmarcas", 60), envelope(async (req: any, res: any) => res.json(await svc.marcasPor(periodo(req.query), await redeOpc(req.query)))));
  app.get("/cs/faturamento", ...ADM("csfat", 60), envelope(async (req: any, res: any) => res.json(await svc.faturamentoPor(await redeOpc(req.query)))));
  app.get("/cs/nps", ...ADM("csnps", 60), envelope(async (req: any, res: any) => res.json(await svc.npsPor(periodo(req.query), await redeOpc(req.query)))));
  app.get("/cs/lojas", ...ADM("cslojas", 60), envelope(async (req: any, res: any) => res.json(await svc.listarLojas(String(req.query.busca || "").slice(0, 60), await redeOpc(req.query)))));
  app.get("/cs/lojas/:uid", ...ADM("csloja", 60), envelope(async (req: any, res: any) => res.json(await svc.detalheLoja(V.idDoc(req.params.uid, "uid")))));
  app.get("/cs/alertas", ...ADM("csalertas", 60), envelope(async (req: any, res: any) => {
    const s = await col(COLECOES.alertas).orderBy("criadoEm", "desc").limit(60).get();
    res.json(s.docs.map((d: any) => ({ id: d.id, ...d.data(), criadoEm: ms(d.data().criadoEm) })));
  }));
  app.get("/cs/config", ...ADM("csconfig", 60), envelope(async (req: any, res: any) => res.json(await svc.parametros())));
  app.put("/cs/config", ...ADM("csconfigw", 20), envelope(async (req: any, res: any) => {
    const p = await svc.salvarParametros(req.body, req.usuario.uid);
    await auth.auditar(req, "cs.config.alterar", "parametros", { campos: Object.keys(req.body || {}).slice(0, 20) });
    res.json(p);
  }));

  // ───────────────────────── redes (contas-chave) ─────────────────────────
  app.get("/cs/redes", ...ADM("csredes", 60), envelope(async (req: any, res: any) => {
    const b = await svc.base(), s = await col(COLECOES.redes).limit(2000).get();
    res.json(s.docs.map((d: any) => { const r = d.data(); return { id: d.id, nome: r.nome, csResponsavel: r.csResponsavel || "", modelo: r.modelo || "prepago", limiteCentavos: r.limiteCentavos || 0, cicloDia: r.cicloDia || 1, inicioApuracaoEm: ms(r.inicioApuracaoEm), lojasQtd: b.lojas.filter((l) => l.redeId === d.id).length }; }).sort((a: any, c: any) => a.nome.localeCompare(c.nome)));
  }));
  app.post("/cs/redes", ...ADM("csredew", 30), envelope(async (req: any, res: any) => {
    const nome = txt(req.body?.nome, "nome", 80, 2), ref = col(COLECOES.redes).doc();
    await ref.set({ nome, csResponsavel: txt(req.body?.csResponsavel, "responsável", 80), modelo: "prepago", limiteCentavos: 0, cicloDia: 1, inicioApuracaoEm: Timestamp.now(), criadoEm: FieldValue.serverTimestamp() });
    svc.invalidar(); await auth.auditar(req, "cs.rede.criar", ref.id, { nome }); res.json({ ok: true, id: ref.id });
  }));
  app.put("/cs/redes/:id", ...ADM("csredew", 30), envelope(async (req: any, res: any) => {
    const id = V.idDoc(req.params.id, "id"), ref = col(COLECOES.redes).doc(id), patch: Record<string, unknown> = {};
    if (!(await ref.get()).exists) throw new Falha(404, "Rede não encontrada.", "nao-encontrado");
    if (req.body?.nome !== undefined) patch.nome = txt(req.body.nome, "nome", 80, 2);
    if (req.body?.csResponsavel !== undefined) patch.csResponsavel = txt(req.body.csResponsavel, "responsável", 80);
    if (!Object.keys(patch).length) throw new Falha(400, "Nada para alterar.", "dados-invalidos");
    await ref.set(patch, { merge: true }); svc.invalidar(); await auth.auditar(req, "cs.rede.alterar", id, patch); res.json({ ok: true });
  }));
  app.put("/cs/redes/:id/lojas", ...ADM("csredew", 30), envelope(async (req: any, res: any) => {
    const id = V.idDoc(req.params.id, "id");
    if (!(await col(COLECOES.redes).doc(id).get()).exists) throw new Falha(404, "Rede não encontrada.", "nao-encontrado");
    const lista = (k: string): string[] => { const v = req.body?.[k] ?? []; if (!Array.isArray(v) || v.length > 100) throw new Falha(400, `Campo inválido: ${k}`, "dados-invalidos"); return v.map((u: unknown) => V.idDoc(u, k)); };
    const add = lista("adicionar"), rem = lista("remover");
    for (const uid of add) { const c = await col("contratantes").doc(uid).get(); if (!c.exists) throw new Falha(404, `Loja não encontrada: ${uid}`, "nao-encontrado"); await col(COLECOES.lojas).doc(uid).set({ lojaUid: uid, redeId: id, nome: String(c.data().nome || "Loja").slice(0, 120), atualizadoEm: FieldValue.serverTimestamp() }, { merge: true }); }
    for (const uid of rem) { const f = (await col(COLECOES.lojas).doc(uid).get()).data(); if (f?.redeId === id) await col(COLECOES.lojas).doc(uid).set({ redeId: null, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true }); }
    svc.invalidar(); await auth.auditar(req, "cs.rede.lojas", id, { adicionar: add.length, remover: rem.length }); res.json({ ok: true, adicionadas: add.length, removidas: rem.length });
  }));

  // ───────────────────────── ficha da loja ─────────────────────────
  app.put("/cs/lojas/:uid", ...ADM("cslojaw", 40), envelope(async (req: any, res: any) => {
    const uid = V.idDoc(req.params.uid, "uid"), b = req.body || {}, patch: Record<string, unknown> = {};
    await existeLoja(uid);
    if (b.nome !== undefined) patch.nome = txt(b.nome, "nome", 120, 2);
    if (b.redeId !== undefined) { if (b.redeId === null) patch.redeId = null; else { const r = V.idDoc(b.redeId, "redeId"); if (!(await col(COLECOES.redes).doc(r).get()).exists) throw new Falha(404, "Rede não encontrada.", "nao-encontrado"); patch.redeId = r; } }
    if (b.endereco !== undefined) { const e = b.endereco || {}; patch.endereco = { logradouro: txt(e.logradouro, "logradouro", 120), numero: txt(e.numero, "número", 15), bairro: txt(e.bairro, "bairro", 80), cidade: txt(e.cidade, "cidade", 80), uf: e.uf ? V.opcao(String(e.uf).toUpperCase(), x.UFS, "UF") : "", cep: V.soDigitos(e.cep).slice(0, 8) }; }
    if (b.acesso !== undefined) { const a = b.acesso || {}; patch.acesso = { instrucoes: txt(a.instrucoes, "instruções de acesso", 500), contatoPortaria: txt(a.contatoPortaria, "portaria", 80), horarioRecebimento: txt(a.horarioRecebimento, "horário de recebimento", 80) }; }
    if (b.gerente !== undefined) { const g = b.gerente || {}; patch.gerente = { nome: txt(g.nome, "gerente", 80), telefone: V.soDigitos(g.telefone).slice(0, 13), email: txt(g.email, "e-mail do gerente", 120, 0) }; if (patch.gerente && (patch.gerente as any).email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((patch.gerente as any).email)) throw new Falha(400, "Campo inválido: e-mail do gerente", "dados-invalidos"); }
    if (b.observacoes !== undefined) patch.observacoes = txt(b.observacoes, "observações", 1000);
    if (b.csResponsavel !== undefined) patch.csResponsavel = txt(b.csResponsavel, "responsável CS", 80);
    if (b.ativo !== undefined) patch.ativo = V.booleano(b.ativo, "ativo");
    if (!Object.keys(patch).length) throw new Falha(400, "Nada para alterar.", "dados-invalidos");
    await col(COLECOES.lojas).doc(uid).set({ lojaUid: uid, ...patch, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    svc.invalidar(); await auth.auditar(req, "cs.loja.ficha", uid, { campos: Object.keys(patch) }); res.json({ ok: true });
  }));
  app.post("/cs/lojas/:uid/fotos", jsonFoto, ...ADM("csfoto", 20), envelope(async (req: any, res: any) => {
    const uid = V.idDoc(req.params.uid, "uid"); await existeLoja(uid);
    if ((await col(COLECOES.fotos).where("lojaUid", "==", uid).limit(7).get()).docs.length >= 6) throw new Falha(409, "Limite de 6 fotos por loja. Remova uma antes.", "limite-fotos");
    const img = Img.jpegDeDataUrl(req.body?.foto, "foto", { min: 2_000, max: 180_000 }), dim = Img.dimensoesJpeg(img);
    if (Math.max(dim.largura, dim.altura) > 2000) throw new Falha(400, "Foto grande demais (máx. 2000 px). Reduza antes de enviar.", "foto-invalida");
    const ref = col(COLECOES.fotos).doc();
    await ref.set({ lojaUid: uid, imagem: img.toString("base64"), descricao: txt(req.body?.descricao, "descrição", 120), em: FieldValue.serverTimestamp(), por: req.usuario.uid });
    await auth.auditar(req, "cs.loja.foto.adicionar", uid, { fotoId: ref.id }); res.json({ ok: true, id: ref.id });
  }));
  app.get("/cs/lojas/:uid/fotos/:fid", ...ADM("csfotog", 120), envelope(async (req: any, res: any) => {
    const f = (await col(COLECOES.fotos).doc(V.idDoc(req.params.fid, "fid")).get()).data();
    if (!f || f.lojaUid !== V.idDoc(req.params.uid, "uid")) throw new Falha(404, "Foto não encontrada.", "nao-encontrado");
    res.setHeader("Content-Type", "image/jpeg"); res.setHeader("X-Content-Type-Options", "nosniff"); res.send(G.Buffer.from(f.imagem, "base64"));
  }));
  app.delete("/cs/lojas/:uid/fotos/:fid", ...ADM("csfoto", 20), envelope(async (req: any, res: any) => {
    const ref = col(COLECOES.fotos).doc(V.idDoc(req.params.fid, "fid")), f = (await ref.get()).data();
    if (!f || f.lojaUid !== V.idDoc(req.params.uid, "uid")) throw new Falha(404, "Foto não encontrada.", "nao-encontrado");
    await ref.delete(); await auth.auditar(req, "cs.loja.foto.remover", f.lojaUid, { fotoId: ref.id }); res.json({ ok: true });
  }));
  app.post("/cs/lojas/:uid/interacoes", ...ADM("csinter", 60), envelope(async (req: any, res: any) => {
    const uid = V.idDoc(req.params.uid, "uid"); await existeLoja(uid);
    const tipo = V.opcao(req.body?.tipo, ["ligacao", "visita", "email", "whatsapp", "nota", "acao_churn"], "tipo"), ref = col(COLECOES.interacoes).doc();
    await ref.set({ lojaUid: uid, tipo, texto: txt(req.body?.texto, "texto", 500, 3), autorUid: req.usuario.uid, autorNome: autor(req), em: FieldValue.serverTimestamp(), status: tipo === "acao_churn" ? "aberta" : null });
    svc.invalidar(); res.json({ ok: true, id: ref.id });
  }));
  app.put("/cs/interacoes/:id/concluir", ...ADM("csinter", 60), envelope(async (req: any, res: any) => {
    const ref = col(COLECOES.interacoes).doc(V.idDoc(req.params.id, "id")), i = (await ref.get()).data();
    if (!i || i.tipo !== "acao_churn") throw new Falha(404, "Ação não encontrada.", "nao-encontrado");
    await ref.set({ status: "concluida", concluidaEm: FieldValue.serverTimestamp() }, { merge: true }); svc.invalidar(); res.json({ ok: true });
  }));

  // ───────────────────────── faturamento B2B (razão imutável: correção = novo lançamento "ajuste") ─────────────────────────
  app.put("/cs/faturamento/:redeId", ...ADM("csfatw", 20), envelope(async (req: any, res: any) => {
    auth.exigirRecente(req.usuario);
    const id = V.idDoc(req.params.redeId, "redeId"), ref = col(COLECOES.redes).doc(id), b = req.body || {}, patch: Record<string, unknown> = {};
    if (!(await ref.get()).exists) throw new Falha(404, "Rede não encontrada.", "nao-encontrado");
    if (b.modelo !== undefined) patch.modelo = V.opcao(b.modelo, ["prepago", "pospago"], "modelo");
    if (b.limiteCentavos !== undefined) patch.limiteCentavos = V.inteiro(b.limiteCentavos, "limite", { min: 0, max: 100_000_000_000 });
    if (b.cicloDia !== undefined) patch.cicloDia = V.inteiro(b.cicloDia, "dia de fechamento", { min: 1, max: 28 });
    if (b.inicioApuracao !== undefined) patch.inicioApuracaoEm = Timestamp.fromMillis(Date.parse(`${iso(b.inicioApuracao, "início da apuração")}T00:00:00-03:00`));
    if (!Object.keys(patch).length) throw new Falha(400, "Nada para alterar.", "dados-invalidos");
    await ref.set(patch, { merge: true }); svc.invalidar(); await auth.auditar(req, "cs.faturamento.config", id, { campos: Object.keys(patch) }); res.json({ ok: true });
  }));
  app.post("/cs/faturamento/:redeId/lancamentos", ...ADM("csfatw", 20), envelope(async (req: any, res: any) => {
    auth.exigirRecente(req.usuario);
    const id = V.idDoc(req.params.redeId, "redeId"), b = req.body || {}, tipo = V.opcao(b.tipo, ["credito", "ajuste", "fatura"], "tipo"), valor = V.inteiro(b.valorCentavos, "valor", { min: -1_000_000_000, max: 1_000_000_000 });
    if (!(await col(COLECOES.redes).doc(id).get()).exists) throw new Falha(404, "Rede não encontrada.", "nao-encontrado");
    if (valor === 0 || (tipo !== "ajuste" && valor < 0)) throw new Falha(400, "Valor inválido para este tipo de lançamento.", "dados-invalidos", { campo: "valor" });
    const ref = col(COLECOES.lancamentos).doc();
    await ref.set({ redeId: id, tipo, valorCentavos: valor, descricao: txt(b.descricao, "descrição", 140, 2), ...(tipo === "fatura" ? { paga: false } : {}), em: FieldValue.serverTimestamp(), autorUid: req.usuario.uid, autorNome: autor(req) });
    svc.invalidar(); await auth.auditar(req, "cs.faturamento.lancamento", id, { tipo, valorCentavos: valor, lancamentoId: ref.id }); res.json({ ok: true, id: ref.id });
  }));
  app.put("/cs/faturamento/:redeId/lancamentos/:id/paga", ...ADM("csfatw", 20), envelope(async (req: any, res: any) => {
    auth.exigirRecente(req.usuario);
    const ref = col(COLECOES.lancamentos).doc(V.idDoc(req.params.id, "id")), l = (await ref.get()).data();
    if (!l || l.redeId !== V.idDoc(req.params.redeId, "redeId") || l.tipo !== "fatura") throw new Falha(404, "Fatura não encontrada.", "nao-encontrado");
    await ref.set({ paga: V.booleano(req.body?.paga, "paga") }, { merge: true }); svc.invalidar(); await auth.auditar(req, "cs.faturamento.fatura_paga", l.redeId, { lancamentoId: ref.id }); res.json({ ok: true });
  }));

  // ───────────────────────── NPS B2B (disparo manual; o periódico roda no cron) ─────────────────────────
  app.post("/cs/nps/disparar", ...ADM("csnpsw", 5), envelope(async (req: any, res: any) => {
    const redeId = req.body?.redeId ? V.idDoc(req.body.redeId, "redeId") : null;
    if (!redeId && req.body?.todas !== true) throw new Falha(400, "Informe a rede ou confirme o envio para todas as lojas (todas: true).", "dados-invalidos");
    if (redeId && !(await col(COLECOES.redes).doc(redeId).get()).exists) throw new Falha(404, "Rede não encontrada.", "nao-encontrado");
    const n = await svc.dispararNps(await svc.base(true), { forcar: true, redeId });
    await auth.auditar(req, "cs.nps.disparar", redeId || "todas", { enviados: n }); res.json({ ok: true, enviados: n });
  }));

  // ───────────────────────── exportador executivo ─────────────────────────
  app.get("/cs/exportar", ...ADM("csexp", 12), envelope(async (req: any, res: any) => {
    const dias = periodo(req.query), redeId = await redeOpc(req.query), formato = V.opcao(String(req.query.formato || "pptx"), ["pptx", "html", "csv"], "formato");
    const audiencia = V.opcao(String(req.query.audiencia || (redeId ? "cliente" : "interno")), ["cliente", "interno"], "audiência") as "cliente" | "interno";
    if (audiencia === "cliente" && !redeId) throw new Falha(400, "Escolha uma rede para gerar o relatório do cliente.", "dados-invalidos");
    const [painel, contas, marcas, faturamento] = await Promise.all([svc.painel(dias, redeId), svc.contas(dias), svc.marcasPor(dias, redeId), audiencia === "interno" ? svc.faturamentoPor(redeId) : Promise.resolve([])]);
    const dados: R.DadosRelatorio = { painel, contas: contas.filter((c) => !redeId || c.redeId === redeId), marcas, faturamento, audiencia };
    let corpo: any;
    if (formato === "pptx") { try { corpo = G.Buffer.from(await R.gerarPPTX(dados)); } catch (e: any) { console.error("pptx:", e?.message); throw new Falha(501, "Exportação PPTX indisponível: instale a dependência pptxgenjs no servidor.", "pptx-indisponivel"); } }
    else corpo = formato === "html" ? R.gerarHTML(dados) : R.gerarCSV(dados);
    await auth.auditar(req, "cs.exportar", redeId || "geral", { formato, audiencia, dias });
    res.setHeader("Content-Type", MIME[formato]); res.setHeader("Content-Disposition", `attachment; filename="${R.nomeArquivo(dados, formato)}"`); res.send(corpo);
  }));

  // ───────────────────────── LOJA: recorrências ─────────────────────────
  const paraApi = (id: string, r: any): Recorrencia => ({ id, lojaUid: r.lojaUid, lojaNome: r.lojaNome, nome: r.nome, setor: r.setor, entrada: r.entrada, saida: r.saida, marcaId: r.marcaId || null, tipo: r.tipo, datas: r.datas || [], diasSemana: r.diasSemana || [], ate: r.ate || null, ativo: r.ativo !== false, geradas: r.geradas || [], ultimaFalha: r.ultimaFalha || "", criadoEm: ms(r.criadoEm) });
  app.get("/cs/loja/recorrencias", ...LOJA("csrec", 60), envelope(async (req: any, res: any) => {
    const s = await col(COLECOES.recorrencias).where("lojaUid", "==", req.usuario.uid).limit(50).get();
    res.json(s.docs.map((d: any) => paraApi(d.id, d.data())).sort((a: Recorrencia, c: Recorrencia) => c.criadoEm - a.criadoEm));
  }));
  app.post("/cs/loja/recorrencias", ...LOJA("csrecw", 15), x.operacao.exigir("missoes"), envelope(async (req: any, res: any) => {
    const u = req.usuario, b = req.body || {}, hoje = hojeSP(Date.now()), limite = somaDias(hoje, 365);
    const ativas = (await col(COLECOES.recorrencias).where("lojaUid", "==", u.uid).limit(60).get()).docs.filter((d: any) => d.data().ativo !== false);
    if (ativas.length >= 10) throw new Falha(409, "Limite de 10 programações ativas. Desative uma para criar outra.", "limite-recorrencias");
    const nome = txt(b.nome, "nome", 60, 3), setor = V.opcao(b.setor, C.SETORES, "setor"), entrada = V.hhmm(b.entrada, "entrada"), saida = V.hhmm(b.saida, "saída"), tipo = V.opcao(b.tipo, ["datas", "semanal"], "tipo");
    const erroTurno = x.S.validarTurno(entrada, saida, await x.taxas.obter()); if (erroTurno) throw new Falha(400, erroTurno, "turno-invalido");
    let datas: string[] = [], diasSemana: number[] = [], ate: string | null = null;
    if (tipo === "datas") {
      if (!Array.isArray(b.datas) || !b.datas.length || b.datas.length > 24) throw new Falha(400, "Informe de 1 a 24 datas.", "dados-invalidos", { campo: "datas" });
      datas = [...new Set<string>(b.datas.map((d: unknown) => iso(d, "data")))].sort();
      if (datas[0] < hoje || datas[datas.length - 1] > limite) throw new Falha(400, "As datas precisam estar entre hoje e os próximos 365 dias.", "dados-invalidos", { campo: "datas" });
    } else {
      if (!Array.isArray(b.diasSemana) || !b.diasSemana.length || b.diasSemana.length > 7) throw new Falha(400, "Escolha de 1 a 7 dias da semana.", "dados-invalidos", { campo: "diasSemana" });
      diasSemana = [...new Set<number>(b.diasSemana.map((d: unknown) => V.inteiro(d, "dia da semana", { min: 0, max: 6 })))].sort();
      ate = iso(b.ate, "data final"); if (ate < hoje || ate > limite) throw new Falha(400, "A data final precisa estar entre hoje e os próximos 365 dias.", "dados-invalidos", { campo: "ate" });
    }
    const marca = await x.marcaDoPedido(b.marcaId), cont = (await col("contratantes").doc(u.uid).get()).data() || {}, ficha = (await col(COLECOES.lojas).doc(u.uid).get()).data() || {};
    const ref = col(COLECOES.recorrencias).doc();
    await ref.set({ lojaUid: u.uid, lojaNome: String(ficha.nome || cont.nome || "Loja").slice(0, 160).padEnd(3, " "), nome, setor, entrada, saida, marcaId: marca?.marcaId || null, tipo, datas, diasSemana, ate, ativo: true, geradas: [], ultimaFalha: "", criadoEm: FieldValue.serverTimestamp() });
    res.json({ ok: true, id: ref.id });
  }));
  app.delete("/cs/loja/recorrencias/:id", ...LOJA("csrecw", 15), envelope(async (req: any, res: any) => {
    const ref = col(COLECOES.recorrencias).doc(V.idDoc(req.params.id, "id")), r = (await ref.get()).data();
    if (!r || r.lojaUid !== req.usuario.uid) throw new Falha(404, "Programação não encontrada.", "nao-encontrado");          // 404 (não 403): sem IDOR
    await ref.set({ ativo: false, desativadaEm: FieldValue.serverTimestamp() }, { merge: true }); res.json({ ok: true });
  }));

  // ───────────────────────── LOJA: responder NPS ─────────────────────────
  app.get("/cs/loja/nps/pendente", ...LOJA("csnpsl", 30), envelope(async (req: any, res: any) => {
    const s = await col(COLECOES.nps).where("lojaUid", "==", req.usuario.uid).limit(30).get(), agora = Date.now();
    const p = s.docs.filter((d: any) => d.data().status === "pendente" && (!ms(d.data().expiraEm) || ms(d.data().expiraEm) > agora)).sort((a: any, c: any) => ms(c.data().criadoEm) - ms(a.data().criadoEm))[0];
    res.json(p ? { id: p.id, criadoEm: ms(p.data().criadoEm) } : null);
  }));
  app.post("/cs/loja/nps/:id/responder", ...LOJA("csnpsr", 10), envelope(async (req: any, res: any) => {
    const ref = col(COLECOES.nps).doc(V.idDoc(req.params.id, "id")), nota = V.inteiro(req.body?.nota, "nota", { min: 0, max: 10 }), comentario = txt(req.body?.comentario, "comentário", 500);
    await db.runTransaction(async (tx: any) => {
      const e = (await tx.get(ref)).data();
      if (!e || e.lojaUid !== req.usuario.uid) throw new Falha(404, "Pesquisa não encontrada.", "nao-encontrado");
      if (e.status !== "pendente") throw new Falha(409, "Esta pesquisa já foi respondida ou expirou.", "ja-respondida");
      tx.update(ref, { status: "respondido", nota, comentario, respondidoEm: FieldValue.serverTimestamp() });
    });
    svc.invalidar(); res.json({ ok: true });
  }));

  // ───────────────────────── CRON ─────────────────────────
  app.post("/interno/cs-manutencao", limitar({ janelaMs: 60_000, max: 10, nome: "cron-cs" }), envelope(async (req: any, res: any) => {
    if (!CRON_SECRET || !Cripto.igualSeguro(req.get("x-cron-secret") || "", CRON_SECRET)) throw new Falha(401, "não autorizado", "nao-autenticado");
    res.json(await svc.manutencao());
  }));
  return svc;
};
