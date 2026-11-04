"use client";
// ============================================================================================================
// PAINEL DE SUPORTE AO CLIENTE — Abastece Já.   Fila + chat + ficha do usuário, tudo em tempo real.
//
// Uso (Next.js / Vite):
//   <SuportePanel db={db} getToken={(forcar) => auth.currentUser.getIdToken(forcar)} apiBase={process.env.NEXT_PUBLIC_API_BASE}
//                 atendente={{ uid: user.uid, nome: user.displayName }} />
//   • db: instância do Firestore (firebase/firestore). As LEITURAS em tempo real são listeners direto nele (regras: só admin lê).
//   • As ESCRITAS (responder, marcar lido, protocolo, escalar, resolver) vão para a API do servidor: ele valida, limita, audita e notifica.
// ============================================================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./SuportePanel.module.css";
import { criarApi } from "./api.js";
import { prefetchPerfil, useAgora, useConversas, useMensagens, usePerfil, useTickets } from "./hooks.js";
import { contarAbas, filtrarConversas, ms } from "./logica.js";
import { macroPorAtalho, renderizarMacro } from "./macros.js";
import FilaConversas from "./FilaConversas.jsx";
import AreaChat from "./AreaChat.jsx";
import FichaUsuario from "./FichaUsuario.jsx";
import ModalEscalar from "./ModalEscalar.jsx";

