"use client";
// app/admin/suporte/page.jsx (Next.js App Router). Pré-requisitos: `npm i firebase react react-dom` e as variáveis NEXT_PUBLIC_API_BASE / NEXT_PUBLIC_FIREBASE_*.
// O painel só funciona para contas com a claim role = "admin" (é isso que as regras do Firestore e a API exigem).
import { useEffect, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import SuportePanel from "@/painel-suporte/SuportePanel";   // ajuste o alias ao seu projeto

const app = getApps()[0] || initializeApp({ apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID });
const auth = getAuth(app), db = getFirestore(app);

export default function PaginaSuporte() {
  const [user, setUser] = useState(undefined);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  if (user === undefined) return null;
  if (!user) return <p style={{ padding: 24 }}>Entre com a sua conta de administrador.</p>;
  return (
    <SuportePanel db={db} apiBase={process.env.NEXT_PUBLIC_API_BASE} atendente={{ uid: user.uid, nome: user.displayName || user.email }}
      getToken={(forcar) => user.getIdToken(forcar)} />
  );
}
