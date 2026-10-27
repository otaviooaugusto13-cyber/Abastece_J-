#!/usr/bin/env node
// Concede o papel "admin" a uma conta. É o ÚNICO caminho para criar administradores (a API nunca concede esse papel).
//   Uso:  FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/definir-admin.js pessoa@empresa.com [--remover]
// A pessoa precisa ter entrado ao menos uma vez com Google. Recomendado: ativar verificação em duas etapas no
// Firebase Auth (Identity Platform) e definir ADMIN_EXIGE_MFA=1 no servidor.
const admin = require("firebase-admin");
const email = process.argv[2], remover = process.argv.includes("--remover");
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error("Uso: node scripts/definir-admin.js email@dominio [--remover]"); process.exit(1); }
const bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!bruto) { console.error("Defina FIREBASE_SERVICE_ACCOUNT (JSON ou base64)."); process.exit(1); }
const json = bruto.trim().startsWith("{") ? bruto : Buffer.from(bruto, "base64").toString("utf8");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(json)) });
(async () => {
  const u = await admin.auth().getUserByEmail(email);
  const claims = { ...(u.customClaims || {}) };
  if (remover) delete claims.role; else claims.role = "admin";
  await admin.auth().setCustomUserClaims(u.uid, claims);
  await admin.auth().revokeRefreshTokens(u.uid);          // força novo login com o novo papel
  await admin.firestore().collection("usuarios").doc(u.uid).set({ uid: u.uid, email, ...(remover ? {} : { role: "admin" }), atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await admin.firestore().collection("auditoria").doc().set({ em: admin.firestore.FieldValue.serverTimestamp(), uid: "script", papel: "operador", acao: remover ? "admin.remover" : "admin.conceder", alvo: u.uid, ip: "", ua: "scripts/definir-admin.js", detalhes: { email } });
  console.log(`${remover ? "Papel admin removido de" : "Papel admin concedido a"} ${email} (${u.uid}). A pessoa deve entrar novamente.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
