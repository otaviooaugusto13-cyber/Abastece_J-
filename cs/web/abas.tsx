import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Api } from "./api";
import type { ContaChave, LinhaFaturamento, LinhaMarca, LojaChurn, MetricaNps, PainelCS, Recorrencia, RedeB2B, Interacao } from "../tipos";
import { SETORES_PEDIDO } from "../tipos";
import { Card, Chip, COR, EIXO, Kpi, Tabela, TOOLTIP, Vazio, brl, dataBR, num, pc, quando, reduzirImagem, useCarga } from "./ui";

export interface Ctx { api: Api; dias: number; redeId: string; redes: RedeB2B[]; avisar: (tipo: "ok" | "erro", texto: string) => void; recarregarRedes: () => void }
const qs = (c: Ctx, extra = "") => `?dias=${c.dias}${c.redeId ? `&redeId=${c.redeId}` : ""}${extra}`;
const NIVEL = { saudavel: ["ok", "Saudável"], atencao: ["aviso", "Atenção"], risco: ["ruim", "Risco"], critico: ["ruim", "Crítico"] } as const;
const ChipNivel = ({ n }: { n: keyof typeof NIVEL }) => <Chip tom={NIVEL[n][0]}>{NIVEL[n][1]}</Chip>;
const reais = (v: string): number => Math.round(Number(v.replace(/\./g, "").replace(",", ".")) * 100);
const falhar = (c: Ctx) => (e: unknown) => c.avisar("erro", (e as Error).message);

// ───────── 2) Operação: vagas desatendidas + 8) pontualidade ─────────
export function Operacao({ c, painel }: { c: Ctx; painel: PainelCS }) {
  const alertas = useCarga(() => c.api.get<{ id: string; tipo: string; severidade: string; mensagem: string; criadoEm: number }[]>("/cs/alertas"), []);
  const p = painel.pontualidade;
  return <div className="cs-grade">
    <Card titulo={`Vagas sem promotor (início em até ${painel.parametros.alertaVagaHoras} h)`}>
      {painel.vagas.length ? <Tabela cab={["Quando", "Loja", "Setor", "Falta", "Prioridade"]} linhas={painel.vagas.map((v) => [`${dataBR(v.data)} ${v.entrada}`, v.lojaNome, v.setor, v.minutosParaInicio <= 0 ? "Já começou" : `${v.minutosParaInicio} min`, <Chip key="s" tom={v.severidade === "critica" ? "ruim" : v.severidade === "alta" ? "aviso" : "info"}>{v.severidade}{v.urgente ? " · urgente" : ""}</Chip>])} /> : <Vazio texto="Nenhuma vaga em risco agora. 🎉" />}
    </Card>
    <div className="cs-grade g2">
      <Card titulo={`Pontualidade dos promotores (tolerância ${p.tolMin} min)`}>
        <div className="cs-grade g3"><Kpi rotulo="Check-ins no horário" valor={pc(p.pct)} sub={`${p.pontuais} de ${p.checkins}`} tom={(p.pct ?? 100) >= 90 ? "ok" : "ruim"} /><Kpi rotulo="Atraso médio (quando atrasa)" valor={p.atrasoMedioMin === null ? "—" : `${p.atrasoMedioMin} min`} /></div>
        {p.serie.length ? <ResponsiveContainer width="100%" height={200}><LineChart data={p.serie.map((s) => ({ ...s, semana: dataBR(s.semana).slice(0, 5) }))}><CartesianGrid stroke={COR.grade} /><XAxis dataKey="semana" {...EIXO} /><YAxis domain={[0, 100]} {...EIXO} /><Tooltip {...TOOLTIP} /><Line dataKey="pct" name="Pontualidade %" stroke={COR.verde} strokeWidth={2} dot /></LineChart></ResponsiveContainer> : <Vazio />}
      </Card>
      <Card titulo="Promotores com mais atrasos">{p.promotores.length ? <Tabela cab={["Promotor", "Nível", "Check-ins", "Pontual", "Atraso médio"]} linhas={p.promotores.map((x) => [x.nome, x.nivel, x.checkins, pc(x.pct), `${x.atrasoMedioMin} min`])} /> : <Vazio texto="Precisa de ao menos 2 check-ins por promotor." />}</Card>
    </div>
    <Card titulo="Alertas disparados (histórico)">{alertas.dados?.length ? <Tabela cab={["Quando", "Tipo", "Gravidade", "Mensagem"]} linhas={alertas.dados.slice(0, 25).map((a) => [quando(a.criadoEm), a.tipo.replace("_", " "), <Chip key="g" tom={a.severidade === "critica" ? "ruim" : "aviso"}>{a.severidade}</Chip>, a.mensagem])} /> : <Vazio texto="Nenhum alerta ainda." />}</Card>
  </div>;
}

