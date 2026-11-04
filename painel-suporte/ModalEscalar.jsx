// Diálogo de escalamento: escolhe o destino (TI ou Gestão/ADM), a categoria e a prioridade, exige o motivo e mostra o que será transferido.
import { useEffect, useRef, useState } from "react";
import styles from "./SuportePanel.module.css";
import { Icone } from "./ui.jsx";

const DESTINOS = [
  { id: "ti", titulo: "TI (desenvolvimento)", desc: "Erros do app, falhas de acesso, dados inconsistentes e problemas técnicos." },
  { id: "gestao", titulo: "Gestão/ADM", desc: "Exceções de cadastro, estornos, decisões comerciais e casos sensíveis." }
];
const CATEGORIAS = [["outro", "Outro"], ["acesso", "Acesso à conta"], ["pagamento", "Pagamentos"], ["app", "Aplicativo"], ["bug", "Erro/bug"], ["dados", "Dados"], ["infra", "Infraestrutura"]];
const PRIORIDADES = [["baixa", "Baixa"], ["media", "Média"], ["alta", "Alta"], ["critica", "Crítica"]];
const FOCAVEIS = 'button:not([disabled]), textarea, select, input, [href], [tabindex]:not([tabindex="-1"])';

export default function ModalEscalar({ aberto, conv, ticket, onFechar, onConfirmar }) {
  const [destino, setDestino] = useState("ti"), [categoria, setCategoria] = useState("outro"), [prioridade, setPrioridade] = useState("media");
  const [motivo, setMotivo] = useState(""), [avisar, setAvisar] = useState(true), [enviando, setEnviando] = useState(false), [erro, setErro] = useState("");
  const caixa = useRef(null), campoMotivo = useRef(null), anterior = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;
    setDestino("ti"); setCategoria("outro"); setPrioridade("media"); setMotivo(""); setAvisar(true); setErro(""); setEnviando(false);
    anterior.current = document.activeElement; const t = setTimeout(() => campoMotivo.current?.focus(), 30);
    return () => { clearTimeout(t); anterior.current?.focus?.(); };   // devolve o foco a quem abriu
  }, [aberto, conv?.uid]);

  if (!aberto || !conv) return null;
  const motivoOk = motivo.trim().length >= 5 && motivo.trim().length <= 300;
  const tecla = (e) => {
    if (e.key === "Escape" && !enviando) { e.stopPropagation(); onFechar(); return; }
    if (e.key !== "Tab") return;   // prende o foco dentro do diálogo
    const els = [...caixa.current.querySelectorAll(FOCAVEIS)]; if (!els.length) return;
    const primeiro = els[0], ultimo = els[els.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); } else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
  };
  const enviar = async (e) => {
    e.preventDefault(); if (!motivoOk || enviando) return;
    setEnviando(true); setErro("");
    try { await onConfirmar({ destino, categoria, prioridade, motivo: motivo.trim(), avisarUsuario: avisar }); }
    catch (x) { setErro(x.message || "Não foi possível escalar agora."); setEnviando(false); }
  };

  return (
    <div className={styles.fundo} onMouseDown={() => !enviando && onFechar()} onKeyDown={tecla}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="titulo-escalar" ref={caixa} onMouseDown={(e) => e.stopPropagation()}>
        <header className={styles.modalTopo}>
          <h2 id="titulo-escalar">Escalar atendimento</h2>
          <button type="button" className={styles.btnIcone} onClick={onFechar} disabled={enviando} aria-label="Fechar"><Icone.Fechar /></button>
        </header>
        <form onSubmit={enviar} className={styles.modalCorpo}>
          <p className={styles.modalIntro}>O chat de <b>{conv.nome}</b> ({ticket?.protocolo}) vira um chamado na fila de quem vai resolver, com o histórico anexado.</p>

          <fieldset className={styles.destinos}>
            <legend>Para onde vai</legend>
            {DESTINOS.map((d) => (
              <label key={d.id} className={`${styles.destino} ${destino === d.id ? styles.destinoSel : ""}`}>
                <input type="radio" name="destino" value={d.id} checked={destino === d.id} onChange={() => setDestino(d.id)} />
                <span><b>{d.titulo}</b><small>{d.desc}</small></span>
              </label>
            ))}
          </fieldset>

          <div className={styles.duasColunas}>
            <label className={styles.campoRotulo}>Categoria<select value={categoria} onChange={(e) => setCategoria(e.target.value)}>{CATEGORIAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></label>
            <label className={styles.campoRotulo}>Prioridade<select value={prioridade} onChange={(e) => setPrioridade(e.target.value)}>{PRIORIDADES.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></label>
          </div>

          <label className={styles.campoRotulo}>Motivo da escalada
            <textarea ref={campoMotivo} rows={3} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="O que já foi tentado e o que falta resolver?" />
            <small className={styles.contadorMotivo}>{motivo.trim().length}/300 · mínimo 5 caracteres</small>
          </label>

          <label className={styles.marca}><input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} /><span>Avisar {conv.nome?.split(" ")[0] || "o usuário"} no chat que o caso foi encaminhado, com o protocolo</span></label>

          <p className={styles.oQueVai}><b>O que será transferido:</b> resumo da situação da conta, as últimas 60 mensagens e o protocolo. CPF, e-mail e telefone são ocultados no texto. O chamado chega na fila com origem “Suporte”.</p>
          {erro && <p className={styles.aviso} role="alert">{erro}</p>}

          <footer className={styles.modalRodape}>
            <button type="button" className={`${styles.btn} ${styles.btnSec}`} onClick={onFechar} disabled={enviando}>Cancelar</button>
            <button type="submit" className={`${styles.btn} ${styles.btnEscalarCheio}`} disabled={!motivoOk || enviando}><Icone.Escalar /><span>{enviando ? "Escalando…" : `Escalar para ${destino === "gestao" ? "Gestão/ADM" : "TI"}`}</span></button>
          </footer>
        </form>
      </div>
    </div>
  );
}
