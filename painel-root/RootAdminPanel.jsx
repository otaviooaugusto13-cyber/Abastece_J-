// Painel do ADMIN ROOT — Abastece Já. React + Tailwind (dark minimalista: azul-noite, ouro #d4af37, azul real #4169e1).
//
// Uso (Next.js / Vite):
//   <RootAdminPanel getToken={() => auth.currentUser.getIdToken()} apiBase="https://SEU-APP.onrender.com"
//                   onReautenticar={() => signInWithPopup(auth, provider)} />
// A tela só mostra o que a API devolve; quem decide é o servidor (is_root, validações, auditoria). Dinheiro trafega em centavos.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const OURO = "text-[#d4af37]", BORDA = "border-[#1c2745]";
const CARD = `rounded-2xl border ${BORDA} bg-[#0e1527] p-5 shadow-lg shadow-black/30`;
const INPUT = `w-full rounded-lg border ${BORDA} bg-[#0a1020] px-3 py-2 text-sm text-slate-100 outline-none focus:border-[#4169e1]`;
const BTN = "rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40";
const BTN_OURO = `${BTN} bg-[#d4af37] text-[#0a1020] hover:brightness-110`;
const BTN_AZUL = `${BTN} bg-[#4169e1] text-white hover:brightness-110`;
const brl = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const quando = (iso) => new Date(iso).toLocaleString("pt-BR");
const FUNCOES = [["cadastros", "Novos cadastros", "Loja e promotor"], ["missoes", "Criação de missões", "Pedidos e chamados relâmpago"], ["pagamentos", "Pagamentos", "Cobrança e saques"]];
const ROTULO_ACAO = { "root.raio.alterar": "Raio de atendimento", "root.master.alterar": "Master Switch", "root.taxas.alterar": "Taxas", "root.conceder": "Concessão Root", "root.acesso.negado": "Acesso negado" };
const COR_RESULTADO = { solicitado: "bg-slate-700 text-slate-200", aplicado: "bg-emerald-900/60 text-emerald-300", falhou: "bg-red-900/60 text-red-300", negado: "bg-amber-900/60 text-amber-300" };