// ───────── 4) Contas-chave ─────────
export function Contas({ c }: { c: Ctx }) {
  const { dados, erro, carregando } = useCarga(() => c.api.get<ContaChave[]>(`/cs/contas${qs(c).replace(/&redeId=[^&]*/, "")}`), [c.dias]);
  const [aberta, setAberta] = useState("");
  if (erro) return <p className="cs-erro">{erro}</p>; if (!dados) return <Vazio texto={carregando ? "Carregando…" : "Sem dados."} />;
  return <div className="cs-grade">
    <Card titulo="Contas-chave (redes e grupos)">
      <Tabela cab={["Conta", "CS", "Lojas ativas", "Fill rate", "CSAT", "Pontualidade", "NPS", "Em churn", "Gasto", ""]} linhas={dados.map((x) => [x.nome, x.csResponsavel || "—", `${x.lojasAtivas}/${x.lojas}`, pc(x.fillRate), num(x.csat, 2), pc(x.pontualidade), x.nps ?? "—", x.lojasEmChurn ? <Chip key="c" tom="ruim">{x.lojasEmChurn}</Chip> : 0, brl(x.gastoCentavos), <button key="b" className="sec" onClick={() => setAberta(aberta === (x.redeId || "") ? "" : x.redeId || "avulsas")}>Lojas</button>])} />
    </Card>
    {dados.filter((x) => aberta === (x.redeId || "avulsas")).map((x) => <Card key={x.nome} titulo={`Lojas — ${x.nome}`}><Tabela cab={["Loja", "Retenção", "Missões", "Fill rate", "CSAT", "Pontualidade", "Gasto"]} linhas={x.porLoja.map((l) => [l.nome, <ChipNivel key="n" n={l.nivelChurn} />, l.missoes, pc(l.fillRate), num(l.csat, 2), pc(l.pontualidade), brl(l.gastoCentavos)])} /></Card>)}
    <GestaoRedes c={c} />
  </div>;
}
function GestaoRedes({ c }: { c: Ctx }) {
  const [nome, setNome] = useState(""), [resp, setResp] = useState(""), [rede, setRede] = useState(""), [uids, setUids] = useState("");
  const criar = () => c.api.post("/cs/redes", { nome, csResponsavel: resp }).then(() => { setNome(""); setResp(""); c.avisar("ok", "Rede criada."); c.recarregarRedes(); }).catch(falhar(c));
  const vincular = (remover: boolean) => c.api.put(`/cs/redes/${rede}/lojas`, { [remover ? "remover" : "adicionar"]: uids.split(/[\s,;]+/).filter(Boolean) }).then(() => { setUids(""); c.avisar("ok", remover ? "Lojas removidas da rede." : "Lojas vinculadas."); c.recarregarRedes(); }).catch(falhar(c));
  return <Card titulo="Gerir redes"><div className="cs-form">
    <label>Nova rede<input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Rede Alfa" /></label><label>Responsável CS<input value={resp} onChange={(e) => setResp(e.target.value)} /></label><button disabled={nome.trim().length < 2} onClick={criar}>Criar rede</button>
    <label>Rede<select value={rede} onChange={(e) => setRede(e.target.value)}><option value="">Escolha…</option>{c.redes.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}</select></label>
    <label className="larga">UIDs das lojas (separe por vírgula ou espaço)<input value={uids} onChange={(e) => setUids(e.target.value)} /></label>
    <button disabled={!rede || !uids.trim()} onClick={() => vincular(false)}>Vincular lojas</button><button className="sec" disabled={!rede || !uids.trim()} onClick={() => vincular(true)}>Remover da rede</button></div></Card>;
}

