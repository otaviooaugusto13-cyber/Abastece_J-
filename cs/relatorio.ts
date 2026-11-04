/**
 * CS & B2B — EXPORTADOR EXECUTIVO: relatório para reunião com o cliente em PPTX, HTML (imprime como PDF) ou CSV.
 * Audiência "cliente" nunca inclui churn, alertas internos, nomes de promotores nem valores de repasse/comissão
 * (o servidor só carrega o que a LOJA paga). Audiência "interno" acrescenta churn e contas.
 */
import type { PainelCS, ContaChave, LinhaFaturamento, LinhaMarca } from "./tipos";

export interface DadosRelatorio { painel: PainelCS; contas: ContaChave[]; faturamento: LinhaFaturamento[]; marcas: LinhaMarca[]; audiencia: "cliente" | "interno" }
export const brl = (c: number): string => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const pc = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const num = (v: number | null | undefined, d = 1): string => (v === null || v === undefined ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: d }));
const dataBR = (iso: string): string => iso.split("-").reverse().join("/");
const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
export const titulo = (d: DadosRelatorio): string => `Resultados Abastece Já — ${d.painel.escopo.rede}`;
export const nomeArquivo = (d: DadosRelatorio, ext: string): string => `abastece-ja-${d.painel.escopo.redeId || "geral"}-${d.painel.periodo.ate}.${ext}`.replace(/[^\w.-]/g, "_");

// ───────────────────────── CSV (";" + BOM: abre direto no Excel pt-BR; defesa contra formula injection) ─────────────────────────
const cel = (v: unknown): string => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function gerarCSV(d: DadosRelatorio): string {
  const p = d.painel, L: unknown[][] = [[titulo(d)], [`Período`, `${dataBR(p.periodo.desde)} a ${dataBR(p.periodo.ate)}`], [], ["INDICADORES"],
    ["Fill rate (%)", p.kpis.fillRate], ["Fill rate no prazo (%)", p.kpis.fillRateNoPrazo], ["CSAT médio (1-5)", p.kpis.csat], ["NPS", p.kpis.nps], ["Pontualidade (%)", p.kpis.pontualidade],
    ["Economia estimada (R$)", p.kpis.economiaCentavos / 100], ["Rupturas evitadas (estimativa)", p.kpis.rupturasEvitadas], [], ["SETORES", "Missões", "Concluídas", "Fill rate %", "CSAT", "Pontualidade %", "Horas"],
    ...p.setores.map((s) => [s.setor, s.missoes, s.concluidas, s.fillRate, s.csat, s.pontualidade, s.horas]), [], ["FILL RATE POR DIA", "Encerradas", "Concluídas", "Fill rate %"],
    ...p.fillRate.serie.map((s) => [s.dia, s.encerradas, s.concluidas, s.fillRate]), [], ["ECONOMIA (ESTIMATIVA)", "On-demand R$", "Fixo equivalente R$", "Economia R$"],
    ...p.roi.meses.map((m) => [m.mes + (m.parcial ? " (parcial)" : ""), m.onDemandCentavos / 100, m.fixoEquivalenteCentavos / 100, m.economiaCentavos / 100])];
  if (d.audiencia === "interno") L.push([], ["CONTAS", "Lojas", "Missões", "Fill rate %", "CSAT", "NPS", "Lojas em churn", "Gasto R$"], ...d.contas.map((c) => [c.nome, c.lojas, c.missoes, c.fillRate, c.csat, c.nps, c.lojasEmChurn, c.gastoCentavos / 100]),
    [], ["CHURN", "Rede", "Dias sem missão", "Nível"], ...p.churn.itens.map((i) => [i.nome, i.redeNome, i.diasSemMissao, i.nivel]));
  return "\uFEFF" + L.map((l) => l.map(cel).join(";")).join("\r\n");
}

