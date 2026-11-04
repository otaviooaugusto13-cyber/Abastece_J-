/**
 * Painel SUCESSO DO CLIENTE & EXPANSÃO (CS & B2B) — Abastece Já. React + TypeScript + Recharts, dark mode (cs.css).
 *
 *   <CsB2bDashboard getToken={() => auth.currentUser!.getIdToken()} apiBase="" onReautenticar={() => signInWithRedirect(auth, provider)} />
 *
 * A tela só mostra o que a API /cs/* devolve; quem calcula e decide é o servidor (RBAC admin, validações, auditoria). Dinheiro em centavos.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { criarApi } from "./api";
import type { PainelCS, RedeB2B } from "../tipos";
import { Aviso, Card, COR, EIXO, Kpi, TOOLTIP, Vazio, brl, dataBR, num, pc, useCarga } from "./ui";
import { Churn, Contas, Exportar, Faturamento, Lojas, Marcas, Nps, Operacao, type Ctx } from "./abas";

export interface CsB2bDashboardProps { getToken: () => Promise<string>; apiBase?: string; onReautenticar?: () => void }
const ABAS: [string, string][] = [["visao", "Visão geral"], ["operacao", "Operação"], ["contas", "Contas-chave"], ["lojas", "Lojas"], ["financeiro", "Faturamento B2B"], ["marcas", "Marcas"], ["churn", "Retenção"], ["nps", "NPS"], ["exportar", "Exportar"]];
const abaDoHash = (): string => { const h = location.hash.replace("#", ""); return ABAS.some(([k]) => k === h) ? h : "visao"; };

export default function CsB2bDashboard({ getToken, apiBase = "", onReautenticar }: CsB2bDashboardProps) {
  const [aba, setAba] = useState(abaDoHash), [dias, setDias] = useState(30), [redeId, setRedeId] = useState(""), [lojaAberta, setLojaAberta] = useState("");
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const api = useMemo(() => criarApi(getToken, apiBase, onReautenticar), [getToken, apiBase, onReautenticar]);
  const avisar = useCallback((tipo: "ok" | "erro", texto: string) => { setAviso({ tipo, texto }); setTimeout(() => setAviso(null), 6000); }, []);
  const redes = useCarga(() => api.get<RedeB2B[]>("/cs/redes"), []);
  const painel = useCarga(() => api.get<PainelCS>(`/cs/painel?dias=${dias}${redeId ? `&redeId=${redeId}` : ""}`), [dias, redeId, api]);
  useEffect(() => { const f = () => setAba(abaDoHash()); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  const ir = (k: string) => { location.hash = k; setAba(k); };
  const c: Ctx = { api, dias, redeId, redes: redes.dados || [], avisar, recarregarRedes: () => void redes.recarregar() };
  const p = painel.dados;

  return <div className="cs-app">
    <div className="cs-topo"><h1>Sucesso do Cliente & Expansão</h1>
      <div className="cs-filtros">
        <select aria-label="Rede" value={redeId} onChange={(e) => setRedeId(e.target.value)}><option value="">Todas as redes</option>{(redes.dados || []).map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}</select>
        <select aria-label="Período" value={dias} onChange={(e) => setDias(Number(e.target.value))}>{[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>Últimos {d} dias</option>)}</select>
        <button className="sec" onClick={() => { void painel.recarregar(); void redes.recarregar(); }} disabled={painel.carregando}>{painel.carregando ? "Atualizando…" : "↻ Atualizar"}</button>
      </div></div>
    <nav className="cs-abas" role="tablist">{ABAS.map(([k, r]) => <button key={k} role="tab" aria-selected={aba === k} className={aba === k ? "ativa" : ""} onClick={() => ir(k)}>{r}</button>)}</nav>
    {painel.erro && <p className="cs-erro">{painel.erro}</p>}
    {p?.truncado && <p className="cs-erro">⚠ Volume acima do limite de leitura: os números podem estar incompletos. Reduza o período ou use um filtro de rede.</p>}
    {aba === "visao" && (p ? <Visao p={p} /> : <Vazio texto={painel.carregando ? "Carregando…" : "Sem dados."} />)}
    {aba === "operacao" && p && <Operacao c={c} painel={p} />}
    {aba === "contas" && <Contas c={c} />}
    {aba === "lojas" && <Lojas c={c} abrir={lojaAberta} />}
    {aba === "financeiro" && <Faturamento c={c} />}
    {aba === "marcas" && <Marcas c={c} />}
    {aba === "churn" && p && <Churn c={c} painel={p} abrirLoja={(uid) => { setLojaAberta(uid); ir("lojas"); }} />}
    {aba === "nps" && <Nps c={c} />}
    {aba === "exportar" && <Exportar c={c} />}
    <Aviso aviso={aviso} fechar={() => setAviso(null)} />
  </div>;
}

/** Visão geral: KPIs + fill rate (1), CSAT (3), economia (5), ruptura (6), setores (13). */
function Visao({ p }: { p: PainelCS }) {
  const k = p.kpis, fr = p.fillRate, ok = (v: number | null, meta: number) => (v === null ? "neutro" : v >= meta ? "ok" : "ruim") as "ok" | "ruim" | "neutro";
  const roi = p.roi.meses.map((m) => ({ mes: m.mes + (m.parcial ? "*" : ""), onDemand: m.onDemandCentavos / 100, fixo: m.fixoEquivalenteCentavos / 100, economia: m.economiaCentavos / 100 }));
  return <div className="cs-grade">
    <div className="cs-grade g4">
      <Kpi rotulo="Taxa de preenchimento" valor={pc(k.fillRate)} sub={`meta ${pc(fr.metaPct)} · ${fr.concluidas}/${fr.encerradas} missões`} tom={ok(k.fillRate, fr.metaPct)} />
      <Kpi rotulo="Preenchimento no prazo" valor={pc(k.fillRateNoPrazo)} sub={`tolerância ${p.pontualidade.tolMin} min`} />
      <Kpi rotulo="Satisfação da loja (CSAT)" valor={k.csat === null ? "—" : `${num(k.csat, 2)} ★`} sub={`${p.csat.total} avaliações · ${pc(p.csat.csatPct)} satisfeitos`} tom={ok(k.csat, p.csat.metaMedia)} />
      <Kpi rotulo="NPS B2B" valor={k.nps === null ? "—" : String(k.nps)} sub={`${p.nps.respostas} respostas`} tom={k.nps === null ? "neutro" : k.nps >= 50 ? "ok" : k.nps < 0 ? "ruim" : "neutro"} />
      <Kpi rotulo="Pontualidade (check-in)" valor={pc(k.pontualidade)} sub={`${p.pontualidade.pontuais}/${p.pontualidade.checkins} no horário`} tom={ok(k.pontualidade, 90)} />
      <Kpi rotulo="Economia estimada" valor={brl(k.economiaCentavos)} sub="vs. contratados fixos" tom={k.economiaCentavos >= 0 ? "ok" : "ruim"} />
      <Kpi rotulo="Rupturas evitadas (est.)" valor={String(k.rupturasEvitadas)} sub={`${p.ruptura.evitadasConfirmadas} confirmadas`} />
      <Kpi rotulo="Vagas sem promotor" valor={String(k.vagasDesatendidas)} sub={`${k.lojasEmChurn} loja(s) em risco de churn`} tom={k.vagasDesatendidas ? "ruim" : "ok"} />
    </div>
    <div className="cs-grade g2">
      <Card titulo="Fill rate diário">{fr.serie.length ? <ResponsiveContainer width="100%" height={260}><LineChart data={fr.serie.map((s) => ({ ...s, dia: dataBR(s.dia).slice(0, 5) }))}><CartesianGrid stroke={COR.grade} /><XAxis dataKey="dia" {...EIXO} /><YAxis domain={[0, 100]} unit="%" {...EIXO} /><Tooltip {...TOOLTIP} /><Legend /><ReferenceLine y={fr.metaPct} stroke={COR.ouro} strokeDasharray="4 4" label={{ value: "meta", fill: COR.ouro, fontSize: 11 }} /><Line dataKey="fillRate" name="Fill rate %" stroke={COR.azul} strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer> : <Vazio />}
        <p className="cs-nota">{fr.semPromotor} missões ficaram sem promotor · {fr.faltaPromotor} foram aceitas e não executadas · aceite: {pc(fr.taxaAceite)}</p></Card>
      <Card titulo="Satisfação (CSAT) por semana">{p.csat.serie.length ? <ResponsiveContainer width="100%" height={260}><ComposedChart data={p.csat.serie.map((s) => ({ ...s, semana: dataBR(s.semana).slice(0, 5) }))}><CartesianGrid stroke={COR.grade} /><XAxis dataKey="semana" {...EIXO} /><YAxis yAxisId="a" domain={[1, 5]} {...EIXO} /><YAxis yAxisId="q" orientation="right" {...EIXO} /><Tooltip {...TOOLTIP} /><Legend /><Bar yAxisId="q" dataKey="qtd" name="Avaliações" fill={COR.grade} /><Line yAxisId="a" dataKey="media" name="Média ★" stroke={COR.ouro} strokeWidth={2} /></ComposedChart></ResponsiveContainer> : <Vazio />}
        <p className="cs-nota">{p.csat.baixas} avaliação(ões) com 2★ ou menos.</p></Card>
      <Card titulo="Economia gerada — on-demand × contratados fixos (estimativa)">{roi.length ? <ResponsiveContainer width="100%" height={260}><ComposedChart data={roi}><CartesianGrid stroke={COR.grade} /><XAxis dataKey="mes" {...EIXO} /><YAxis {...EIXO} tickFormatter={(v: number) => `R$ ${num(v / 1000, 0)}k`} /><Tooltip {...TOOLTIP} formatter={(v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} /><Legend /><Bar dataKey="fixo" name="Equivalente fixo" fill={COR.suave} radius={[4, 4, 0, 0]} /><Bar dataKey="onDemand" name="On-demand (real)" fill={COR.azul} radius={[4, 4, 0, 0]} /><Line dataKey="economia" name="Economia" stroke={COR.verde} strokeWidth={2} /></ComposedChart></ResponsiveContainer> : <Vazio />}
        <p className="cs-nota">Premissas: {brl(p.roi.premissas.custoMensalFixoCentavos)}/mês por contratado, {p.roi.premissas.horasSemanaFixo} h/sem, {p.roi.premissas.ocupacaoFixaPct}% produtivo; time fixo dimensionado pela semana de pico de cada loja. * mês em curso (custo fixo proporcional). Economia negativa = uso contínuo alto.</p></Card>
      <Card titulo="Ruptura evitada e reposição">{p.ruptura.serie.length ? <ResponsiveContainer width="100%" height={260}><AreaChart data={p.ruptura.serie}><CartesianGrid stroke={COR.grade} /><XAxis dataKey="mes" {...EIXO} /><YAxis {...EIXO} /><Tooltip {...TOOLTIP} /><Area dataKey="evitadas" name="Rupturas evitadas" stroke={COR.verde} fill={COR.verde} fillOpacity={0.25} /></AreaChart></ResponsiveContainer> : <Vazio />}
        <p className="cs-nota">{num(p.ruptura.horas)} h de reposição · ≈ {p.ruptura.itensRepostosEst.toLocaleString("pt-BR")} itens repostos (estimado a {p.parametros.itensPorHora}/h) · {p.ruptura.chamadosRelampago} chamados relâmpago{p.ruptura.vendaPreservadaCentavos !== null ? ` · venda preservada ≈ ${brl(p.ruptura.vendaPreservadaCentavos)}` : ""}.</p></Card>
    </div>
    <Card titulo="Desempenho por setor">{p.setores.length ? <div className="cs-grade g2"><ResponsiveContainer width="100%" height={Math.max(240, p.setores.length * 38)}><BarChart data={p.setores} layout="vertical"><CartesianGrid stroke={COR.grade} /><XAxis type="number" domain={[0, 100]} unit="%" {...EIXO} /><YAxis type="category" dataKey="setor" width={120} {...EIXO} /><Tooltip {...TOOLTIP} /><Legend /><Bar dataKey="fillRate" name="Fill rate %" fill={COR.azul} /><Bar dataKey="pontualidade" name="Pontualidade %" fill={COR.verde} /></BarChart></ResponsiveContainer>
      <div className="cs-tw"><table><thead><tr><th>Setor</th><th>Missões</th><th>CSAT</th><th>Aceite (min)</th><th>Gôndola cheia</th><th>Horas</th></tr></thead><tbody>{p.setores.map((s) => <tr key={s.setor}><td>{s.setor}</td><td>{s.missoes}</td><td>{num(s.csat, 2)}</td><td>{s.tempoAceiteMin ?? "—"}</td><td>{pc(s.gondolaCheiaPct)}</td><td>{num(s.horas)}</td></tr>)}</tbody></table></div></div> : <Vazio />}</Card>
  </div>;
}
