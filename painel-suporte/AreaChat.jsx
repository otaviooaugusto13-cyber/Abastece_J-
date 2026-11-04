// Coluna central: cabeçalho com as ações (WhatsApp, escalar, resolver), mensagens em tempo real, respostas rápidas e o campo de resposta.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./SuportePanel.module.css";
import { agruparMensagens, horaDe, ms } from "./logica.js";
import { CATEGORIAS_MACRO, MACROS, atalhoDa, buscarMacros, renderizarMacro } from "./macros.js";
import { gerarLinkWhatsApp, motivoWhatsAppIndisponivel } from "./whatsapp.js";
import { Avatar, Chip, Icone, rotuloSegmento, classeSegmento } from "./ui.jsx";

const LIMITE_MSG = 1000;   // mesmo limite do servidor (POST /admin/suporte/:uid/mensagem)
const fmtData = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function AreaChat({ conv, ticket, mensagens, carregando, erro, perfil, rascunho, onRascunho, composerRef, enviando, onEnviar, onMacro, onEscalar, onResolver, onAbrirFicha, onVoltar, onCopiar, agora, atendente }) {
  const rolagem = useRef(null), perto = useRef(true);
  const [novas, setNovas] = useState(0), [idx, setIdx] = useState(0), [paletaFechada, setPaletaFechada] = useState(false), [resolvendo, setResolvendo] = useState(false);
  const itens = useMemo(() => agruparMensagens(mensagens, agora), [mensagens, agora]);
  const ultimo = mensagens[mensagens.length - 1];

  // ---------- rolagem: cola no fim se a pessoa já está lá embaixo; senão mostra "novas mensagens" ----------
  useLayoutEffect(() => { perto.current = true; setNovas(0); const el = rolagem.current; if (el) el.scrollTop = el.scrollHeight; }, [conv?.uid]);
  useLayoutEffect(() => {
    const el = rolagem.current; if (!el || !ultimo) return;
    if (perto.current || ultimo.de === "suporte") { el.scrollTop = el.scrollHeight; setNovas(0); } else setNovas((n) => n + 1);
  }, [ultimo?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const aoRolar = () => { const el = rolagem.current; perto.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; if (perto.current) setNovas(0); };
  const irAoFim = () => { const el = rolagem.current; el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); };

  // ---------- campo de resposta ----------
  useEffect(() => { const el = composerRef.current; if (!el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 168)}px`; }, [rascunho, conv?.uid, composerRef]);
  const busca = /^\/([^\n]*)$/.exec(rascunho);
  const paletaItens = busca && !paletaFechada ? buscarMacros(busca[1]).slice(0, 6) : [];
  const paletaAberta = paletaItens.length > 0;
  useEffect(() => setIdx(0), [busca?.[1]]);
  useEffect(() => { if (!rascunho.startsWith("/")) setPaletaFechada(false); }, [rascunho]);

  const vars = { nome: conv?.nome, protocolo: ticket?.protocolo, atendente: atendente.nome };
  const tamanho = rascunho.length, excedeu = tamanho > LIMITE_MSG, podeEnviar = rascunho.trim().length > 0 && !excedeu && !enviando;
  const enviar = async () => { if (!podeEnviar) return; try { await onEnviar(rascunho.trim()); } catch { /* o painel já avisou; o texto fica no campo */ } composerRef.current?.focus(); };
  const aoTeclar = (e) => {
    if (paletaAberta) {
      if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => (i + 1) % paletaItens.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => (i - 1 + paletaItens.length) % paletaItens.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); onMacro(paletaItens[idx], true); return; }
      if (e.key === "Escape") { e.preventDefault(); setPaletaFechada(true); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(); }
  };

  // ---------- WhatsApp (equipe → usuário, com o protocolo) ----------
  const telefone = perfil?.cadastro?.telefone || "";
  const link = useMemo(() => (conv && ticket ? gerarLinkWhatsApp({ telefone, protocolo: ticket.protocolo, nome: conv.nome, atendente: atendente.nome }) : null), [conv, ticket, telefone, atendente.nome]);
  const motivoSemLink = link ? null : motivoWhatsAppIndisponivel({ telefone, protocolo: ticket?.protocolo });

  const escalado = ticket?.status === "escalado", resolvido = ticket?.status === "resolvido";
  const resolver = async () => { setResolvendo(true); try { await onResolver(); } finally { setResolvendo(false); } };

  return (
    <section className={styles.chat} aria-label={`Conversa com ${conv.nome}`}>
      <header className={styles.chatTopo}>
        <button type="button" className={`${styles.btnIcone} ${styles.soMovel}`} onClick={onVoltar} aria-label="Voltar para a fila"><Icone.Voltar /></button>
        <Avatar nome={conv.nome} foto={perfil?.cadastro?.foto} tipo={conv.tipo} tamanho={44} />
        <div className={styles.chatQuem}>
          <h2 className={styles.chatNome}>{conv.nome || "Usuário"}</h2>
          <div className={styles.chatSub}>
            <span className={`${styles.segRotulo} ${classeSegmento(conv.tipo)}`}>{rotuloSegmento(conv.tipo)}</span>
            {ticket ? <button type="button" className={styles.protocolo} onClick={() => onCopiar(ticket.protocolo, "Protocolo copiado")} title="Copiar protocolo">{ticket.protocolo}</button> : <span className={styles.protocoloGerando}>gerando protocolo…</span>}
            {escalado && <Chip tom="info">Escalado · {ticket.escalonamento?.protocoloTI}</Chip>}
            {resolvido && <Chip tom="ok">Resolvido</Chip>}
          </div>
        </div>
        <div className={styles.acoes}>
          {link ? (
            <a className={`${styles.btn} ${styles.btnWhats}`} href={link.url} target="_blank" rel="noopener noreferrer" title={`Abrir o WhatsApp de ${conv.nome} com o protocolo ${ticket.protocolo}`}><Icone.WhatsApp /><span>WhatsApp</span></a>
          ) : (
            <button type="button" className={`${styles.btn} ${styles.btnWhats}`} disabled title={motivoSemLink || ""}><Icone.WhatsApp /><span>WhatsApp</span></button>
          )}
          <button type="button" className={`${styles.btn} ${styles.btnEscalar}`} onClick={onEscalar} disabled={escalado || !ticket} title={escalado ? `Já escalado (${ticket.escalonamento?.protocoloTI})` : "Transferir este atendimento, com o histórico, para a fila de TI ou da gestão"}><Icone.Escalar /><span>Escalar para TI/ADM</span></button>
          <button type="button" className={`${styles.btn} ${styles.btnSec}`} onClick={resolver} disabled={resolvido || !ticket || resolvendo} title="Encerrar este atendimento. Se o usuário escrever de novo, abre-se um novo protocolo."><Icone.Check /><span>Resolver</span></button>
          <button type="button" className={`${styles.btn} ${styles.btnSec} ${styles.soCompacto}`} onClick={onAbrirFicha} aria-label="Abrir ficha do usuário"><Icone.Ficha /><span>Ficha</span></button>
        </div>
      </header>

      {escalado && ticket.escalonamento && (
        <p className={styles.faixa}>Escalado para {ticket.escalonamento.destino === "gestao" ? "a Gestão/ADM" : "a TI"} em {fmtData.format(new Date(ms(ticket.escalonamento.emMs)))} por {ticket.escalonamento.porNome}. Chamado <b>{ticket.escalonamento.protocoloTI}</b> com o histórico anexado.</p>
      )}

      <div className={styles.mensagensWrap}>
        <div className={styles.mensagens} ref={rolagem} onScroll={aoRolar} role="log" aria-live="polite" aria-relevant="additions" aria-label="Mensagens">
          {carregando && <p className={styles.estadoMsg}>Carregando mensagens…</p>}
          {erro && <p className={styles.estadoMsg} role="alert">Não foi possível carregar as mensagens desta conversa.</p>}
          {!carregando && !erro && mensagens.length === 0 && <p className={styles.estadoMsg}>Sem mensagens ainda. Escreva abaixo para puxar assunto.</p>}
          {itens.map((it) => it.tipo === "dia" ? (
            <div key={it.chave} className={styles.dia}><span>{it.rotulo}</span></div>
          ) : (() => {
            const eu = it.msg.de === "suporte";
            return (
              <div key={it.chave} className={`${styles.linhaMsg} ${eu ? styles.linhaEquipe : styles.linhaUsuario} ${it.inicioGrupo ? styles.iniciaGrupo : ""}`}>
                <div className={`${styles.balao} ${eu ? styles.balaoEquipe : `${styles.balaoUsuario} ${classeSegmento(conv.tipo)}`}`}>
                  {it.inicioGrupo && <span className={styles.autor}>{eu ? (it.msg.autorUid && it.msg.autorUid === atendente.uid ? "Você" : "Equipe") : conv.nome}</span>}
                  <p className={styles.texto}>{it.msg.texto}</p>
                  <time className={styles.hora}>{horaDe(it.ms)}</time>
                </div>
              </div>
            );
          })())}
        </div>
        {novas > 0 && <button type="button" className={styles.pilulaNovas} onClick={irAoFim}>{novas === 1 ? "1 nova mensagem" : `${novas} novas mensagens`}</button>}
      </div>

      <div className={styles.macros} role="toolbar" aria-label="Respostas rápidas">
        <span className={styles.macrosRotulo}><Icone.Raio width={15} height={15} />Respostas rápidas</span>
        {CATEGORIAS_MACRO.map((cat) => (
          <div key={cat.id} className={styles.macroGrupo} role="group" aria-label={cat.rotulo}>
            <span className={styles.macroCat}>{cat.rotulo}</span>
            {MACROS.filter((m) => m.categoria === cat.id).map((m) => (
              <button key={m.id} type="button" className={styles.macro} onClick={() => onMacro(m, false)} title={renderizarMacro(m.texto, vars)}>
                {m.titulo}<kbd>Alt+{atalhoDa(m)}</kbd>
              </button>
            ))}
          </div>
        ))}
      </div>

      <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); enviar(); }}>
        {paletaAberta && (
          <ul className={styles.paleta} role="listbox" aria-label="Respostas rápidas">
            {paletaItens.map((m, i) => (
              <li key={m.id} role="option" aria-selected={i === idx}>
                <button type="button" tabIndex={-1} className={`${styles.paletaItem} ${i === idx ? styles.paletaSel : ""}`} onMouseEnter={() => setIdx(i)} onMouseDown={(e) => { e.preventDefault(); onMacro(m, true); }}>
                  <b>{m.titulo}</b><span>{renderizarMacro(m.texto, vars)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className={styles.somenteLeitor} htmlFor="campo-resposta">Resposta para {conv.nome}</label>
        <textarea id="campo-resposta" ref={composerRef} className={styles.campo} rows={1} value={rascunho} onChange={(e) => onRascunho(e.target.value)} onKeyDown={aoTeclar}
          placeholder={`Responder a ${conv.nome || "usuário"}…  (digite / para respostas rápidas)`} aria-invalid={excedeu || undefined} />
        <div className={styles.composerRodape}>
          <span className={styles.dica}><kbd>Enter</kbd> envia · <kbd>Shift</kbd>+<kbd>Enter</kbd> nova linha · <kbd>Alt</kbd>+<kbd>1–9</kbd> macros</span>
          {tamanho > 800 && <span className={`${styles.contador} ${excedeu ? styles.contadorExcedeu : ""}`} aria-live="polite">{tamanho}/{LIMITE_MSG}</span>}
          <button type="submit" className={styles.btnEnviar} disabled={!podeEnviar}><Icone.Enviar /><span>{enviando ? "Enviando…" : "Enviar"}</span></button>
        </div>
      </form>
    </section>
  );
}
