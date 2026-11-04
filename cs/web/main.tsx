/** Entrada do bundle /painel-cs: login Google (mesmo fluxo por redirecionamento do app) e roteamento por papel — admin: painel de CS; loja: recorrências + NPS. */
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, getRedirectResult, onAuthStateChanged, signInWithRedirect, signOut, type User } from "firebase/auth";
import { FIREBASE_CONFIG, FUNCTIONS_BASE } from "../../config.js";
import CsB2bDashboard from "./CsB2bDashboard";
import { NpsLoja, RecorrenciasLoja } from "./abas";
import { criarApi } from "./api";
import { Aviso } from "./ui";
import "./cs.css";

const auth = getAuth(initializeApp(FIREBASE_CONFIG)), provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined), [papel, setPapel] = useState(""), [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  useEffect(() => { void getRedirectResult(auth).catch(() => {}); return onAuthStateChanged(auth, async (u) => { setUser(u); setPapel(u ? String((await u.getIdTokenResult()).claims.role || "") : ""); }); }, []);
  const getToken = useCallback(async () => { if (!auth.currentUser) throw new Error("Sua sessão terminou. Entre novamente."); return auth.currentUser.getIdToken(); }, []);
  const reautenticar = useCallback(() => void signInWithRedirect(auth, provider), []);
  const api = useMemo(() => criarApi(getToken, FUNCTIONS_BASE || "", reautenticar), [getToken, reautenticar]);
  const avisar = useCallback((tipo: "ok" | "erro", texto: string) => { setAviso({ tipo, texto }); setTimeout(() => setAviso(null), 6000); }, []);
  if (user === undefined) return <div className="cs-login">Carregando…</div>;
  if (!user) return <div className="cs-login"><div><h1 style={{ color: "#d4af37" }}>Abastece Já · Sucesso do Cliente</h1><button className="ouro" onClick={reautenticar}>Entrar com Google</button></div></div>;
  if (papel === "admin") return <CsB2bDashboard getToken={getToken} apiBase={FUNCTIONS_BASE || ""} onReautenticar={reautenticar} />;
  if (papel === "loja") return <div className="cs-app"><div className="cs-topo"><h1>Minhas reposições</h1><button className="sec" onClick={() => void signOut(auth)}>Sair</button></div><div className="cs-grade"><NpsLoja api={api} avisar={avisar} /><RecorrenciasLoja api={api} avisar={avisar} /></div><Aviso aviso={aviso} fechar={() => setAviso(null)} /></div>;
  return <div className="cs-login"><div><p>Esta conta não tem acesso a este painel.</p><button className="sec" onClick={() => void signOut(auth)}>Sair</button></div></div>;
}
createRoot(document.getElementById("raiz")!).render(<StrictMode><App /></StrictMode>);