// ───────────────────────── HTML (autossuficiente; imprimir = PDF) ─────────────────────────
function svgBarras(itens: { r: string; v: number | null }[], max: number, cor: string): string {
  const w = 640, h = 24, gap = 8, alt = itens.length * (h + gap);
  return `<svg viewBox="0 0 ${w} ${alt}" width="100%" role="img">${itens.map((it, i) => { const y = i * (h + gap), larg = it.v === null ? 0 : Math.max(2, (Math.min(it.v, max) / max) * 380);
    return `<text x="0" y="${y + 16}" font-size="12" fill="#334">${esc(it.r)}</text><rect x="170" y="${y}" width="${larg}" height="${h}" rx="4" fill="${cor}"/><text x="${176 + larg}" y="${y + 16}" font-size="12" fill="#112">${esc(pc(it.v))}</text>`; }).join("")}</svg>`;
}
const tabela = (cab: string[], linhas: (string | number)[][]): string => `<table><thead><tr>${cab.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${linhas.map((l) => `<tr>${l.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
export function gerarHTML(d: DadosRelatorio): string {
  const p = d.painel, k = p.kpis, kpi = (r: string, v: string, sub = "") => `<div class="k"><b>${esc(v)}</b><span>${esc(r)}</span><i>${esc(sub)}</i></div>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo(d))}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{--ouro:#d4af37;--azul:#4169e1;--noite:#0a1020}*{box-sizing:border-box}body{font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif;margin:0;color:#14203a;background:#f4f6fb}
header{background:var(--noite);color:#fff;padding:32px 40px}header h1{margin:0 0 4px;font-size:26px;color:var(--ouro)}header p{margin:0;opacity:.8}main{max-width:980px;margin:0 auto;padding:24px}
section{background:#fff;border-radius:14px;padding:20px 24px;margin:0 0 18px;box-shadow:0 1px 4px #0002;break-inside:avoid}h2{margin:0 0 12px;font-size:17px;color:var(--noite);border-left:4px solid var(--ouro);padding-left:10px}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.k{border:1px solid #dfe5f3;border-radius:12px;padding:12px;display:flex;flex-direction:column}.k b{font-size:24px;color:var(--azul)}.k span{font-weight:600}.k i{font-size:12px;color:#5b6784;font-style:normal}
table{width:100%;border-collapse:collapse}th,td{padding:6px 8px;text-align:left;border-bottom:1px solid #e6eaf5;font-size:13px}th{background:#eef2fb}small{color:#5b6784}
@media print{body{background:#fff}section{box-shadow:none;border:1px solid #ddd}header{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>
<header><h1>${esc(titulo(d))}</h1><p>Período: ${dataBR(p.periodo.desde)} a ${dataBR(p.periodo.ate)} · gerado em ${new Date(p.geradoEm).toLocaleDateString("pt-BR")}</p></header><main>
<section><h2>Resumo executivo</h2><div class="g">${kpi("Taxa de preenchimento", pc(k.fillRate), `meta ${pc(p.fillRate.metaPct)}`)}${kpi("Preenchimento no prazo", pc(k.fillRateNoPrazo))}${kpi("Satisfação (CSAT)", k.csat === null ? "—" : `${num(k.csat, 2)} ★`, `${p.csat.total} avaliações`)}${kpi("NPS", k.nps === null ? "—" : String(k.nps), `${p.nps.respostas} respostas`)}${kpi("Pontualidade", pc(k.pontualidade), `tolerância ${p.pontualidade.tolMin} min`)}${kpi("Economia estimada", brl(k.economiaCentavos), "vs. contratados fixos")}</div></section>
<section><h2>Atendimento das missões</h2><p>${p.fillRate.encerradas} missões encerradas · <b>${p.fillRate.concluidas}</b> concluídas · ${p.fillRate.semPromotor} sem promotor · ${p.fillRate.faltaPromotor} aceitas e não executadas.</p>${svgBarras(p.fillRate.serie.slice(-14).map((s) => ({ r: dataBR(s.dia), v: s.fillRate })), 100, "#4169e1")}</section>
<section><h2>Desempenho por setor</h2>${tabela(["Setor", "Missões", "Fill rate", "CSAT", "Pontualidade"], p.setores.map((s) => [s.setor, s.missoes, pc(s.fillRate), num(s.csat, 2), pc(s.pontualidade)]))}</section>
<section><h2>Economia gerada (estimativa)</h2>${tabela(["Mês", "Gasto on-demand", "Equivalente com contratados fixos", "Economia"], p.roi.meses.map((m) => [m.mes + (m.parcial ? " (parcial)" : ""), brl(m.onDemandCentavos), brl(m.fixoEquivalenteCentavos), brl(m.economiaCentavos)]))}
<small>Premissas: custo mensal por contratado ${brl(p.roi.premissas.custoMensalFixoCentavos)}, jornada ${p.roi.premissas.horasSemanaFixo} h/sem, ocupação produtiva ${p.roi.premissas.ocupacaoFixaPct}%. Dimensiona o time fixo pela semana de pico de cada loja.</small></section>
<section><h2>Reposição e ruptura evitada</h2><p><b>${p.ruptura.evitadasTotal}</b> rupturas evitadas (${p.ruptura.evitadasConfirmadas} confirmadas por chamado relâmpago + ${p.ruptura.evitadasEstimadas} estimadas) · ${num(p.ruptura.horas)} h de reposição · ~${p.ruptura.itensRepostosEst.toLocaleString("pt-BR")} itens repostos (estimativa).</p></section>
${d.audiencia === "interno" ? `<section><h2>Contas-chave</h2>${tabela(["Conta", "Lojas", "Fill rate", "CSAT", "NPS", "Em churn"], d.contas.map((c) => [c.nome, c.lojas, pc(c.fillRate), num(c.csat, 2), c.nps === null ? "—" : c.nps, c.lojasEmChurn]))}</section>` : d.contas[0] ? `<section><h2>Lojas da rede</h2>${tabela(["Loja", "Missões", "Fill rate", "CSAT", "Pontualidade"], d.contas[0].porLoja.map((l) => [l.nome, l.missoes, pc(l.fillRate), num(l.csat, 2), pc(l.pontualidade)]))}</section>` : ""}
</main></body></html>`;
}

// ───────────────────────── PPTX (pptxgenjs, carregado sob demanda) ─────────────────────────
const COR = { fundo: "0A1020", cartao: "0E1527", borda: "1C2745", ouro: "D4AF37", azul: "4169E1", texto: "E8ECF7", suave: "8FA0C8", verde: "34D399" };
export async function gerarPPTX(d: DadosRelatorio): Promise<Uint8Array> {
  const nome = "pptxgenjs", mod: any = await import(nome), Pptx = mod.default?.default || mod.default || mod, pres = new Pptx();
  pres.layout = "LAYOUT_WIDE"; pres.title = titulo(d);
  const p = d.painel, k = p.kpis;
  const novo = (t: string) => { const s = pres.addSlide(); s.background = { color: COR.fundo }; s.addText(t, { x: 0.5, y: 0.3, w: 12.3, h: 0.7, fontSize: 26, bold: true, color: COR.ouro, fontFace: "Calibri" }); s.addText("Abastece Já", { x: 11.2, y: 7.0, w: 2, h: 0.3, fontSize: 10, color: COR.suave, align: "right" }); return s; };
  const caixa = (s: any, x: number, y: number, w: number, rotulo: string, valor: string, sub = "") => {
    s.addShape(pres.ShapeType.roundRect, { x, y, w, h: 1.5, fill: { color: COR.cartao }, line: { color: COR.borda }, rectRadius: 0.1 });
    s.addText(valor, { x, y: y + 0.1, w, h: 0.7, fontSize: 28, bold: true, color: COR.azul, align: "center" }); s.addText(rotulo, { x, y: y + 0.8, w, h: 0.35, fontSize: 12, bold: true, color: COR.texto, align: "center" }); if (sub) s.addText(sub, { x, y: y + 1.1, w, h: 0.3, fontSize: 10, color: COR.suave, align: "center" });
  };
  const tab = (s: any, cab: string[], linhas: (string | number)[][], y = 1.3) => s.addTable([cab.map((c) => ({ text: c, options: { bold: true, color: COR.ouro, fill: { color: COR.cartao } } })), ...linhas.map((l) => l.map((c) => ({ text: String(c), options: { color: COR.texto } })))], { x: 0.5, y, w: 12.3, fontSize: 12, border: { type: "solid", color: COR.borda, pt: 0.5 }, fill: { color: COR.fundo } });

  let s = pres.addSlide(); s.background = { color: COR.fundo };
  s.addText("Abastece Já", { x: 0.8, y: 1.6, w: 11, h: 0.6, fontSize: 18, color: COR.suave }); s.addText("Resultados da parceria", { x: 0.8, y: 2.2, w: 11.5, h: 1, fontSize: 44, bold: true, color: COR.ouro });
  s.addText(p.escopo.rede, { x: 0.8, y: 3.4, w: 11.5, h: 0.6, fontSize: 24, color: COR.texto }); s.addText(`${dataBR(p.periodo.desde)} a ${dataBR(p.periodo.ate)}`, { x: 0.8, y: 4.1, w: 11, h: 0.5, fontSize: 16, color: COR.suave });

  s = novo("Resumo executivo");
  const cards: [string, string, string][] = [["Taxa de preenchimento", pc(k.fillRate), `meta ${pc(p.fillRate.metaPct)}`], ["No prazo", pc(k.fillRateNoPrazo), ""], ["Satisfação (CSAT)", k.csat === null ? "—" : `${num(k.csat, 2)} ★`, `${p.csat.total} avaliações`], ["NPS", k.nps === null ? "—" : String(k.nps), `${p.nps.respostas} respostas`], ["Pontualidade", pc(k.pontualidade), `tolerância ${p.pontualidade.tolMin} min`], ["Economia estimada", brl(k.economiaCentavos), "vs. contratados fixos"]];
  cards.forEach(([r, v, sub], i) => caixa(s, 0.5 + (i % 3) * 4.15, 1.4 + Math.floor(i / 3) * 1.9, 3.9, r, v, sub));
  s.addText(`${p.fillRate.concluidas} de ${p.fillRate.encerradas} missões encerradas foram concluídas; ${p.ruptura.evitadasTotal} rupturas de gôndola evitadas (estimativa).`, { x: 0.5, y: 5.4, w: 12.3, h: 0.8, fontSize: 16, color: COR.texto });

  s = novo("Taxa de preenchimento");
  const serie = p.fillRate.serie.slice(-30);
  if (serie.length) s.addChart(pres.charts.LINE, [{ name: "Fill rate %", labels: serie.map((x) => dataBR(x.dia).slice(0, 5)), values: serie.map((x) => x.fillRate ?? 0) }], { x: 0.5, y: 1.2, w: 8.2, h: 5.3, chartColors: [COR.azul], catAxisLabelColor: COR.suave, valAxisLabelColor: COR.suave, valAxisMaxVal: 100, valAxisMinVal: 0, showLegend: false, lineSize: 3 });
  caixa(s, 9, 1.3, 3.8, "Concluídas", String(p.fillRate.concluidas), `de ${p.fillRate.encerradas} encerradas`); caixa(s, 9, 3.0, 3.8, "Sem promotor", String(p.fillRate.semPromotor)); caixa(s, 9, 4.7, 3.8, "Aceitas e não executadas", String(p.fillRate.faltaPromotor));

  s = novo("Satisfação e pontualidade");
  s.addChart(pres.charts.BAR, [{ name: "Avaliações", labels: p.csat.distribuicao.map((x) => `${x.estrelas}★`), values: p.csat.distribuicao.map((x) => x.qtd) }], { x: 0.5, y: 1.2, w: 6.5, h: 4.6, barDir: "col", chartColors: [COR.ouro], catAxisLabelColor: COR.suave, valAxisLabelColor: COR.suave, showLegend: false });
  caixa(s, 7.5, 1.3, 2.6, "CSAT médio", k.csat === null ? "—" : num(k.csat, 2)); caixa(s, 10.3, 1.3, 2.6, "NPS", k.nps === null ? "—" : String(k.nps)); caixa(s, 7.5, 3.1, 2.6, "Pontualidade", pc(k.pontualidade)); caixa(s, 10.3, 3.1, 2.6, "Satisfeitos (4–5★)", pc(p.csat.csatPct));

  s = novo("Desempenho por setor");
  tab(s, ["Setor", "Missões", "Concluídas", "Fill rate", "CSAT", "Pontualidade"], p.setores.slice(0, 10).map((x) => [x.setor, x.missoes, x.concluidas, pc(x.fillRate), num(x.csat, 2), pc(x.pontualidade)]));

  s = novo("Economia gerada e ruptura evitada");
  s.addChart(pres.charts.BAR, [{ name: "On-demand (real)", labels: p.roi.meses.map((m) => m.mes), values: p.roi.meses.map((m) => m.onDemandCentavos / 100) }, { name: "Equivalente fixo (estimado)", labels: p.roi.meses.map((m) => m.mes), values: p.roi.meses.map((m) => m.fixoEquivalenteCentavos / 100) }], { x: 0.5, y: 1.2, w: 7.6, h: 4.6, barDir: "col", chartColors: [COR.azul, COR.suave], catAxisLabelColor: COR.suave, valAxisLabelColor: COR.suave, legendColor: COR.texto, showLegend: true, legendPos: "b" });
  caixa(s, 8.5, 1.3, 4.3, "Economia acumulada", brl(k.economiaCentavos)); caixa(s, 8.5, 3.1, 4.3, "Rupturas evitadas", String(p.ruptura.evitadasTotal), `${p.ruptura.evitadasConfirmadas} confirmadas`);
  s.addText(`Premissas da estimativa: ${brl(p.roi.premissas.custoMensalFixoCentavos)}/mês por contratado, ${p.roi.premissas.horasSemanaFixo} h/semana, ${p.roi.premissas.ocupacaoFixaPct}% produtivo; equipe fixa dimensionada pela semana de pico.`, { x: 0.5, y: 6.1, w: 12.3, h: 0.7, fontSize: 11, color: COR.suave });

  if (d.audiencia === "interno") { s = novo("Contas-chave e retenção"); tab(s, ["Conta", "Lojas", "Fill rate", "CSAT", "NPS", "Em churn"], d.contas.slice(0, 9).map((c) => [c.nome, c.lojas, pc(c.fillRate), num(c.csat, 2), c.nps === null ? "—" : c.nps, c.lojasEmChurn])); }
  else if (d.contas[0]?.porLoja.length) { s = novo("Lojas da rede"); tab(s, ["Loja", "Missões", "Fill rate", "CSAT", "Pontualidade"], d.contas[0].porLoja.slice(0, 10).map((l) => [l.nome, l.missoes, pc(l.fillRate), num(l.csat, 2), pc(l.pontualidade)])); }
  return (await pres.write({ outputType: "nodebuffer" })) as Uint8Array;
}
