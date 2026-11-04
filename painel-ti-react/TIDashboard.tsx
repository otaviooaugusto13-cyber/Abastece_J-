// Dashboard de TI em React + TypeScript: saúde dos serviços, cartões de SLA (TMA/TMR) e fila por criticidade com cronômetro ao vivo.
// Consome a API REAL do servidor (GET /ti/dashboard, /ti/saude, /ti/chamados) — nada de dado simulado. Estilos: ti.css + admin.css (tema escuro do projeto).
// A lógica de faixas/SLA vem de ../ti-fila-nucleo.js (a MESMA usada pelo painel atual e testada em test/bugs.test.js).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FAIXAS, ROTULO_PRIORIDADE, STATUS_SAUDE, agruparPorFaixa, duracaoSeg, ehAutoBug, formatarLatencia, rotuloGeral, slaDe, sparkline, textoSla, totaisPorFaixa, tituloLimpo,
  type ChamadoTI, type FaixaId, type ServicoSaude
} from "../ti-fila-nucleo.js";

export interface TIDashboardProps {
  /** Base da API, ex.: "https://abastece-ja.onrender.com" (sem barra final). */
  apiBase: string;
  /** Devolve o ID token do operador de TI (Firebase Auth: `auth.currentUser.getIdToken()`). Vai SÓ no cabeçalho Authorization. */
  getToken: () => Promise<string>;
  /** Período das métricas (TMA/TMR): 1, 7, 30 ou 90 dias. */
  dias?: 1 | 7 | 30 | 90;
  /** Clique num chamado (abra o detalhe na sua tela). */
  onAbrirChamado?: (chamado: ChamadoTI) => void;
}

type SlaMin = Record<string, { atend: number; resol: number }>;
interface Saude { geral: string; verificadoEm: string | null; intervaloSeg: number; servicos: ServicoSaude[] }
interface Dashboard {
  fila: { totalAbertos: number; aberto: number; emAtendimento: number; aguardandoUsuario: number; foraDoPrazo: number };
  periodo: { dias: number; tmaSeg: number | null; tmrSeg: number | null; slaAtendimentoPct: number | null; slaResolucaoPct: number | null; resolvidos: number; criados: number };
  slaMin: SlaMin; saude: Saude;
}
interface Fila { itens: (ChamadoTI & { solicitante?: { nome?: string } })[] }

// ---------------- dados ----------------
/** GET autenticado com atualização periódica. Pausa com a aba escondida e nunca deixa uma falha derrubar a tela (mantém o último dado). */
function useApi<T>(props: Pick<TIDashboardProps, "apiBase" | "getToken">, caminho: string, intervaloMs: number) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string>("");
  const { apiBase, getToken } = props;
  const recarregar = useCallback(async (sinal?: AbortSignal) => {
    try {
      const r = await fetch(`${apiBase}/${caminho}`, { headers: { Authorization: `Bearer ${await getToken()}` }, signal: sinal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { erro?: string }).erro || `Erro ${r.status}`);
      setDados(j as T); setErro("");
    } catch (e) { if ((e as Error).name !== "AbortError") setErro((e as Error).message || "Falha ao carregar"); }
  }, [apiBase, caminho, getToken]);
  useEffect(() => {
    const ctl = new AbortController(); void recarregar(ctl.signal);
    const id = setInterval(() => { if (!document.hidden) void recarregar(ctl.signal); }, intervaloMs);
    return () => { ctl.abort(); clearInterval(id); };
  }, [recarregar, intervaloMs]);
  return { dados, erro, recarregar };
}

/** Relógio de 1 s para os cronômetros (pausa com a aba escondida). */
function useAgora(): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => { if (!document.hidden) setAgora(Date.now()); }, 1000); return () => clearInterval(id); }, []);
  return agora;
}

// ---------------- peças ----------------
const GERAL_CLASSE: Record<string, string> = { ok: "ok", degradado: "warn", fora: "bad" };

export function CartaoServico({ s }: { s: ServicoSaude }) {
  const st = STATUS_SAUDE[s.status] ?? STATUS_SAUDE.desconhecido;
  const sp = useMemo(() => sparkline(s.historico, 120, 28, s.lentoMs ?? 0), [s.historico, s.lentoMs]);
  const lat = formatarLatencia(s.latenciaMs);
  return (
    <article className={`ti-svc ${st.classe}`} aria-label={`${s.nome}: ${st.rotulo}`}>
      <div className="ti-svc-top"><span className="ti-svc-n">{s.nome}</span><span className="ti-svc-st"><i aria-hidden="true" />{st.rotulo}</span></div>
      <div className="ti-svc-lat"><b>{lat}</b><span>{s.latenciaMs == null ? "" : "ms de latência"}</span></div>
      <svg className="ti-spark" viewBox="0 0 120 28" preserveAspectRatio="none" role="img" aria-label="Latência das últimas medições">
        {sp.linha && <><polyline points={sp.linha} />{sp.falhas.map((f, i) => <circle key={i} cx={f.x} cy={f.y} r={2.4} />)}</>}
      </svg>
      <div className="ti-svc-d">{s.detalhe}</div>
      <div className="ti-svc-f"><span>{s.tipo === "interno" ? "serviço interno" : "serviço externo"}</span><span>{s.disponibilidadePct == null ? "" : `${s.disponibilidadePct}% disponível`}</span></div>
    </article>
  );
}

