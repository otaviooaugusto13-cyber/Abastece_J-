// Hooks de tempo real. As coleções são LIDAS direto do Firestore (listeners onSnapshot; as regras liberam só admin) e ESCRITAS só pela API.
//   suporte_conversas  → fila (até 200, mais recentes primeiro)      suporte_tickets  → protocolo/estado de cada conversa
//   suporte_mensagens  → mensagens da conversa aberta                 ficha            → GET /admin/suporte/:uid/perfil (com cache e pré-carga)
import { useEffect, useRef, useState } from "react";
import { collection, query, orderBy, limit, where, onSnapshot } from "firebase/firestore";
import { ordenarMensagens } from "./logica.js";

export function useConversas(db) {
  const [estado, setEstado] = useState({ itens: [], carregando: true, erro: null, inicial: true });
  useEffect(() => {
    if (!db) return undefined;
    const q = query(collection(db, "suporte_conversas"), orderBy("ultimaEm", "desc"), limit(200));
    return onSnapshot(q, (s) => setEstado({ itens: s.docs.map((d) => ({ uid: d.id, ...d.data() })), carregando: false, erro: null }), (erro) => setEstado((e) => ({ ...e, carregando: false, erro })));
  }, [db]);
  return estado;
}

/** `mapa`: uid → ticket vigente. `pronto`: o primeiro snapshot já chegou (evita abrir protocolo "à toa" antes de saber o que existe). */
export function useTickets(db) {
  const [estado, setEstado] = useState({ mapa: new Map(), pronto: false });
  useEffect(() => {
    if (!db) return undefined;
    return onSnapshot(query(collection(db, "suporte_tickets"), limit(500)), (s) => setEstado({ mapa: new Map(s.docs.map((d) => [d.id, { uid: d.id, ...d.data() }])), pronto: true }), (e) => { console.warn("tickets:", e); setEstado((x) => ({ ...x, pronto: true })); });
  }, [db]);
  return estado;
}

export function useMensagens(db, uid) {
  const [estado, setEstado] = useState({ itens: [], carregando: !!uid, erro: null });
  useEffect(() => {
    setEstado({ itens: [], carregando: !!uid, erro: null });
    if (!db || !uid) return undefined;
    // sem orderBy: o id começa com o relógio, então ordenar por id no cliente é a ordem cronológica (e dispensa índice composto)
    return onSnapshot(query(collection(db, "suporte_mensagens"), where("uid", "==", uid)), (s) => setEstado({ itens: ordenarMensagens(s.docs.map((d) => ({ id: d.id, ...d.data() }))), carregando: false, erro: null }), (erro) => setEstado({ itens: [], carregando: false, erro }));
  }, [db, uid]);
  return estado;
}

// ---------- ficha: cache em memória + pré-carga leve (sem dados pessoais) ----------
const cache = new Map(), emVoo = new Map();
export function buscarPerfil(api, uid, { leve = false } = {}) {
  const chave = `${uid}|${leve ? 1 : 0}`;
  if (emVoo.has(chave)) return emVoo.get(chave);
  const p = api.perfil(uid, { leve }).then((r) => { const atual = cache.get(uid); if (!leve || !atual || atual.parcial) cache.set(uid, r); return r; }).finally(() => emVoo.delete(chave));
  emVoo.set(chave, p); return p;
}
/** Ao passar o mouse/foco numa conversa: baixa a ficha leve para a abertura parecer instantânea. Sem auditoria e sem dados pessoais. */
export const prefetchPerfil = (api, uid) => { if (uid && !cache.has(uid)) buscarPerfil(api, uid, { leve: true }).catch(() => {}); };
export const limparCachePerfil = () => { cache.clear(); emVoo.clear(); };

/** Mostra na hora o que houver em cache e atualiza em segundo plano com a ficha completa (consulta auditada pelo servidor). */
export function usePerfil(api, uid) {
  const [estado, setEstado] = useState({ perfil: null, carregando: false, erro: null });
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    if (!uid) { setEstado({ perfil: null, carregando: false, erro: null }); return undefined; }
    let vivo = true;
    setEstado({ perfil: cache.get(uid) || null, carregando: true, erro: null });
    buscarPerfil(api, uid).then((perfil) => vivo && setEstado({ perfil, carregando: false, erro: null })).catch((erro) => vivo && setEstado((s) => ({ ...s, carregando: false, erro })));
    return () => { vivo = false; };
  }, [api, uid, tentativa]);
  return { ...estado, recarregar: () => setTentativa((n) => n + 1) };
}

/** Relógio que "vira" a cada `intervaloMs` (tempos de espera e rótulos relativos). */
export function useAgora(intervaloMs = 30_000) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setAgora(Date.now()), intervaloMs); return () => clearInterval(i); }, [intervaloMs]);
  return agora;
}

/** Valor mais recente sem recriar efeitos. */
export function useRef2(valor) { const r = useRef(valor); r.current = valor; return r; }