export default function SuportePanel({ db, getToken, apiBase = "", atendente = { nome: "Atendente" }, className = "" }) {
  // ---------- API (getToken muda de identidade a cada render do pai: guardamos em ref para não recriar o cliente) ----------
  const tokenRef = useRef(getToken); tokenRef.current = getToken;
  const api = useMemo(() => criarApi({ getToken: (f) => tokenRef.current(f), apiBase }), [apiBase]);

  // ---------- dados em tempo real ----------
  const agora = useAgora(30_000);
  const conversas = useConversas(db), { mapa: tickets, pronto: ticketsProntos } = useTickets(db);
  const [aba, setAba] = useState("todos"), [busca, setBusca] = useState(""), [selUid, setSelUid] = useState(null);
  const [tela, setTela] = useState("fila"), [fichaAberta, setFichaAberta] = useState(false), [modalEscalar, setModalEscalar] = useState(false);
  const [rascunhos, setRascunhos] = useState({}), [enviando, setEnviando] = useState(false), [toasts, setToasts] = useState([]);
  const composerRef = useRef(null);

  const lista = useMemo(() => filtrarConversas(conversas.itens, tickets, aba, busca), [conversas.itens, tickets, aba, busca]);
  const contagens = useMemo(() => contarAbas(conversas.itens, tickets), [conversas.itens, tickets]);
  const conv = useMemo(() => conversas.itens.find((c) => c.uid === selUid) || null, [conversas.itens, selUid]);
  const ticket = conv ? tickets.get(conv.uid) || null : null;
  const msgs = useMensagens(db, selUid), perfilEstado = usePerfil(api, selUid);
  const rascunho = rascunhos[selUid] || "";

  // ---------- avisos ----------
  const avisar = useCallback((texto, tipo = "info", uid = null) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((t) => [...t.slice(-3), { id, texto, tipo, uid }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6500);
  }, []);
  const copiar = useCallback(async (texto, msg = "Copiado") => {
    try { await navigator.clipboard.writeText(String(texto)); avisar(msg, "ok"); return true; } catch { avisar("Não foi possível copiar. Selecione o texto e copie manualmente.", "erro"); return false; }
  }, [avisar]);

  // ---------- seleção ----------
  const selecionar = useCallback((uid) => { setSelUid(uid); setTela("chat"); setFichaAberta(false); }, []);
  // no celular não abre o teclado sozinho ao escolher a conversa
  useEffect(() => { if (selUid && window.matchMedia("(min-width: 821px)").matches) composerRef.current?.focus({ preventScroll: true }); }, [selUid, conv?.uid]);

  // ---------- título da aba do navegador com o total de pendências ----------
  useEffect(() => {
    const antes = document.title; document.title = contagens.pendentes > 0 ? `(${contagens.pendentes}) Suporte · Abastece Já` : "Suporte · Abastece Já";
    return () => { document.title = antes; };
  }, [contagens.pendentes]);

  // ---------- aviso de mensagem nova em OUTRA conversa (o primeiro snapshot não avisa) ----------
  const vistos = useRef(null);
  useEffect(() => {
    if (conversas.carregando) return;
    if (vistos.current) for (const c of conversas.itens) {
      if (ms(c.ultimaEm) > (vistos.current.get(c.uid) ?? 0) && c.ultimaDe === "usuario" && !(c.uid === selUid && !document.hidden)) avisar(`${c.nome || "Usuário"}: ${c.ultimaMsg}`, "nova", c.uid);
    }
    vistos.current = new Map(conversas.itens.map((c) => [c.uid, ms(c.ultimaEm)]));
  }, [conversas.itens, conversas.carregando, selUid, avisar]);

  // ---------- marcar como lido (só com a aba visível) ----------
  const [visivel, setVisivel] = useState(() => typeof document === "undefined" || !document.hidden), lendo = useRef(false);
  useEffect(() => { const h = () => setVisivel(!document.hidden); document.addEventListener("visibilitychange", h); return () => document.removeEventListener("visibilitychange", h); }, []);
  useEffect(() => {
    if (!conv || !(conv.naoLidasSuporte > 0) || !visivel || lendo.current) return;
    lendo.current = true; api.marcarLido(conv.uid).catch(() => {}).finally(() => { lendo.current = false; });
  }, [conv?.uid, conv?.naoLidasSuporte, conv?.ultimaEm, visivel, api]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- protocolo: garante um ticket vigente ao abrir (ou quando o usuário volta a escrever depois de resolvido) ----------
  const tentouTicket = useRef("");
  useEffect(() => {
    if (!conv || !ticketsProntos) return;
    const precisa = !ticket || (ticket.status === "resolvido" && ms(conv.ultimaEm) > ms(ticket.resolvidoMs));
    const chave = `${conv.uid}|${ticket?.protocolo || ""}`;
    if (!precisa || tentouTicket.current === chave) return;
    tentouTicket.current = chave;
    api.garantirTicket(conv.uid).catch((e) => avisar(`Não foi possível gerar o protocolo: ${e.message}`, "erro"));
  }, [conv, ticket, ticketsProntos, api, avisar]);

  // ---------- ações ----------
  const setRascunho = (uid, v) => setRascunhos((r) => ({ ...r, [uid]: v }));
  const enviar = async (texto) => {
    setEnviando(true);
    try { await api.enviar(conv.uid, texto); setRascunho(conv.uid, ""); }
    catch (e) { avisar(e.message, "erro"); throw e; }
    finally { setEnviando(false); }
  };
  const aplicarMacro = useCallback((macro, substituir) => {
    if (!conv || !macro) return;
    const texto = renderizarMacro(macro.texto, { nome: conv.nome, protocolo: ticket?.protocolo, atendente: atendente.nome });
    setRascunhos((r) => { const atual = (r[conv.uid] || "").replace(/\s+$/, ""); return { ...r, [conv.uid]: substituir || !atual || atual.startsWith("/") ? texto : `${atual}\n\n${texto}` }; });
    requestAnimationFrame(() => { const el = composerRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  }, [conv, ticket?.protocolo, atendente.nome]);
  const escalar = async (pedido) => {
    const r = await api.escalar(conv.uid, pedido);
    setModalEscalar(false); avisar(`Escalado: chamado ${r.chamado.protocolo} na fila ${r.chamado.destino === "gestao" ? "da Gestão/ADM" : "de TI"}.`, "ok");
  };
  const resolver = async () => { try { const t = await api.resolver(conv.uid); avisar(`Atendimento ${t.protocolo} resolvido.`, "ok"); } catch (e) { avisar(e.message, "erro"); } };

  // ---------- atalhos: Alt+1…9 aplica a macro; Alt+↑/↓ troca de conversa; Esc fecha a ficha ----------
  useEffect(() => {
    const h = (e) => {
      if (modalEscalar) return;
      if (e.key === "Escape" && fichaAberta) { setFichaAberta(false); return; }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const dig = /^Digit([1-9])$/.exec(e.code);
      if (dig && conv) { const m = macroPorAtalho(Number(dig[1])); if (m) { e.preventDefault(); aplicarMacro(m, false); } return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const i = lista.findIndex((c) => c.uid === selUid), prox = lista[i + (e.key === "ArrowDown" ? 1 : -1)] || (i < 0 ? lista[0] : null);
        if (prox) { e.preventDefault(); selecionar(prox.uid); }
      }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [modalEscalar, fichaAberta, conv, lista, selUid, aplicarMacro, selecionar]);

  return (
    <div className={`${styles.raiz} ${className}`} data-tela={tela}>
      <FilaConversas conversas={lista} contagens={contagens} aba={aba} onAba={setAba} busca={busca} onBusca={setBusca} selUid={selUid} onSelecionar={selecionar}
        tickets={tickets} agora={agora} onPrefetch={(uid) => prefetchPerfil(api, uid)} carregando={conversas.carregando} erro={conversas.erro} />

      {conv ? (
        <AreaChat key={conv.uid} conv={conv} ticket={ticket} mensagens={msgs.itens} carregando={msgs.carregando} erro={msgs.erro} perfil={perfilEstado.perfil}
          rascunho={rascunho} onRascunho={(v) => setRascunho(conv.uid, v)} composerRef={composerRef} enviando={enviando} onEnviar={enviar} onMacro={aplicarMacro}
          onEscalar={() => setModalEscalar(true)} onResolver={resolver} onAbrirFicha={() => setFichaAberta(true)} onVoltar={() => setTela("fila")} onCopiar={copiar} agora={agora} atendente={atendente} />
      ) : (
        <section className={styles.chatVazio} aria-label="Conversa">
          <p className={styles.chatVazioTitulo}>{contagens.pendentes > 0 ? `${contagens.pendentes} ${contagens.pendentes === 1 ? "pessoa aguarda" : "pessoas aguardam"} a sua resposta` : "Nenhuma conversa aberta"}</p>
          <p>Escolha uma conversa na fila. A ficha de quem escreve abre ao lado, com cadastro, treinamento e nota média.</p>
          <p className={styles.dica}><kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> troca de conversa</p>
        </section>
      )}

      <FichaUsuario conv={conv} estado={perfilEstado} aberta={fichaAberta} onFechar={() => setFichaAberta(false)} onCopiar={copiar} agora={agora} />
      {fichaAberta && <button type="button" className={styles.cortina} aria-label="Fechar ficha" onClick={() => setFichaAberta(false)} />}

      <ModalEscalar aberto={modalEscalar} conv={conv} ticket={ticket} onFechar={() => setModalEscalar(false)} onConfirmar={escalar} />

      <div className={styles.toasts} aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[`toast_${t.tipo}`]}`} role={t.tipo === "erro" ? "alert" : "status"}>
            {t.uid ? <button type="button" className={styles.toastBtn} onClick={() => { selecionar(t.uid); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>{t.texto}</button> : <span>{t.texto}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
