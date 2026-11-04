// Peças visuais pequenas e compartilhadas: ícones, avatar, chips e botão de copiar.
import { useEffect, useState } from "react";
import styles from "./SuportePanel.module.css";
import { iniciais } from "./logica.js";

const base = { viewBox: "0 0 24 24", width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false };
export const Icone = {
  Busca: (p) => <svg {...base} {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  Enviar: (p) => <svg {...base} {...p}><path d="M21 3 10 14" /><path d="M21 3 14.5 21l-3.5-7-7-3.5L21 3Z" /></svg>,
  WhatsApp: (p) => <svg {...base} {...p}><path d="M4 20l1.2-4.2A8 8 0 1 1 8.3 18.9L4 20Z" /><path d="M9 9.2c0 3 2.8 5.8 5.8 5.8l1.2-1.4-2-1-.9.7a3.6 3.6 0 0 1-1.9-1.9l.7-.9-1-2L9 9.2Z" /></svg>,
  Escalar: (p) => <svg {...base} {...p}><path d="M12 20V6" /><path d="m6 11 6-6 6 6" /><path d="M5 20h14" /></svg>,
  Check: (p) => <svg {...base} {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>,
  Copiar: (p) => <svg {...base} {...p}><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" /></svg>,
  Fechar: (p) => <svg {...base} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>,
  Voltar: (p) => <svg {...base} {...p}><path d="m15 5-7 7 7 7" /></svg>,
  Raio: (p) => <svg {...base} {...p}><path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" /></svg>,
  Ficha: (p) => <svg {...base} {...p}><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></svg>,
  Estrela: (p) => <svg {...base} fill="currentColor" strokeWidth={1.2} {...p}><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8L3.5 9.7l5.9-.8L12 3.5Z" /></svg>,
  Recarregar: (p) => <svg {...base} {...p}><path d="M20 11a8 8 0 1 0-2.3 6" /><path d="M20 5v6h-6" /></svg>
};

export const rotuloSegmento = (tipo) => (tipo === "loja" ? "Loja" : "Promotor");
export const classeSegmento = (tipo) => (tipo === "loja" ? styles.segLoja : styles.segPromotor);

export function Avatar({ nome, foto, tipo, tamanho = 40 }) {
  const [falhou, setFalhou] = useState(false);
  useEffect(() => setFalhou(false), [foto]);
  return (
    <span className={`${styles.avatar} ${classeSegmento(tipo)}`} style={{ width: tamanho, height: tamanho, fontSize: Math.round(tamanho * 0.36) }} aria-hidden="true">
      {foto && !falhou ? <img src={foto} alt="" referrerPolicy="no-referrer" onError={() => setFalhou(true)} /> : iniciais(nome)}
    </span>
  );
}

/** tom: ok | aviso | erro | info | neutro */
export const Chip = ({ tom = "neutro", children, title }) => <span className={`${styles.chip} ${styles[`tom_${tom}`]}`} title={title}>{children}</span>;

export function BotaoCopiar({ valor, rotulo, onCopiar }) {
  const [feito, setFeito] = useState(false);
  useEffect(() => { if (!feito) return undefined; const t = setTimeout(() => setFeito(false), 1500); return () => clearTimeout(t); }, [feito]);
  return (
    <button type="button" className={styles.btnCopiar} aria-label={`Copiar ${rotulo}`} title={`Copiar ${rotulo}`} onClick={async () => { if (await onCopiar(valor, `${rotulo} copiado`)) setFeito(true); }}>
      {feito ? <Icone.Check width={15} height={15} /> : <Icone.Copiar width={15} height={15} />}
    </button>
  );
}
