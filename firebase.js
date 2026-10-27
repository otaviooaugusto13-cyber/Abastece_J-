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

/** Chama a API do servidor (token no cabeçalho Authorization; nunca em URL). `metodo` padrão: POST (ou GET se corpo === null). */
export async function chamarFuncao(nome, corpo = {}, metodo) {
    if (!FUNCTIONS_BASE) throw Object.assign(new Error("backend-nao-configurado"), { code: "backend-nao-configurado" });
    const idToken = await auth.currentUser.getIdToken();
    const m = metodo || (corpo === null ? "GET" : "POST");
    const r = await fetch(`${FUNCTIONS_BASE}/${nome}`, {
        method: m, headers: { ...(m === "GET" ? {} : { "Content-Type": "application/json" }), Authorization: `Bearer ${idToken}` },
        ...(m === "GET" ? {} : { body: JSON.stringify(corpo || {}) })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.erro || "falha"), { code: j.codigo || r.status, status: r.status, detalhe: j.detalhe });
    return j;
}
export const consultar = (nome) => chamarFuncao(nome, null, "GET");

/** Baixa um CSV protegido (exige login): faz GET com o token e salva o arquivo. */
export async function baixarCSVProtegido(caminho, nomeArquivo) {
    const idToken = await auth.currentUser.getIdToken();
    const r = await fetch(`${FUNCTIONS_BASE}/${caminho}`, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.erro || "falha"), { code: j.codigo || r.status }); }
    const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = nomeArquivo; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Depois de cadastro, treinamento ou mudança de papel o servidor atualiza as claims: pede um token novo. */
export const renovarToken = () => auth.currentUser?.getIdToken(true);
/** Papel atual (loja | promotor | admin) lido do token assinado. */
export async function papelAtual() { try { return (await auth.currentUser.getIdTokenResult()).claims.role || null; } catch (e) { return null; } }

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
