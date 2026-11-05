// Documento de identificação (RG/CNH) enviado para aprovação do perfil.
//  - Cada lado (frente/verso) vira um documento próprio em documentos_identidade/{uid}/lados/{lado}, com o JPEG CIFRADO
//    (AES-256-GCM, mesma chave dos dados sensíveis; o AAD amarra o conteúdo ao uid e ao lado).
//  - O Firestore nunca é lido pelo navegador para esta coleção (a regra padrão "negar tudo" já a cobre): só o servidor lê/escreve.
//  - O perfil (profissionais/contratantes) recebe só o marcador `documentoStatus`.
const TIPOS = { rg: ["frente", "verso"], cnh: ["frente"] };       // lados OBRIGATÓRIOS de cada tipo
const LADOS = ["frente", "verso"];
const LADO_MAX_MIN = 800;                                          // maior lado da foto, em px: abaixo disso o texto do documento não é legível

module.exports = function criarDocumento({ db, FieldValue, Cripto, Img, Falha, C }) {
  const ref = (uid) => db.collection("documentos_identidade").doc(uid);
  const ladoRef = (uid, lado) => ref(uid).collection("lados").doc(lado);
  const perfilRef = (papel, uid) => db.collection(papel === "loja" ? "contratantes" : "profissionais").doc(uid);
  const contexto = (uid, lado) => `documentos_identidade/${lado}/${uid}`;
  const ts = () => FieldValue.serverTimestamp();

  async function ladosEnviados(uid) { return (await ref(uid).collection("lados").get()).docs.map((d) => d.id).filter((l) => LADOS.includes(l)); }

  async function estado(uid) {
    const d = await ref(uid).get();
    if (!d.exists) return { status: "nenhum", lados: [] };
    const x = d.data();
    return { tipo: x.tipo, status: x.status, motivo: x.status === "recusado" ? x.motivo || "" : "", lados: await ladosEnviados(uid) };
  }

  /** Valida e guarda UM lado. Devolve o estado resultante (`enviado` quando os lados obrigatórios do tipo já existem). */
  async function salvarLado({ uid, papel, tipo, lado, dataUrl }) {
    if (!TIPOS[tipo]) throw new Falha(400, "Escolha RG ou CNH.", "tipo-invalido");
    if (!LADOS.includes(lado)) throw new Falha(400, "Lado do documento inválido.", "lado-invalido");
    const atual = (await ref(uid).get()).data() || {};
    if (atual.status === "aprovado") throw new Falha(409, "Seu documento já foi aprovado.", "documento-aprovado");
    const buf = Img.jpegDeDataUrl(dataUrl, "documento", { min: 15_000, max: C.FOTO.MAX_BYTES });
    const { largura, altura } = Img.dimensoesJpeg(buf);
    if (Math.max(largura, altura) < LADO_MAX_MIN) throw new Falha(400, "A foto está pequena demais. Aproxime o documento e tente de novo.", "foto-invalida");

    if (atual.tipo && atual.tipo !== tipo) for (const l of LADOS) await ladoRef(uid, l).delete();     // trocou RG ↔ CNH: recomeça, sem misturar lados
    await ladoRef(uid, lado).set({ bytes: Cripto.cifrarBytes(buf, contexto(uid, lado)), sha256: Img.sha256(buf), largura, altura, tamanho: buf.length, em: ts() });

    const lados = await ladosEnviados(uid), completo = TIPOS[tipo].every((l) => lados.includes(l));
    const status = completo ? "enviado" : "incompleto";
    await ref(uid).set({ tipo, papel, status, atualizadoEm: ts(), motivo: FieldValue.delete(), ...(completo ? { enviadoEm: ts() } : {}) }, { merge: true });
    await perfilRef(papel, uid).set({ documentoStatus: status }, { merge: true });
    return { status, lados };
  }

  /** Imagem decifrada (uso exclusivo do painel admin; a leitura deve ser auditada pela rota). */
  async function ler(uid, lado) {
    if (!LADOS.includes(lado)) throw new Falha(400, "Lado do documento inválido.", "lado-invalido");
    const d = await ladoRef(uid, lado).get();
    if (!d.exists) throw new Falha(404, "Imagem não encontrada.", "nao-encontrado");
    return Cripto.decifrarBytes(Buffer.from(d.data().bytes), contexto(uid, lado));
  }

  async function pendentes(limite = 100) {
    const s = await db.collection("documentos_identidade").where("status", "==", "enviado").limit(limite).get();
    return s.docs.map((d) => ({ uid: d.id, papel: d.data().papel, tipo: d.data().tipo }));
  }

  async function decidir({ uid, status, motivo, por }) {
    if (!["aprovado", "recusado"].includes(status)) throw new Falha(400, "Decisão inválida.", "status-invalido");
    const d = await ref(uid).get();
    if (!d.exists || d.data().status !== "enviado") throw new Falha(409, "Não há documento completo aguardando análise.", "sem-documento-pendente");
    if (status === "recusado" && !(motivo && motivo.length >= 3)) throw new Falha(400, "Explique o motivo da recusa (mín. 3 caracteres).", "motivo-obrigatorio");
    const papel = d.data().papel;
    await ref(uid).set({ status, decididoPor: por, decididoEm: ts(), ...(status === "recusado" ? { motivo } : { motivo: FieldValue.delete() }) }, { merge: true });
    await perfilRef(papel, uid).set({
      documentoStatus: status,
      ...(status === "recusado" ? { recado: { texto: `Documento recusado: ${motivo}`, tipo: "info", por: "suporte", em: ts() } } : {})   // o recado já aparece para o usuário (mesmo mecanismo do /admin/recado)
    }, { merge: true });
    return { status };
  }

  return { estado, salvarLado, ler, pendentes, decidir, TIPOS };
};