export default function RootAdminPanel({ getToken, apiBase = "", onReautenticar }) {
  const [painel, setPainel] = useState(null);
  const [aviso, setAviso] = useState(null);                 // { tipo: "ok" | "erro", texto }
  const [ocupado, setOcupado] = useState("");
  const [raio, setRaio] = useState(20);
  const [funcoes, setFuncoes] = useState({ cadastros: true, missoes: true, pagamentos: true });
  const [motivo, setMotivo] = useState("");
  const [taxa, setTaxa] = useState({ diaria: "200", comissaoPct: 25, fixa: "0" });
  const [panico, setPanico] = useState(false);
  const [audit, setAudit] = useState({ itens: [], proximo: null });
  const [cadeia, setCadeia] = useState(null);

  const getTokenRef = useRef(getToken), reauthRef = useRef(onReautenticar);   // refs: funções inline do pai não disparam novas buscas
  getTokenRef.current = getToken; reauthRef.current = onReautenticar;
  const api = useCallback(async (caminho, { method = "GET", body } = {}) => {
    const r = await fetch(apiBase + caminho, { method, headers: { Authorization: `Bearer ${await getTokenRef.current()}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.erro || "Falha na requisição."), { status: r.status, codigo: j.codigo });
    return j;
  }, [apiBase]);

  const falhou = useCallback((e) => {
    if (e.codigo === "reautenticar") { setAviso({ tipo: "erro", texto: "Por segurança, entre de novo com o Google e repita a ação." }); reauthRef.current?.(); }
    else setAviso({ tipo: "erro", texto: e.message });
  }, []);

  const preencher = (p) => {                                // rascunhos ← valores vigentes do servidor
    setRaio(p.operacao.raioKm); setFuncoes({ ...p.operacao.master }); setMotivo("");
    const t = p.taxas; setTaxa({ diaria: String(t.diariaCentavos / 100), comissaoPct: +((t.comissaoCentavos * 100) / t.diariaCentavos).toFixed(2), fixa: String(t.taxaFixaCentavos / 100) });
  };
  const carregarAuditoria = useCallback(async (cursor) => {
    const j = await api(`/root/auditoria?limite=20${cursor ? `&cursor=${cursor}` : ""}`);
    setAudit((a) => ({ itens: cursor ? [...a.itens, ...j.itens] : j.itens, proximo: j.proximo }));
  }, [api]);
  const carregar = useCallback(async (resetar = true) => {
    try { const p = await api("/root/painel"); setPainel(p); if (resetar) preencher(p); await carregarAuditoria(); }
    catch (e) { falhou(e); }
  }, [api, carregarAuditoria, falhou]);

  useEffect(() => { carregar(true); }, [carregar]);
  useEffect(() => { const id = setInterval(() => carregar(false), 20_000); return () => clearInterval(id); }, [carregar]);   // status e trilha sem apagar o que você está digitando

  const executar = async (nome, fn, textoOk) => {
    setOcupado(nome); setAviso(null);
    try { await fn(); setAviso({ tipo: "ok", texto: textoOk }); await carregar(true); }
    catch (e) { falhou(e); if (e.status === 409) await carregar(true); }   // outro Root alterou: recarrega os valores atuais
    finally { setOcupado(""); }
  };

  const op = painel?.operacao, tx = painel?.taxas;
  const [rMin, rMax] = painel?.limitesOperacao.raioKm || [1, 50];
  const pausado = op && Object.values(op.master).some((v) => !v);

  // ----- taxas: % ↔ centavos (a comissão é derivada da %, o repasse é o que sobra: a soma SEMPRE fecha na diária) -----
  const calc = useMemo(() => {
    const diaria = Math.round(parseFloat(taxa.diaria) * 100), pct = Number(taxa.comissaoPct), fixa = Math.round(parseFloat(taxa.fixa) * 100);
    if (![diaria, pct, fixa].every(Number.isFinite) || pct < 0 || pct >= 100) return null;
    const comissao = Math.round((diaria * pct) / 100);
    return { diariaCentavos: diaria, comissaoCentavos: comissao, repasseCentavos: diaria - comissao, taxaFixaCentavos: fixa };
  }, [taxa]);
  const taxaMudou = tx && calc && ["diariaCentavos", "comissaoCentavos", "repasseCentavos", "taxaFixaCentavos"].some((k) => calc[k] !== tx[k]);
  const funcoesMudaram = op && FUNCOES.some(([k]) => funcoes[k] !== op.master[k]);
  const vaiPausar = op && FUNCOES.some(([k]) => op.master[k] && !funcoes[k]);

  const salvarRaio = () => executar("raio", () => api("/root/operacao", { method: "PUT", body: { raioKm: raio, versao: op.versao } }), `Raio de atendimento: ${raio} km. Os apps atualizam em instantes.`);
  const salvarMaster = () => executar("master", () => api("/root/master", { method: "PUT", body: { ...funcoes, motivo, versao: op.versao } }), "Master Switch atualizado.");
  const salvarTaxas = () => executar("taxas", () => api("/root/taxas", { method: "PUT", body: { ...calc, horasMin: tx.horasMin, horasMax: tx.horasMax, maxSemana: tx.maxSemana, versao: tx.versao } }), "Taxas salvas. Valem para os próximos pedidos.");
  const pausarTudo = () => executar("panico", async () => { await api("/root/master", { method: "PUT", body: { cadastros: false, missoes: false, pagamentos: false, motivo, versao: op.versao } }); setPanico(false); }, "Tudo pausado.");
  const verificar = async () => { try { setCadeia(await api("/root/auditoria/verificar")); } catch (e) { falhou(e); } };

  if (!painel) return <Moldura><p className="text-slate-400">{aviso ? aviso.texto : "Carregando painel Root…"}</p></Moldura>;

  return (
    <Moldura>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={`text-2xl font-bold tracking-tight ${OURO}`}>Admin Root</h1>
          <p className="text-sm text-slate-400">Parâmetros globais da plataforma · {painel.eu.email}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${pausado ? "bg-red-900/60 text-red-300" : "bg-emerald-900/50 text-emerald-300"}`}>{pausado ? "OPERAÇÃO COM PAUSAS" : "OPERAÇÃO NORMAL"}</span>
      </header>

      {pausado && <div role="alert" className="mb-5 rounded-xl border border-red-500/40 bg-red-950/40 p-4 text-sm text-red-200">Pausado: {FUNCOES.filter(([k]) => !op.master[k]).map(([, n]) => n.toLowerCase()).join(", ")}. {op.motivoPausa && <>Motivo registrado: <b>{op.motivoPausa}</b>.</>}</div>}
      {aviso && <div role="status" className={`mb-5 rounded-xl border p-3 text-sm ${aviso.tipo === "ok" ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-200" : "border-red-500/40 bg-red-950/40 text-red-200"}`}>{aviso.texto}</div>}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ---------- Raio ---------- */}
        <section className={CARD}>
          <Titulo t="Raio de atendimento" s={`Alcance das buscas por proximidade (${rMin}–${rMax} km). Vale em tempo real para os apps.`} />
          <div className="mt-4 flex items-center gap-4">
            <input type="range" min={rMin} max={rMax} step={1} value={raio} onChange={(e) => setRaio(+e.target.value)} aria-label="Raio em km" className="h-2 flex-1 cursor-pointer accent-[#d4af37]" />
            <div className="flex items-center gap-2"><input type="number" min={rMin} max={rMax} value={raio} onChange={(e) => setRaio(Math.max(rMin, Math.min(rMax, Math.round(+e.target.value || rMin))))} className={`${INPUT} w-20 text-center`} /><span className="text-sm text-slate-400">km</span></div>
          </div>
          <p className="mt-2 text-xs text-slate-500">Vigente: <b className="text-slate-300">{op.raioKm} km</b> · v{op.versao}</p>
          <button className={`${BTN_OURO} mt-4`} disabled={raio === op.raioKm || !!ocupado} onClick={salvarRaio}>{ocupado === "raio" ? "Salvando…" : "Salvar raio"}</button>
        </section>

        {/* ---------- Master Switch ---------- */}
        <section className={`${CARD} ${pausado ? "border-red-500/40" : ""}`}>
          <Titulo t="Master Switch" s="Pausa instantânea em caso de indisponibilidade externa. Todo uso fica na auditoria." />
          <ul className="mt-4 space-y-3">
            {FUNCOES.map(([k, nome, desc]) => (
              <li key={k} className="flex items-center justify-between gap-3">
                <div><p className="text-sm font-medium text-slate-100">{nome}</p><p className="text-xs text-slate-500">{desc}</p></div>
                <button role="switch" aria-checked={funcoes[k]} aria-label={nome} onClick={() => setFuncoes((f) => ({ ...f, [k]: !f[k] }))} className={`relative h-6 w-11 rounded-full transition ${funcoes[k] ? "bg-[#4169e1]" : "bg-red-700"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${funcoes[k] ? "left-[22px]" : "left-0.5"}`} /></button>
              </li>
            ))}
          </ul>
          {vaiPausar && <textarea className={`${INPUT} mt-4`} rows={2} maxLength={200} placeholder="Motivo da pausa (obrigatório, mín. 5 caracteres)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
          <div className="mt-4 flex flex-wrap gap-2">
            <button className={BTN_AZUL} disabled={!funcoesMudaram || !!ocupado || (vaiPausar && motivo.trim().length < 5)} onClick={salvarMaster}>{ocupado === "master" ? "Aplicando…" : "Aplicar"}</button>
            <button className={`${BTN} border border-red-500/60 bg-red-950/50 text-red-200 hover:bg-red-900/60`} disabled={!!ocupado || (op.master.cadastros === false && op.master.missoes === false && op.master.pagamentos === false)} onClick={() => { setMotivo(""); setPanico(true); }}>⏻ Botão de pânico: pausar tudo</button>
          </div>
        </section>

        {/* ---------- Taxas ---------- */}
        <section className={`${CARD} lg:col-span-2`}>
          <Titulo t="Taxas e repasse" s="Valem para os pedidos criados a partir de agora (pedidos já criados mantêm o preço congelado)." />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Campo r="Diária paga pela loja (R$)"><input type="number" min="10" max="5000" step="0.01" className={INPUT} value={taxa.diaria} onChange={(e) => setTaxa({ ...taxa, diaria: e.target.value })} /></Campo>
            <Campo r="Comissão da plataforma (%)"><input type="number" min="0" max="99" step="0.5" className={INPUT} value={taxa.comissaoPct} onChange={(e) => setTaxa({ ...taxa, comissaoPct: e.target.value })} /></Campo>
            <Campo r="Repasse ao profissional (%)"><input type="number" min="1" max="100" step="0.5" className={INPUT} value={calc ? +(100 - Number(taxa.comissaoPct)).toFixed(2) : ""} onChange={(e) => setTaxa({ ...taxa, comissaoPct: +(100 - Number(e.target.value)).toFixed(2) })} /></Campo>
            <Campo r="Taxa fixa por loja (R$)"><input type="number" min="0" max="500" step="0.01" className={INPUT} value={taxa.fixa} onChange={(e) => setTaxa({ ...taxa, fixa: e.target.value })} /></Campo>
          </div>
          <div className={`mt-4 rounded-xl border ${BORDA} bg-[#0a1020] p-3 text-sm text-slate-300`}>
            {calc ? <>Plataforma fica com <b className={OURO}>{brl(calc.comissaoCentavos)}</b> · profissional recebe <b className="text-[#7b9bff]">{brl(calc.repasseCentavos)}</b> · loja paga <b>{brl(calc.diariaCentavos + calc.taxaFixaCentavos)}</b> (diária + taxa fixa). Comissão + repasse = diária.</> : <span className="text-amber-300">Confira os valores: use diária e taxa fixa em reais e comissão entre 0% e 99%.</span>}
          </div>
          <p className="mt-2 text-xs text-slate-500">Vigente: {brl(tx.diariaCentavos)} · comissão {brl(tx.comissaoCentavos)} · repasse {brl(tx.repasseCentavos)} · taxa fixa {brl(tx.taxaFixaCentavos)} · v{tx.versao}</p>
          <button className={`${BTN_OURO} mt-4`} disabled={!taxaMudou || !!ocupado} onClick={salvarTaxas}>{ocupado === "taxas" ? "Salvando…" : "Salvar taxas"}</button>
        </section>

        {/* ---------- Auditoria ---------- */}
        <section className={`${CARD} lg:col-span-2`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <Titulo t="Auditoria financeira e operacional" s="Registro imutável: quem alterou, quando, de qual IP. Cada linha carrega o hash da anterior." />
            <button className={`${BTN} border ${BORDA} text-slate-200 hover:border-[#4169e1]`} onClick={verificar}>Verificar integridade da cadeia</button>
          </div>
          {cadeia && <p role="status" className={`mt-3 text-sm ${cadeia.ok ? "text-emerald-300" : "text-red-300"}`}>{cadeia.ok ? `Cadeia íntegra: ${cadeia.verificados} registros conferidos.` : `ATENÇÃO: cadeia comprometida — ${cadeia.problemas.map((p) => `#${p.seq} ${p.problema}`).join(", ")}`}</p>}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2 pr-3">Quando</th><th className="pr-3">Quem</th><th className="pr-3">Ação</th><th className="pr-3">Resultado</th><th className="pr-3">IP</th><th>Detalhe</th></tr></thead>
              <tbody>
                {audit.itens.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-500">Nenhum registro ainda.</td></tr>}
                {audit.itens.map((a) => (
                  <tr key={a.seq} className={`border-t ${BORDA} align-top text-slate-300`}>
                    <td className="whitespace-nowrap py-2 pr-3">{quando(a.em)}</td>
                    <td className="pr-3">{a.operadorEmail || a.operadorUid || "—"}</td>
                    <td className="pr-3">{ROTULO_ACAO[a.acao] || a.acao}</td>
                    <td className="pr-3"><span className={`rounded-full px-2 py-0.5 text-xs ${COR_RESULTADO[a.resultado] || ""}`}>{a.resultado}</span></td>
                    <td className="whitespace-nowrap pr-3 font-mono text-xs">{a.ip || "—"}</td>
                    <td><details><summary className="cursor-pointer text-[#7b9bff]">{a.resumo || "ver"}</summary><pre className="mt-2 max-w-md overflow-x-auto rounded-lg bg-[#0a1020] p-2 text-xs text-slate-400">{JSON.stringify({ antes: a.antes, depois: a.depois }, null, 2)}</pre><p className="mt-1 font-mono text-[10px] text-slate-600">#{a.seq} · {a.hash.slice(0, 16)}…</p></details></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {audit.proximo && <button className={`${BTN} mt-3 border ${BORDA} text-slate-200`} onClick={() => carregarAuditoria(audit.proximo).catch(falhou)}>Carregar mais</button>}
        </section>
      </div>

      {panico && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-red-500/50 bg-[#0e1527] p-6">
            <h2 className="text-lg font-bold text-red-300">Pausar TUDO agora?</h2>
            <p className="mt-2 text-sm text-slate-300">Novos cadastros, criação de missões e pagamentos/saques serão bloqueados imediatamente. Quem já está em turno não é afetado. Você pode religar depois.</p>
            <textarea autoFocus className={`${INPUT} mt-4`} rows={2} maxLength={200} placeholder="Motivo (obrigatório): ex. Mercado Pago fora do ar" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <div className="mt-4 flex justify-end gap-2">
              <button className={`${BTN} border ${BORDA} text-slate-200`} onClick={() => setPanico(false)}>Cancelar</button>
              <button className={`${BTN} bg-red-600 text-white hover:bg-red-500`} disabled={motivo.trim().length < 5 || !!ocupado} onClick={pausarTudo}>{ocupado === "panico" ? "Pausando…" : "Pausar tudo"}</button>
            </div>
          </div>
        </div>
      )}
    </Moldura>
  );
}

const Moldura = ({ children }) => <div className="min-h-screen bg-[#070b16] px-4 py-8 text-slate-200"><div className="mx-auto max-w-6xl">{children}</div></div>;
const Titulo = ({ t, s }) => <div><h2 className="text-base font-semibold text-slate-100">{t}</h2><p className="mt-0.5 text-xs text-slate-500">{s}</p></div>;
const Campo = ({ r, children }) => <label className="block"><span className="mb-1 block text-xs font-medium text-slate-400">{r}</span>{children}</label>;