// ───────── 12) Lojas: ficha + histórico ─────────
interface Ficha { lojaUid: string; nome: string; redeId: string | null; rede: string; email: string; endereco: Record<string, string>; acesso: Record<string, string>; gerente: Record<string, string>; observacoes: string; ativo: boolean; fotos: { id: string; descricao: string }[]; indicadores90d: { missoes: number; concluidas: number; fillRate: number | null; csat: number | null; pontualidade: number | null; gastoCentavos: number }; nivelChurn: keyof typeof NIVEL; diasSemMissao: number; missoes: { id: string; data: string; entrada: string; saida: string; setor: string; status: string; concluida: boolean; atrasoMin: number | null; estrelas: number | null; comentario: string; promotor: string }[]; interacoes: Interacao[] }
export function Lojas({ c, abrir }: { c: Ctx; abrir?: string }) {
  const [busca, setBusca] = useState(""), [sel, setSel] = useState(abrir || "");
  const lista = useCarga(() => c.api.get<{ lojaUid: string; nome: string; rede: string; cidade: string; gerente: string; nivelChurn: keyof typeof NIVEL; ativo: boolean }[]>(`/cs/lojas?busca=${encodeURIComponent(busca)}${c.redeId ? `&redeId=${c.redeId}` : ""}`), [busca, c.redeId]);
  useEffect(() => { if (abrir) setSel(abrir); }, [abrir]);
  return <div className="cs-grade g2">
    <Card titulo="Lojas" extra={<input placeholder="Buscar loja, gerente ou cidade" value={busca} onChange={(e) => setBusca(e.target.value)} />}>
      {lista.dados?.length ? <Tabela cab={["Loja", "Rede", "Cidade", "Retenção", ""]} linhas={lista.dados.map((l) => [l.nome + (l.ativo ? "" : " (inativa)"), l.rede || "—", l.cidade || "—", <ChipNivel key="n" n={l.nivelChurn} />, <button key="b" className="sec" onClick={() => setSel(l.lojaUid)}>Abrir ficha</button>])} /> : <Vazio texto={lista.carregando ? "Carregando…" : "Nenhuma loja encontrada."} />}
    </Card>
    {sel ? <FichaLoja key={sel} c={c} uid={sel} /> : <Card><Vazio texto="Escolha uma loja para ver a ficha." /></Card>}
  </div>;
}
function FichaLoja({ c, uid }: { c: Ctx; uid: string }) {
  const { dados: f, erro, recarregar } = useCarga(() => c.api.get<Ficha>(`/cs/lojas/${uid}`), [uid]);
  const [ed, setEd] = useState<Ficha | null>(null), [nota, setNota] = useState(""), [tipo, setTipo] = useState("ligacao"), [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => { if (f) setEd(structuredClone(f)); }, [f]);
  useEffect(() => { let vivo = true; (async () => { for (const ft of f?.fotos || []) { if (urls[ft.id]) continue; const u = await c.api.imagem(`/cs/lojas/${uid}/fotos/${ft.id}`).catch(() => ""); if (vivo && u) setUrls((x) => ({ ...x, [ft.id]: u })); } })(); return () => { vivo = false; }; }, [f]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (erro) return <Card><p className="cs-erro">{erro}</p></Card>; if (!f || !ed) return <Card><Vazio texto="Carregando…" /></Card>;
  const campo = (grupo: "endereco" | "acesso" | "gerente", k: string, rotulo: string, larga = false) => <label className={larga ? "larga" : ""}>{rotulo}<input value={ed[grupo][k] || ""} onChange={(e) => setEd({ ...ed, [grupo]: { ...ed[grupo], [k]: e.target.value } })} /></label>;
  const salvar = () => c.api.put(`/cs/lojas/${uid}`, { nome: ed.nome, redeId: ed.redeId, endereco: ed.endereco, acesso: ed.acesso, gerente: ed.gerente, observacoes: ed.observacoes, ativo: ed.ativo }).then(() => { c.avisar("ok", "Ficha salva."); void recarregar(); }).catch(falhar(c));
  const enviarFoto = async (a: File | undefined) => { if (!a) return; try { await c.api.post(`/cs/lojas/${uid}/fotos`, { foto: await reduzirImagem(a), descricao: a.name.slice(0, 60) }); c.avisar("ok", "Foto adicionada."); void recarregar(); } catch (e) { falhar(c)(e); } };
  const i = f.indicadores90d;
  return <div className="cs-grade">
    <Card titulo={f.nome} extra={<ChipNivel n={f.nivelChurn} />}>
      <div className="cs-grade g4"><Kpi rotulo="Missões (90 d)" valor={String(i.missoes)} /><Kpi rotulo="Fill rate" valor={pc(i.fillRate)} /><Kpi rotulo="CSAT" valor={num(i.csat, 2)} /><Kpi rotulo="Dias sem missão" valor={String(f.diasSemMissao)} /></div>
      <div className="cs-form" style={{ marginTop: 12 }}>
        <label className="larga">Nome<input value={ed.nome} onChange={(e) => setEd({ ...ed, nome: e.target.value })} /></label>
        <label>Rede<select value={ed.redeId || ""} onChange={(e) => setEd({ ...ed, redeId: e.target.value || null })}><option value="">Loja avulsa</option>{c.redes.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}</select></label>
        <label>Situação<select value={ed.ativo ? "1" : "0"} onChange={(e) => setEd({ ...ed, ativo: e.target.value === "1" })}><option value="1">Ativa</option><option value="0">Inativa</option></select></label>
        {campo("endereco", "logradouro", "Endereço", true)}{campo("endereco", "numero", "Número")}{campo("endereco", "bairro", "Bairro")}{campo("endereco", "cidade", "Cidade")}{campo("endereco", "uf", "UF")}{campo("endereco", "cep", "CEP")}
        {campo("gerente", "nome", "Gerente responsável")}{campo("gerente", "telefone", "Telefone")}{campo("gerente", "email", "E-mail")}
        {campo("acesso", "instrucoes", "Como acessar (doca, portaria, EPI…)", true)}{campo("acesso", "contatoPortaria", "Contato da portaria")}{campo("acesso", "horarioRecebimento", "Horário de recebimento")}
        <label className="larga">Observações do gerente / CS<textarea value={ed.observacoes} onChange={(e) => setEd({ ...ed, observacoes: e.target.value })} /></label>
        <button className="ouro" onClick={salvar}>Salvar ficha</button></div>
    </Card>
    <Card titulo={`Fotos do estabelecimento (${f.fotos.length}/6)`} extra={<label className="sec"><input type="file" accept="image/*" hidden onChange={(e) => { void enviarFoto(e.target.files?.[0]); e.target.value = ""; }} /><span style={{ cursor: "pointer" }}>＋ Adicionar</span></label>}>
      {f.fotos.length ? <div className="cs-fotos">{f.fotos.map((ft) => <figure key={ft.id}>{urls[ft.id] ? <img src={urls[ft.id]} alt={ft.descricao || "Foto da loja"} /> : <div style={{ height: 90 }} />}<figcaption>{ft.descricao} <button className="sec" onClick={() => c.api.del(`/cs/lojas/${uid}/fotos/${ft.id}`).then(() => recarregar()).catch(falhar(c))}>remover</button></figcaption></figure>)}</div> : <Vazio texto="Sem fotos." />}
    </Card>
    <Card titulo="Histórico de atendimentos">
      <div className="cs-form"><label>Tipo<select value={tipo} onChange={(e) => setTipo(e.target.value)}>{[["ligacao", "Ligação"], ["visita", "Visita"], ["email", "E-mail"], ["whatsapp", "WhatsApp"], ["nota", "Anotação"], ["acao_churn", "Ação de retenção"]].map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></label><label className="larga">Registro<textarea value={nota} onChange={(e) => setNota(e.target.value)} /></label>
        <button disabled={nota.trim().length < 3} onClick={() => c.api.post(`/cs/lojas/${uid}/interacoes`, { tipo, texto: nota }).then(() => { setNota(""); void recarregar(); }).catch(falhar(c))}>Registrar</button></div>
      {f.interacoes.length ? <Tabela cab={["Quando", "Tipo", "Por", "Registro", ""]} linhas={f.interacoes.slice(0, 20).map((x) => [quando(x.em), x.tipo.replace("_", " "), x.autorNome, x.texto, x.status === "aberta" ? <button key="b" className="sec" onClick={() => c.api.put(`/cs/interacoes/${x.id}/concluir`).then(() => recarregar()).catch(falhar(c))}>Concluir</button> : x.status === "concluida" ? <Chip key="o" tom="ok">concluída</Chip> : ""])} /> : <Vazio texto="Nenhum contato registrado." />}
    </Card>
    <Card titulo="Últimas missões"><Tabela cab={["Data", "Horário", "Setor", "Situação", "Check-in", "Nota", "Promotor"]} linhas={f.missoes.map((m) => [dataBR(m.data), `${m.entrada}–${m.saida}`, m.setor, m.concluida ? <Chip key="s" tom="ok">concluída</Chip> : <Chip key="s" tom={m.status === "cancelada" ? "ruim" : "info"}>{m.status}</Chip>, m.atrasoMin === null ? "—" : m.atrasoMin === 0 ? "no horário" : `+${m.atrasoMin} min`, m.estrelas ? `${m.estrelas} ★${m.comentario ? ` · ${m.comentario}` : ""}` : "—", m.promotor || "—"])} /></Card>
  </div>;
}

// ───────── 9) Faturamento B2B ─────────
const ALERTA_FAT: Record<string, [string, "ok" | "aviso" | "ruim"]> = { ok: ["Em dia", "ok"], saldo_baixo: ["Saldo baixo", "aviso"], saldo_esgotado: ["Saldo esgotado", "ruim"], limite_proximo: ["Perto do limite", "aviso"], limite_estourado: ["Limite estourado", "ruim"] };
export function Faturamento({ c }: { c: Ctx }) {
  const { dados, erro, recarregar } = useCarga(() => c.api.get<LinhaFaturamento[]>(`/cs/faturamento${c.redeId ? `?redeId=${c.redeId}` : ""}`), [c.redeId]);
  const [sel, setSel] = useState(""), [lan, setLan] = useState({ tipo: "credito", valor: "", descricao: "" }), [cfg, setCfg] = useState({ modelo: "prepago", limite: "", ciclo: "1", inicio: "" });
  if (erro) return <p className="cs-erro">{erro}</p>; if (!dados) return <Vazio texto="Carregando…" />;
  const r = dados.find((x) => x.redeId === sel);
  const lancar = () => c.api.post(`/cs/faturamento/${sel}/lancamentos`, { tipo: lan.tipo, valorCentavos: reais(lan.valor), descricao: lan.descricao }).then(() => { setLan({ ...lan, valor: "", descricao: "" }); c.avisar("ok", "Lançamento registrado."); void recarregar(); }).catch(falhar(c));
  const salvarCfg = () => c.api.put(`/cs/faturamento/${sel}`, { modelo: cfg.modelo, ...(cfg.limite ? { limiteCentavos: reais(cfg.limite) } : {}), cicloDia: Number(cfg.ciclo), ...(cfg.inicio ? { inicioApuracao: cfg.inicio } : {}) }).then(() => { c.avisar("ok", "Configuração salva."); void recarregar(); }).catch(falhar(c));
  return <div className="cs-grade">
    <div className="cs-grade g3">{dados.map((x) => { const uso = x.usoLimitePct ?? 0, [rot, tom] = ALERTA_FAT[x.alerta]; return <Card key={x.redeId} titulo={x.rede} extra={<Chip tom={tom}>{rot}</Chip>}>
      {x.modelo === "prepago" ? <><Kpi rotulo="Saldo disponível" valor={brl(x.saldoDisponivelCentavos)} sub={x.diasDeSaldo === null ? "sem consumo recente" : `≈ ${x.diasDeSaldo} dias no ritmo atual`} tom={(x.saldoDisponivelCentavos ?? 0) > 0 ? "ok" : "ruim"} /><p className="cs-nota">Créditos {brl(x.creditosCentavos)} · consumido {brl(x.consumoCentavos)} · comprometido {brl(x.comprometidoCentavos)}</p></>
        : <><Kpi rotulo="Uso do limite no ciclo" valor={pc(x.usoLimitePct)} sub={`${brl(x.consumoCicloCentavos)} de ${brl(x.limiteCentavos)} · fecha em ${x.proximoFechamento ? dataBR(x.proximoFechamento) : "—"}`} /><div className={`cs-barra ${uso >= 100 ? "perigo" : uso >= 85 ? "alerta" : ""}`}><i style={{ width: `${Math.min(100, uso)}%` }} /></div></>}
      {x.apuracaoParcial && <p className="cs-nota">⚠ O início da apuração é anterior ao histórico carregado: o consumo pode estar subestimado.</p>}
      <button className="sec" onClick={() => { setSel(x.redeId); setCfg({ modelo: x.modelo, limite: x.limiteCentavos ? String(x.limiteCentavos / 100) : "", ciclo: "1", inicio: "" }); }}>Gerir</button></Card>; })}</div>
    {!dados.length && <Card><Vazio texto="Crie uma rede na aba Contas-chave para controlar saldo ou faturamento." /></Card>}
    {r && <div className="cs-grade g2">
      <Card titulo={`Configuração — ${r.rede}`}><div className="cs-form"><label>Modelo<select value={cfg.modelo} onChange={(e) => setCfg({ ...cfg, modelo: e.target.value })}><option value="prepago">Pré-pago (saldo)</option><option value="pospago">Pós-pago (fatura)</option></select></label>
        <label>Limite pós-pago (R$)<input value={cfg.limite} onChange={(e) => setCfg({ ...cfg, limite: e.target.value })} inputMode="decimal" /></label><label>Dia de fechamento (1–28)<input value={cfg.ciclo} onChange={(e) => setCfg({ ...cfg, ciclo: e.target.value })} inputMode="numeric" /></label><label>Início da apuração<input type="date" value={cfg.inicio} onChange={(e) => setCfg({ ...cfg, inicio: e.target.value })} /></label><button onClick={salvarCfg}>Salvar</button></div><p className="cs-nota">Exige login recente. Alterar o início da apuração muda o saldo.</p></Card>
      <Card titulo="Novo lançamento"><div className="cs-form"><label>Tipo<select value={lan.tipo} onChange={(e) => setLan({ ...lan, tipo: e.target.value })}><option value="credito">Crédito (recarga)</option><option value="ajuste">Ajuste (+/−)</option><option value="fatura">Fatura emitida</option></select></label><label>Valor (R$)<input value={lan.valor} onChange={(e) => setLan({ ...lan, valor: e.target.value })} inputMode="decimal" /></label><label className="larga">Descrição<input value={lan.descricao} onChange={(e) => setLan({ ...lan, descricao: e.target.value })} /></label><button className="ouro" disabled={!lan.valor || lan.descricao.trim().length < 2} onClick={lancar}>Registrar</button></div><p className="cs-nota">O razão não se edita: erros se corrigem com um ajuste.</p></Card>
      <Card titulo="Lançamentos recentes" className="larga">{r.lancamentos.length ? <Tabela cab={["Quando", "Tipo", "Valor", "Descrição", ""]} linhas={r.lancamentos.map((l) => [quando(l.em), l.tipo, brl(l.valorCentavos), l.descricao, l.tipo === "fatura" ? <button key="p" className="sec" onClick={() => c.api.put(`/cs/faturamento/${r.redeId}/lancamentos/${l.id}/paga`, { paga: !l.paga }).then(() => recarregar()).catch(falhar(c))}>{l.paga ? "✓ paga" : "marcar paga"}</button> : ""])} /> : <Vazio texto="Sem lançamentos." />}</Card>
    </div>}
  </div>;
}

// ───────── 10) Marcas parceiras ─────────
export function Marcas({ c }: { c: Ctx }) {
  const { dados, erro } = useCarga(() => c.api.get<LinhaMarca[]>(`/cs/marcas${qs(c)}`), [c.dias, c.redeId]);
  if (erro) return <p className="cs-erro">{erro}</p>; if (!dados) return <Vazio texto="Carregando…" />; if (!dados.length) return <Card><Vazio texto="Nenhuma missão com marca patrocinadora no período." /></Card>;
  return <div className="cs-grade g2">
    <Card titulo="Horas de reposição por marca"><ResponsiveContainer width="100%" height={Math.max(220, dados.length * 36)}><BarChart data={dados} layout="vertical"><CartesianGrid stroke={COR.grade} /><XAxis type="number" {...EIXO} /><YAxis type="category" dataKey="marca" width={110} {...EIXO} /><Tooltip {...TOOLTIP} /><Bar dataKey="horas" name="Horas" fill={COR.azul} radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></Card>
    <Card titulo="Indústrias parceiras"><Tabela cab={["Marca", "Missões", "Lojas", "Horas", "Gôndola cheia", "Fill rate", "CSAT", "Contestadas"]} linhas={dados.map((m) => [m.marca, m.missoes, m.lojas, num(m.horas), pc(m.gondolaCheiaPct), pc(m.fillRate), num(m.csat, 2), m.auditoriasContestadas])} /><p className="cs-nota">Regiões: {[...new Set(dados.flatMap((m) => m.regioes))].join(", ") || "—"}. Valores de patrocínio não são modelados hoje.</p></Card>
  </div>;
}

// ───────── 14) Churn ─────────
export function Churn({ c, painel, abrirLoja }: { c: Ctx; painel: PainelCS; abrirLoja: (uid: string) => void }) {
  const ch = painel.churn, [alvo, setAlvo] = useState<LojaChurn | null>(null), [texto, setTexto] = useState("");
  const registrar = () => alvo && c.api.post(`/cs/lojas/${alvo.lojaUid}/interacoes`, { tipo: "acao_churn", texto }).then(() => { c.avisar("ok", "Ação de retenção registrada."); setAlvo(null); setTexto(""); }).catch(falhar(c));
  return <div className="cs-grade">
    <div className="cs-grade g4"><Kpi rotulo={`Lojas sem missão há ≥ ${ch.limiteDias} dias`} valor={String(ch.resumo.risco + ch.resumo.critico)} tom={ch.resumo.risco + ch.resumo.critico ? "ruim" : "ok"} /><Kpi rotulo="Em atenção" valor={String(ch.resumo.atencao)} sub={`a partir de ${Math.ceil(ch.limiteDias * 0.6)} dias`} /><Kpi rotulo="Saudáveis" valor={String(ch.resumo.saudavel)} tom="ok" /><Kpi rotulo="Receita em risco (90 d)" valor={brl(ch.receitaEmRiscoCentavos)} /></div>
    <Card titulo="Alerta de inatividade">{ch.itens.length ? <Tabela cab={["Loja", "Rede", "Sem missão há", "Última missão", "Missões 90 d", "Gasto 90 d", "Nível", ""]} linhas={ch.itens.map((i) => [i.nome, i.redeNome || "—", i.alemDaJanela ? `> ${i.diasSemMissao} dias` : `${i.diasSemMissao} dias`, i.semNenhumaMissao ? "nunca criou" : quando(i.ultimaMissaoEm), i.missoes90d, brl(i.gasto90dCentavos), <ChipNivel key="n" n={i.nivel} />, <span key="a"><button className="sec" onClick={() => abrirLoja(i.lojaUid)}>Ficha</button> {i.acaoAberta ? <Chip tom="info">ação aberta</Chip> : <button onClick={() => setAlvo(i)}>Agir</button>}</span>])} /> : <Vazio texto="Nenhuma loja inativa. 🎉" />}</Card>
    {alvo && <Card titulo={`Ação preventiva — ${alvo.nome}`}><textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: ligar para o gerente, oferecer pacote de reposição para o fim de semana…" /><p><button className="ouro" disabled={texto.trim().length < 3} onClick={registrar}>Registrar ação</button> <button className="sec" onClick={() => setAlvo(null)}>Cancelar</button></p></Card>}
  </div>;
}

// ───────── 11) NPS B2B ─────────
export function Nps({ c }: { c: Ctx }) {
  const { dados, erro, recarregar } = useCarga(() => c.api.get<MetricaNps>(`/cs/nps${qs(c)}`), [c.dias, c.redeId]);
  if (erro) return <p className="cs-erro">{erro}</p>; if (!dados) return <Vazio texto="Carregando…" />;
  const disparar = () => { if (!window.confirm(c.redeId ? "Enviar a pesquisa NPS às lojas desta rede agora?" : "Enviar a pesquisa NPS a TODAS as lojas que usaram a plataforma?")) return; c.api.post<{ enviados: number }>("/cs/nps/disparar", c.redeId ? { redeId: c.redeId } : { todas: true }).then((r) => { c.avisar("ok", `${r.enviados} pesquisa(s) enviada(s).`); void recarregar(); }).catch(falhar(c)); };
  return <div className="cs-grade">
    <div className="cs-grade g4"><Kpi rotulo="NPS" valor={dados.nps === null ? "—" : String(dados.nps)} tom={(dados.nps ?? 0) >= 50 ? "ok" : (dados.nps ?? 0) < 0 ? "ruim" : "neutro"} sub={`${dados.respostas} respostas`} /><Kpi rotulo="Promotores (9–10)" valor={String(dados.promotores)} tom="ok" /><Kpi rotulo="Neutros (7–8)" valor={String(dados.neutros)} /><Kpi rotulo="Detratores (0–6)" valor={String(dados.detratores)} tom={dados.detratores ? "ruim" : "ok"} /><Kpi rotulo="Taxa de resposta" valor={pc(dados.taxaResposta)} sub={`${dados.pendentes} pendentes`} /></div>
    <div className="cs-grade g2"><Card titulo="NPS por mês" extra={<button onClick={disparar}>Disparar pesquisa agora</button>}>{dados.serie.length ? <ResponsiveContainer width="100%" height={220}><LineChart data={dados.serie}><CartesianGrid stroke={COR.grade} /><XAxis dataKey="mes" {...EIXO} /><YAxis domain={[-100, 100]} {...EIXO} /><Tooltip {...TOOLTIP} /><Line dataKey="nps" name="NPS" stroke={COR.ouro} strokeWidth={2} /></LineChart></ResponsiveContainer> : <Vazio />}<p className="cs-nota">As pesquisas também saem sozinhas, no intervalo configurado, para as lojas que usaram a plataforma.</p></Card>
      <Card titulo="Comentários">{dados.comentarios.length ? <Tabela cab={["Loja", "Nota", "Comentário"]} linhas={dados.comentarios.map((x) => [x.loja, x.nota, x.comentario])} /> : <Vazio texto="Sem comentários." />}</Card></div>
  </div>;
}

// ───────── 15) Exportador executivo ─────────
export function Exportar({ c }: { c: Ctx }) {
  const [formato, setFormato] = useState("pptx"), [aud, setAud] = useState(c.redeId ? "cliente" : "interno"), [ocupado, setOcupado] = useState(false);
  const rede = c.redes.find((r) => r.id === c.redeId);
  return <Card titulo="Relatório executivo para reunião"><div className="cs-form">
    <label>Escopo<input readOnly value={rede ? rede.nome : "Todas as redes (use o filtro do topo para escolher uma)"} /></label>
    <label>Período<input readOnly value={`Últimos ${c.dias} dias`} /></label>
    <label>Formato<select value={formato} onChange={(e) => setFormato(e.target.value)}><option value="pptx">PowerPoint (.pptx)</option><option value="html">Página/PDF (imprimir)</option><option value="csv">Planilha (.csv)</option></select></label>
    <label>Para quem<select value={aud} onChange={(e) => setAud(e.target.value)}><option value="cliente" disabled={!c.redeId}>Cliente (sem churn nem dados internos)</option><option value="interno">Interno (inclui contas e churn)</option></select></label>
    <button className="ouro" disabled={ocupado || (aud === "cliente" && !c.redeId)} onClick={() => { setOcupado(true); c.api.baixar(`/cs/exportar${qs(c, `&formato=${formato}&audiencia=${aud}`)}`, `resultados.${formato}`).then(() => c.avisar("ok", "Relatório gerado.")).catch(falhar(c)).finally(() => setOcupado(false)); }}>{ocupado ? "Gerando…" : "Gerar e baixar"}</button></div>
    <p className="cs-nota">O relatório do cliente traz só valores que a própria loja paga; nunca repasse, comissão ou nomes de promotores. Para PDF, abra o HTML e use Imprimir → Salvar como PDF.</p></Card>;
}

// ───────── 7) LOJA: central de solicitações recorrentes ─────────
const DIAS_SEM = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export function RecorrenciasLoja({ api, avisar }: { api: Api; avisar: Ctx["avisar"] }) {
  const { dados, recarregar } = useCarga(() => api.get<Recorrencia[]>("/cs/loja/recorrencias"), []);
  const [f, setF] = useState({ nome: "", setor: SETORES_PEDIDO[0] as string, entrada: "08:00", saida: "12:00", tipo: "datas", datas: [] as string[], novaData: "", dias: [] as number[], ate: "" });
  const salvar = () => api.post("/cs/loja/recorrencias", { nome: f.nome, setor: f.setor, entrada: f.entrada, saida: f.saida, tipo: f.tipo, ...(f.tipo === "datas" ? { datas: f.datas } : { diasSemana: f.dias, ate: f.ate }) }).then(() => { avisar("ok", "Programação criada. Os pedidos são abertos automaticamente perto da data."); setF({ ...f, nome: "", datas: [], dias: [] }); void recarregar(); }).catch((e) => avisar("erro", (e as Error).message));
  return <div className="cs-grade g2">
    <Card titulo="Programar reposições (datas comemorativas e picos)"><div className="cs-form">
      <label className="larga">Nome<input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Natal 2026, Black Friday" /></label>
      <label>Setor<select value={f.setor} onChange={(e) => setF({ ...f, setor: e.target.value })}>{SETORES_PEDIDO.map((s) => <option key={s}>{s}</option>)}</select></label>
      <label>Entrada<input type="time" value={f.entrada} onChange={(e) => setF({ ...f, entrada: e.target.value })} /></label><label>Saída<input type="time" value={f.saida} onChange={(e) => setF({ ...f, saida: e.target.value })} /></label>
      <label>Repetição<select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}><option value="datas">Datas específicas</option><option value="semanal">Toda semana</option></select></label>
      {f.tipo === "datas" ? <div className="larga"><label>Adicionar data<input type="date" value={f.novaData} onChange={(e) => setF({ ...f, novaData: e.target.value })} /></label> <button className="sec" disabled={!f.novaData} onClick={() => setF({ ...f, datas: [...new Set([...f.datas, f.novaData])].sort(), novaData: "" })}>＋ Incluir</button> {f.datas.map((d) => <Chip key={d} tom="info">{dataBR(d)} <a onClick={() => setF({ ...f, datas: f.datas.filter((x) => x !== d) })} style={{ cursor: "pointer" }}>✕</a></Chip>)}</div>
        : <><div className="larga">{DIAS_SEM.map((n, i) => <label key={n} style={{ display: "inline-flex", flexDirection: "row", gap: 4, marginRight: 10 }}><input type="checkbox" checked={f.dias.includes(i)} onChange={() => setF({ ...f, dias: f.dias.includes(i) ? f.dias.filter((x) => x !== i) : [...f.dias, i] })} />{n}</label>)}</div><label>Repetir até<input type="date" value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} /></label></>}
      <button className="ouro" disabled={f.nome.trim().length < 3 || (f.tipo === "datas" ? !f.datas.length : !f.dias.length || !f.ate)} onClick={salvar}>Criar programação</button></div>
      <p className="cs-nota">Os pedidos nascem sozinhos {"~"}2 semanas antes de cada data, com o mesmo preço e regras de um pedido normal. Exige cartão válido cadastrado.</p></Card>
    <Card titulo="Minhas programações">{dados?.length ? <Tabela cab={["Nome", "Setor", "Horário", "Quando", "Gerados", ""]} linhas={dados.map((r) => [r.nome + (r.ativo ? "" : " (encerrada)"), r.setor, `${r.entrada}–${r.saida}`, r.tipo === "datas" ? r.datas.map(dataBR).join(", ") : `${r.diasSemana.map((d) => DIAS_SEM[d]).join("/")} até ${r.ate ? dataBR(r.ate) : ""}`, r.ultimaFalha ? <Chip key="f" tom="ruim">{r.ultimaFalha}</Chip> : r.geradas.length, r.ativo ? <button key="x" className="sec" onClick={() => api.del(`/cs/loja/recorrencias/${r.id}`).then(() => recarregar()).catch((e) => avisar("erro", (e as Error).message))}>Encerrar</button> : ""])} /> : <Vazio texto="Nenhuma programação ainda." />}</Card>
  </div>;
}

// ───────── 11) LOJA: responder NPS ─────────
export function NpsLoja({ api, avisar }: { api: Api; avisar: Ctx["avisar"] }) {
  const { dados, recarregar } = useCarga(() => api.get<{ id: string } | null>("/cs/loja/nps/pendente"), []);
  const [nota, setNota] = useState<number | null>(null), [txt, setTxt] = useState("");
  if (!dados) return null;
  return <Card titulo="Como estamos atendendo sua loja?"><p>De 0 a 10, o quanto você recomendaria o Abastece Já a outro gerente?</p>
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{Array.from({ length: 11 }, (_, n) => <button key={n} className={nota === n ? "ouro" : "sec"} onClick={() => setNota(n)} aria-pressed={nota === n}>{n}</button>)}</div>
    <p><textarea placeholder="Quer comentar? (opcional)" value={txt} onChange={(e) => setTxt(e.target.value)} maxLength={500} /></p>
    <button disabled={nota === null} onClick={() => api.post(`/cs/loja/nps/${dados.id}/responder`, { nota, comentario: txt }).then(() => { avisar("ok", "Obrigado pela resposta!"); void recarregar(); }).catch((e) => avisar("erro", (e as Error).message))}>Enviar</button></Card>;
}
