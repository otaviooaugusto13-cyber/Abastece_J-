import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export const brl = (c: number | null | undefined): string => (c === null || c === undefined ? "—" : (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
export const pc = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
export const num = (v: number | null | undefined, d = 1): string => (v === null || v === undefined ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: d }));
export const dataBR = (iso: string): string => iso.split("-").reverse().join("/");
export const quando = (ms: number | null): string => (ms ? new Date(ms).toLocaleString("pt-BR") : "—");
export const COR = { azul: "#4169e1", ouro: "#d4af37", verde: "#34d399", vermelho: "#f87171", ambar: "#fbbf24", suave: "#8fa0c8", grade: "#1c2745" };
export const TOOLTIP = { contentStyle: { background: "#0e1527", border: "1px solid #1c2745", borderRadius: 8, color: "#e8ecf7" }, labelStyle: { color: "#d4af37" } };
export const EIXO = { stroke: COR.suave, fontSize: 12 };

export function Card({ titulo, extra, children, className = "" }: { titulo?: string; extra?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`cs-card ${className}`}>{(titulo || extra) && <header className="cs-card-h"><h3>{titulo}</h3>{extra}</header>}{children}</section>;
}
export function Kpi({ rotulo, valor, sub, tom }: { rotulo: string; valor: string; sub?: string; tom?: "ok" | "ruim" | "neutro" }) {
  return <div className={`cs-kpi ${tom || "neutro"}`}><span className="cs-kpi-r">{rotulo}</span><b>{valor}</b>{sub && <small>{sub}</small>}</div>;
}
export const Chip = ({ tom, children }: { tom: "ok" | "aviso" | "ruim" | "info"; children: ReactNode }) => <span className={`cs-chip ${tom}`}>{children}</span>;
export const Vazio = ({ texto = "Sem dados no período." }: { texto?: string }) => <p className="cs-vazio">{texto}</p>;
export const Aviso = ({ aviso, fechar }: { aviso: { tipo: "ok" | "erro"; texto: string } | null; fechar: () => void }) => (aviso ? <div className={`cs-aviso ${aviso.tipo}`} role="status" onClick={fechar}>{aviso.texto}</div> : null);
export function Tabela({ cab, linhas }: { cab: string[]; linhas: ReactNode[][] }) {
  return <div className="cs-tw"><table><thead><tr>{cab.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{linhas.map((l, i) => <tr key={i}>{l.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>;
}
/** Carrega dados de uma rota; refaz quando as dependências mudam; ignora respostas antigas (corrida entre filtros). */
export function useCarga<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [dados, setDados] = useState<T | null>(null), [erro, setErro] = useState(""), [carregando, setCarregando] = useState(true), n = useRef(0), fnRef = useRef(fn);
  fnRef.current = fn;
  const recarregar = useCallback(async () => {
    const id = ++n.current; setCarregando(true);
    try { const d = await fnRef.current(); if (id === n.current) { setDados(d); setErro(""); } } catch (e) { if (id === n.current) setErro((e as Error).message); } finally { if (id === n.current) setCarregando(false); }
  }, []);
  useEffect(() => { void recarregar(); }, [recarregar, ...deps]);   // eslint-disable-line react-hooks/exhaustive-deps
  return { dados, erro, carregando, recarregar };
}
/** JPEG reduzido no navegador (máx. 1280 px, qualidade 0,8) para caber no limite do servidor. */
export async function reduzirImagem(arquivo: File): Promise<string> {
  const bmp = await createImageBitmap(arquivo), k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}