export function PainelSaude({ saude, onVerificar }: { saude: Saude | null; onVerificar: () => Promise<void> }) {
  const [medindo, setMedindo] = useState(false);
  const verificar = async () => { setMedindo(true); try { await onVerificar(); } finally { setMedindo(false); } };
  return (
    <section className="ax-card ax-mb" aria-labelledby="ti-saude-h">
      <div className="ax-row">
        <h2 className="ax-grow" id="ti-saude-h">Saúde dos serviços</h2>
        {saude && <span className={`ti-geral ${GERAL_CLASSE[saude.geral] ?? ""}`} role="status">{rotuloGeral(saude.geral, saude.servicos)}</span>}
        <button type="button" className="ax-btn sm" onClick={verificar} disabled={medindo}>{medindo ? "Medindo…" : "Verificar agora"}</button>
      </div>
      <p className="ax-xs ax-mut ax-mb">{saude?.verificadoEm ? `Verificado às ${new Date(saude.verificadoEm).toLocaleTimeString("pt-BR")} · atualiza sozinho a cada ${saude.intervaloSeg} s, em segundo plano.` : "Primeira medição em andamento…"}</p>
      <div className="ti-svcs">{saude?.servicos.map((s) => <CartaoServico key={s.id} s={s} />)}</div>
    </section>
  );
}

export function CartoesSla({ d }: { d: Dashboard | null }) {
  const p = d?.periodo, f = d?.fila;
  const itens: { l: string; v: string; s: string; destaque?: boolean }[] = [
    { l: "Tempo médio de atendimento (TMA)", v: duracaoSeg(p?.tmaSeg ?? null), s: p?.slaAtendimentoPct == null ? "até um operador assumir" : `${p.slaAtendimentoPct}% dentro do SLA` },
    { l: "Tempo médio de resolução (TMR)", v: duracaoSeg(p?.tmrSeg ?? null), s: p?.slaResolucaoPct == null ? "sem contar “aguardando usuário”" : `${p.slaResolucaoPct}% dentro do SLA` },
    { l: "Chamados abertos", v: String(f?.totalAbertos ?? "—"), s: f ? `${f.aberto} na fila · ${f.emAtendimento} em atendimento · ${f.aguardandoUsuario} aguardando` : "" },
    { l: "Fora do prazo (SLA)", v: String(f?.foraDoPrazo ?? "—"), s: "na fila ou em atendimento", destaque: !!f?.foraDoPrazo }
  ];
  return (
    <div className="ax-grid ax-g4 ax-mb">
      {itens.map((i) => <div className="ax-card ax-kpi" key={i.l}><span className="l">{i.l}</span><span className="v" style={i.destaque ? { color: "var(--ax-red)" } : undefined}>{i.v}</span><span className="s">{i.s}</span></div>)}
    </div>
  );
}

/** Cronômetro de SLA de um chamado: recalcula a cada segundo a partir de `agora` (sem timers próprios). */
export function CronometroSla({ c, slaMin, agora }: { c: ChamadoTI; slaMin: SlaMin; agora: number }) {
  const sla = slaDe(c, slaMin, agora);
  return (
    <div className={`ti-sla ${sla.nivel}`}>
      <span className="ti-sla-l">{sla.rotulo}</span><span className="ti-sla-v">{textoSla(sla)}</span>
      <i className="ti-sla-b"><b style={{ width: `${Math.min(100, Math.round(sla.pct * 100))}%` }} /></i>
    </div>
  );
}

