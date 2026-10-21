// Inicialização única do Firebase (antes cada página repetia a config).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, connectAuthEmulator, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { FIREBASE_CONFIG, FUNCTIONS_BASE, USAR_EMULADOR } from "./config.js";

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getFirestore(app);
if (USAR_EMULADOR) { connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true }); connectFirestoreEmulator(db, "localhost", 8080); }
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

/** Chama uma Cloud Function HTTP autenticada. */
export async function chamarFuncao(nome, corpo = {}) {
    if (!FUNCTIONS_BASE) throw Object.assign(new Error("backend-nao-configurado"), { code: "backend-nao-configurado" });
    const idToken = await auth.currentUser.getIdToken();
    const r = await fetch(`${FUNCTIONS_BASE}/${nome}`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(corpo)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.erro || "falha"), { code: j.codigo || r.status, detalhe: j.detalhe });
    return j;
}

// ---------- Modo de teste (sandbox): só aparece se o servidor estiver com MODO_TESTE=1 ----------
export async function testeAtivo() {
    try { const r = await fetch(`${FUNCTIONS_BASE}/teste/status`); return r.ok && (await r.json()).ativo === true; } catch (e) { return false; }
}
/** Entra com uma conta fictícia ("loja" ou "promotor"), sem Google e sem Mercado Pago. */
export async function loginDeTeste(perfil) {
    const r = await fetch(`${FUNCTIONS_BASE}/teste/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ perfil }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.erro || "falha"), { code: j.codigo || r.status });
    return signInWithCustomToken(auth, j.customToken);
}
/** true se a sessão atual é uma conta de teste (claim emitido pelo servidor). */
export async function contaDeTeste() {
    try { return (await auth.currentUser.getIdTokenResult()).claims.teste === true; } catch (e) { return false; }
}
