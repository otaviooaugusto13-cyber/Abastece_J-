// Inicialização única do Firebase (antes cada página repetia a config).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { FIREBASE_CONFIG, FUNCTIONS_BASE } from "./config.js";

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getFirestore(app);
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
    if (!r.ok) throw Object.assign(new Error(j.erro || "falha"), { code: j.codigo || r.status });
    return j;
}