function CartaoChamado({ c, slaMin, agora, onAbrir }: { c: Fila["itens"][number]; slaMin: SlaMin; agora: number; onAbrir?: (c: ChamadoTI) => void }) {
  const estourado = slaDe(c, slaMin, agora).nivel === "estourado";
  const idade = duracaoSeg((agora - Date.parse(c.criadoEm)) / 1000);
  return (
    <article className={`ti-card${estourado ? " estourado" : ""}`} tabIndex={0} role="button" aria-label={`${c.protocolo}, ${ROTULO_PRIORIDADE[c.prioridade]}, ${tituloLimpo(c)}`}
      onClick={() => onAbrir?.(c)} onKeyDown={(e: { key: string; preventDefault(): void }) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir?.(c); } }}>
      <div className="ti-card-top">
        <b>{c.protocolo}</b>
        {ehAutoBug(c) && <span className="ti-tag-bug">AUTO-BUG</span>}
        {c.prioridade === "alta" && <span className="ax-badge ti-pri-alta">Alta</span>}
        <span className="ax-badge">{c.status.replace("_", " ")}</span>
      </div>
      <div className="ti-card-t">{tituloLimpo(c)}</div>
      <div className="ti-card-m">{c.solicitante?.nome || "—"} · {c.atribuidoNome || "sem responsável"} · há {idade}</div>
      <CronometroSla c={c} slaMin={slaMin} agora={agora} />
    </article>
  );
}

export function FilaPorCriticidade({ chamados, slaMin, agora, onAbrir, maxPorFaixa = 8 }: { chamados: Fila["itens"]; slaMin: SlaMin; agora: number; onAbrir?: (c: ChamadoTI) => void; maxPorFaixa?: number }) {
  const [soBug, setSoBug] = useState(false);
  const lista = useMemo(() => chamados.filter((c) => !soBug || ehAutoBug(c)), [chamados, soBug]);
  const grupos = useMemo(() => agruparPorFaixa(lista), [lista]);
  const tot = totaisPorFaixa(lista, slaMin, agora);   // depende de `agora`: o contador "fora do prazo" muda sozinho
  return (
    <section className="ax-card ax-mt" aria-labelledby="ti-board-h">
      <div className="ax-row ax-mb">
        <h2 className="ax-grow" id="ti-board-h">Fila por criticidade e SLA</h2>
        <label className="ax-chk ti-filtro"><input type="checkbox" checked={soBug} onChange={(e: { target: { checked: boolean } }) => setSoBug(e.target.checked)} /> Só [AUTO-BUG]</label>
      </div>
      <div className="ti-board">
        {FAIXAS.map((f) => {
          const itens = grupos[f.id as FaixaId].slice(0, maxPorFaixa), extra = grupos[f.id as FaixaId].length - itens.length, t = tot[f.id as FaixaId];
          return (
            <section key={f.id} className={`ti-lane ti-lane-${f.id}`} aria-label={`Faixa ${f.rotulo}`} title={f.dica}>
              <div className="ti-lane-h"><h3>{f.rotulo}</h3><span className="ti-lane-n">{t.total}</span>{t.estourados > 0 && <span className="ti-lane-late">{t.estourados} fora do prazo</span>}</div>
              {itens.length ? itens.map((c) => <CartaoChamado key={c.id} c={c} slaMin={slaMin} agora={agora} onAbrir={onAbrir} />) : <p className="ti-lane-vazio">Nada nesta faixa.</p>}
              {extra > 0 && <p className="ti-mais">+ {extra} não exibidos</p>}
            </section>
          );
        })}
      </div>
    </section>
  );
}

// ---------------- componente principal ----------------
export default function TIDashboard({ apiBase, getToken, dias = 7, onAbrirChamado }: TIDashboardProps) {
  const api = { apiBase, getToken };
  const dash = useApi<Dashboard>(api, `ti/dashboard?dias=${dias}`, 30_000);   // métricas + saúde (o servidor mede a cada 30 s)
  const fila = useApi<Fila>(api, "ti/chamados?visao=abertos&limite=120", 15_000);
  const [saudeForcada, setSaudeForcada] = useState<Saude | null>(null);
  const agora = useAgora();
  const ultimoDash = useRef<Dashboard | null>(null); if (dash.dados) ultimoDash.current = dash.dados;
  const saude = saudeForcada && (!dash.dados?.saude.verificadoEm || (saudeForcada.verificadoEm ?? "") > dash.dados.saude.verificadoEm) ? saudeForcada : dash.dados?.saude ?? null;

  const verificarAgora = useCallback(async () => {
    const r = await fetch(`${apiBase}/ti/saude?forcar=1`, { headers: { Authorization: `Bearer ${await getToken()}` } });
    if (r.ok) setSaudeForcada((await r.json()) as Saude);
  }, [apiBase, getToken]);

  return (
    <div className="ti-dashboard">
      {(dash.erro || fila.erro) && <p className="ax-erro ax-mb" role="alert">{dash.erro || fila.erro}</p>}
      <PainelSaude saude={saude} onVerificar={verificarAgora} />
      <CartoesSla d={dash.dados} />
      <FilaPorCriticidade chamados={fila.dados?.itens ?? []} slaMin={dash.dados?.slaMin ?? {}} agora={agora} onAbrir={onAbrirChamado} />
    </div>
  );
}
