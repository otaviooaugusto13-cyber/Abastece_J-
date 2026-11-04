// Coluna da esquerda: busca, abas de triagem por segmento e a lista de conversas (tempo real).
import { useRef } from "react";
import styles from "./SuportePanel.module.css";
import { ABAS, ehPendente, formatarEspera, horaDe, ms, nivelEspera } from "./logica.js";
import { Avatar, Chip, Icone, rotuloSegmento } from "./ui.jsx";

const VAZIO = {
  todos: "Nenhuma conversa ainda. As mensagens de lojas e promotores aparecem aqui em tempo real.",
  promotores: "Nenhuma conversa de promotores.", lojas: "Nenhuma conversa de lojas.", pendentes: "Tudo respondido por aqui. Nenhuma conversa aguardando a equipe."
};

export default function FilaConversas({ conversas, contagens, aba, onAba, busca, onBusca, selUid, onSelecionar, tickets, agora, onPrefetch, carregando, erro }) {
  const refAbas = useRef(null);
  const teclasAbas = (e) => {   // setas/Home/End entre as abas (padrão WAI-ARIA de tablist)
    const i = ABAS.findIndex((a) => a.id === aba); let n = i;
    if (e.key === "ArrowRight") n = (i + 1) % ABAS.length; else if (e.key === "ArrowLeft") n = (i - 1 + ABAS.length) % ABAS.length; else if (e.key === "Home") n = 0; else if (e.key === "End") n = ABAS.length - 1; else return;
    e.preventDefault(); onAba(ABAS[n].id); refAbas.current?.querySelectorAll('[role="tab"]')[n]?.focus();
  };
  return (
    <section className={styles.fila} aria-label="Fila de conversas">
      <header className={styles.filaTopo}>
        <div className={styles.filaTitulo}>
          <h1 className={styles.titulo}>Suporte</h1>
          <span className={styles.subtitulo} aria-live="polite">{contagens.pendentes === 0 ? "Sem pendências" : `${contagens.pendentes} aguardando resposta`}</span>
        </div>
        <label className={styles.busca}>
          <Icone.Busca className={styles.buscaIcone} />
          <span className={styles.somenteLeitor}>Buscar conversa</span>
          <input type="search" value={busca} onChange={(e) => onBusca(e.target.value)} placeholder="Buscar nome, mensagem ou protocolo" autoComplete="off" />
        </label>
      </header>

      <div className={styles.abas} role="tablist" aria-label="Triagem por segmento" ref={refAbas} onKeyDown={teclasAbas}>
        {ABAS.map((a) => (
          <button key={a.id} type="button" role="tab" id={`aba-${a.id}`} aria-selected={aba === a.id} aria-controls="lista-conversas" tabIndex={aba === a.id ? 0 : -1}
            className={`${styles.aba} ${aba === a.id ? styles.abaAtiva : ""} ${a.id === "pendentes" && contagens.pendentes > 0 ? styles.abaAlerta : ""}`} onClick={() => onAba(a.id)}>
            {a.rotulo}<span className={styles.contagem}>{contagens[a.id]}</span>
          </button>
        ))}
      </div>

      {erro && <p className={styles.aviso} role="alert">Não foi possível acompanhar as conversas em tempo real. Confira sua conexão e suas permissões de administrador.</p>}

      <ul className={styles.lista} id="lista-conversas" role="tabpanel" aria-labelledby={`aba-${aba}`}>
        {carregando && [0, 1, 2, 3].map((i) => <li key={i} className={styles.esqueleto} aria-hidden="true" />)}
        {!carregando && !erro && conversas.length === 0 && <li className={styles.vazio}>{busca ? "Nada encontrado para essa busca." : VAZIO[aba]}</li>}
        {conversas.map((c) => {
          const t = tickets.get(c.uid), pend = ehPendente(c, t), espera = Math.max(0, agora - ms(c.ultimaEm)), nivel = pend ? nivelEspera(espera) : "ok", sel = c.uid === selUid;
          return (
            <li key={c.uid}>
              <button type="button" className={`${styles.item} ${sel ? styles.itemSel : ""} ${styles[`espera_${nivel}`]}`} aria-current={sel ? "true" : undefined} onClick={() => onSelecionar(c.uid)} onMouseEnter={() => onPrefetch(c.uid)} onFocus={() => onPrefetch(c.uid)}>
                <Avatar nome={c.nome} tipo={c.tipo} tamanho={42} />
                <span className={styles.itemCorpo}>
                  <span className={styles.itemLinha}><b className={styles.itemNome}>{c.nome || "Usuário"}</b><time className={styles.itemHora} dateTime={new Date(ms(c.ultimaEm)).toISOString?.()}>{horaDe(ms(c.ultimaEm))}</time></span>
                  <span className={styles.itemLinha}>
                    <span className={styles.itemPrev}>{c.ultimaDe === "suporte" ? "Você: " : ""}{c.ultimaMsg}</span>
                    {c.naoLidasSuporte > 0 && <span className={styles.badge} aria-label={`${c.naoLidasSuporte} não lidas`}>{c.naoLidasSuporte}</span>}
                  </span>
                  <span className={styles.itemMeta}>
                    <span className={`${styles.segRotulo} ${c.tipo === "loja" ? styles.segLoja : styles.segPromotor}`}>{rotuloSegmento(c.tipo)}</span>
                    {t?.status === "escalado" && <Chip tom="info" title={`Chamado ${t.escalonamento?.protocoloTI || ""}`}>Escalado</Chip>}
                    {t?.status === "resolvido" && !pend && <Chip tom="ok">Resolvido</Chip>}
                    {pend && <span className={`${styles.espera} ${styles[`esperaTxt_${nivel}`]}`}>aguardando há {formatarEspera(espera)}</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
