// Check-in / check-out do turno (profissional). O horário gravado é o do SERVIDOR (não do celular).
// Não bloqueia pagamento: marca divergências (atraso, saída antecipada) para o admin acompanhar.
module.exports = (app, x) => {
  const { db, FieldValue, auth, V, Falha, envelope, limitar, hojeSP } = x;
  const porUsuario = (nome, max) => limitar({ janelaMs: 60_000, max, nome, porUsuario: true });
  const ANTECEDENCIA_MIN = 60, TOLERANCIA_ATRASO_MIN = 15, PCT_MIN_CUMPRIDO = 0.8;
  const hhmm = (s) => { const [h, m] = String(s || "0:0").split(":").map(Number); return h * 60 + m; };
  const agoraSP = () => { const [h, m] = new Date().toLocaleTimeString("en-GB", { timeZone: "America/Sao_Paulo", hour12: false, hour: "2-digit", minute: "2-digit" }).split(":").map(Number); return (h % 24) * 60 + m; };
  const geo = (b) => {
    if (b?.lat === undefined) return null;                                  // localização é opcional
    const lat = Number(b.lat), lng = Number(b.lng);
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw new Falha(400, "Localização inválida.", "geo-invalida");
    return { lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)), prec: Math.min(Math.max(Number(b.prec) || 0, 0), 99999) };
  };
  const meuTurno = (s, uid) => { if (!s || s.promotorUid !== uid) throw new Falha(404, "Turno não encontrado.", "nao-encontrado"); if (!["aceita", "paga"].includes(s.status)) throw new Falha(409, "Este turno não está em andamento.", "estado-invalido"); };

  app.post("/turnos/:id/checkin", porUsuario("checkin", 20), auth.exigir("promotor"), envelope(async (req, res) => {
    const ref = db.collection("solicitacoes").doc(V.idDoc(req.params.id, "id")), g = geo(req.body);
    const r = await db.runTransaction(async (tx) => {
      const s = (await tx.get(ref)).data(); meuTurno(s, req.usuario.uid);
      if (s.data !== hojeSP()) throw new Falha(409, "O check-in só pode ser feito no dia do turno.", "fora-do-dia");
      if (s.checkinEm) throw new Falha(409, "Check-in já registrado.", "ja-registrado");
      const agora = agoraSP(), atraso = agora - hhmm(s.entrada);
      if (atraso < -ANTECEDENCIA_MIN) throw new Falha(409, `O check-in abre ${ANTECEDENCIA_MIN} min antes do início (${s.entrada}).`, "cedo-demais");
      if (hhmm(s.saida) > hhmm(s.entrada) && agora > hhmm(s.saida)) throw new Falha(409, "O horário deste turno já terminou.", "turno-encerrado");
      tx.update(ref, { checkinEm: FieldValue.serverTimestamp(), checkinAtrasoMin: Math.max(0, atraso), ...(g ? { checkinGeo: g } : {}) });
      return { atrasoMin: Math.max(0, atraso) };
    });
    res.json({ ok: true, ...r });
  }));

  app.post("/turnos/:id/checkout", porUsuario("checkout", 20), auth.exigir("promotor"), envelope(async (req, res) => {
    const ref = db.collection("solicitacoes").doc(V.idDoc(req.params.id, "id")), g = geo(req.body);
    const r = await db.runTransaction(async (tx) => {
      const s = (await tx.get(ref)).data(); meuTurno(s, req.usuario.uid);
      if (!s.checkinEm) throw new Falha(409, "Faça o check-in antes do check-out.", "sem-checkin");
      if (s.checkoutEm) throw new Falha(409, "Check-out já registrado.", "ja-registrado");
      const trabalhadoMin = Math.round((Date.now() - s.checkinEm.toMillis()) / 60000), divergencias = [];
      if ((s.checkinAtrasoMin || 0) > TOLERANCIA_ATRASO_MIN) divergencias.push("atraso");
      if (trabalhadoMin < Math.floor((s.minutos || 0) * PCT_MIN_CUMPRIDO)) divergencias.push("saida-antecipada");
      tx.update(ref, { checkoutEm: FieldValue.serverTimestamp(), trabalhadoMin, divergencias, ...(g ? { checkoutGeo: g } : {}) });
      return { trabalhadoMin, divergencias };
    });
    res.json({ ok: true, ...r });
  }));
};
