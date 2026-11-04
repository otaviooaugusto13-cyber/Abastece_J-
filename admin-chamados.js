// Aba "Chamados" do painel administrativo: a fila dos departamentos ADM/Financeiro e Suporte.
// Os chamados chegam aqui já roteados pelo servidor (roteador.js) e a equipe é avisada por push/chat (despacho.js).
// O TI atende no próprio painel (/painel-ti); um chamado do TI nunca aparece nem abre aqui (a API devolve 404).
// A autorização é do SERVIDOR (rotas /admin/chamados*, papel admin); esta tela só consome a API. Nada de innerHTML com dado cru: tudo passa por esc().
import { chamarFuncao, consultar } from "./firebase.js";
import { esc, fmtDataHora } from "./core.js";

const $ = (id) => document.getElementById(id);
const enc = encodeURIComponent;
const ST = { aberto: ["Aberto", "b"], em_atendimento: ["Em atendimento", "y"], aguardando_usuario: ["Aguardando usuário", ""], resolvido: ["Resolvido", "g"], cancelado: ["Cancelado", "r"] };
const PRI = { critica: "Crítica", alta: "Alta", media: "Média", baixa: "Baixa" };
const SETOR = { ti: "TI", adm: "Administrativo / Financeiro", suporte: "Suporte" };
const COR_SETOR = { ti: "b", adm: "y", suporte: "g" };
const TRANSICOES = { aberto: ["em_atendimento", "cancelado"], em_atendimento: ["aguardando_usuario", "resolvido", "aberto", "cancelado"], aguardando_usuario: ["em_atendimento", "resolvido", "aberto", "cancelado"], resolvido: ["em_atendimento"], cancelado: [] };
const ABERTOS = ["aberto", "em_atendimento", "aguardando_usuario"];
const badge = (t, c = "") => `<span class="ax-badge ${c}">${esc(t)}</span>`;
const dt = (v) => (v ? fmtDataHora(v) || "—" : "—");
const td = (l, h) => `<td data-l="${esc(l)}">${h}</td>`;
const idade = (iso) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 60 ? `${m} min` : m < 2880 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`; };

/** deps: { toast, seguro, pedir } vindos de admin.js. Devolve { carregar, atualizarBadge, abrirPorLink }. */
export function iniciarChamados({ toast, seguro, pedir }) {
    const S = { visao: "abertos", cursor: null };

    /** Formulário simples em diálogo (select + texto); devolve os valores ou null se cancelar. Erros do servidor aparecem dentro do diálogo. */
    function formulario({ titulo, texto = "", campos, ok = "Confirmar", perigo = false }) {
        const d = $("ch-form");
        const ctl = (c) => c.tipo === "select"
            ? `<select class="ax-sel" name="${c.n}">${c.opcoes.map(([v, r]) => `<option value="${esc(v)}">${esc(r)}</option>`).join("")}</select>`
            : c.tipo === "checkbox" ? `<label class="ax-row"><input type="checkbox" name="${c.n}"> <span class="ax-sm">${esc(c.dica || "")}</span></label>`
            : `<textarea class="ax-inp" name="${c.n}" rows="3" maxlength="${c.max || 1000}"></textarea>`;
        d.innerHTML = `<form method="dialog" novalidate><h2>${esc(titulo)}</h2>${texto ? `<p class="ax-sm ax-mut ax-mt">${esc(texto)}</p>` : ""}
            ${campos.map((c) => `<div class="ax-mt"><label class="ax-lbl">${esc(c.label)}</label>${ctl(c)}</div>`).join("")}
            <p class="ax-erro ax-mt" id="ch-form-e" role="alert"></p>
            <div class="ax-row ax-mt" style="justify-content:flex-end"><button class="ax-btn" value="cancel" type="submit" formnovalidate>Cancelar</button><button class="ax-btn ${perigo ? "danger" : "pri"}" id="ch-form-ok" type="button">${esc(ok)}</button></div></form>`;
        const f = d.querySelector("form"), btn = $("ch-form-ok"), erro = $("ch-form-e");
        return new Promise((res) => {
            let valores = null;
            btn.addEventListener("click", () => {
                const v = {}; for (const c of campos) { const el = f.elements[c.n]; v[c.n] = c.tipo === "checkbox" ? el.checked : String(el.value || "").trim(); if (c.req && !v[c.n]) { erro.textContent = `Preencha: ${c.label}.`; return; } if (c.min && v[c.n].length < c.min) { erro.textContent = `${c.label}: mínimo de ${c.min} caracteres.`; return; } }
                valores = v; d.close("ok");
            });
            d.addEventListener("close", () => res(d.returnValue === "ok" ? valores : null), { once: true });
            d.returnValue = ""; d.showModal(); f.querySelector("select,textarea")?.focus();
        });
    }

    // ---------- fila ----------
    const prazo = (c) => { const alvo = c.status === "aberto" ? c.slaAtendEm : c.status === "em_atendimento" ? c.slaResolEm : null; if (!alvo) return "—"; const ms = new Date(alvo).getTime() - Date.now(); const m = Math.round(Math.abs(ms) / 60000), txt = m < 60 ? `${m} min` : `${Math.round(m / 60)} h`; return ms < 0 ? `<span class="ch-late">atrasado ${esc(txt)}</span>` : `em ${esc(txt)}`; };
    const linha = (c) => `<tr class="ch-click" data-id="${esc(c.id)}">${td("Protocolo", esc(c.protocolo))}${td("Chamado", `<b>${esc(c.titulo)}</b><br>${badge(c.setor || SETOR[c.departamento] || "", COR_SETOR[c.departamento])}`)}${td("Prioridade", `<span class="ax-badge ch-pri-${esc(c.prioridade)}">${esc(PRI[c.prioridade] || c.prioridade)}</span>`)}${td("Status", badge(...(ST[c.status] || [c.status, ""])))}${td("Solicitante", esc(c.solicitante?.nome || "—"))}${td("Responsável", esc(c.atribuidoNome || "—"))}${td("Prazo", prazo(c))}${td("Aberto", `${esc(dt(c.criadoEm))}<br><span class="ax-xs ax-mut">há ${esc(idade(c.criadoEm))}</span>`)}</tr>`;
    async function carregar(reiniciar = true) {
        for (const b of document.querySelectorAll("#ch-visao .ax-pill")) b.classList.toggle("sel", b.dataset.v === S.visao);
        const q = new URLSearchParams({ visao: S.visao, limite: "100" });
        for (const [k, id] of [["departamento", "ch-dep"], ["prioridade", "ch-pri"], ["q", "ch-busca"]]) if ($(id).value.trim()) q.set(k, $(id).value.trim());
        if (!reiniciar && S.cursor) q.set("cursor", S.cursor);
        const r = await consultar(`admin/chamados?${q}`); S.cursor = r.proximo;
        const html = r.itens.map(linha).join("");
        $("ch-body").innerHTML = reiniciar ? (html || `<tr><td colspan="8" class="ax-empty">Nenhum chamado neste filtro. 🎉</td></tr>`) : $("ch-body").innerHTML + html;
        $("ch-mais").hidden = !r.proximo; $("ch-nota").textContent = r.truncado && S.visao === "abertos" ? "Mostrando os 100 mais urgentes. Use os filtros para refinar." : "";
        atualizarBadge();
    }
    /** Número de chamados abertos de ADM + Suporte no menu lateral. Silencioso: um erro aqui nunca atrapalha o painel. */
    async function atualizarBadge() {
        try { const r = await consultar("admin/chamados/resumo"), n = (r.adm?.totalAbertos || 0) + (r.suporte?.totalAbertos || 0), e = $("n-cham"); if (e) { e.hidden = !n; e.textContent = n; } } catch (e) { /* sem badge */ }
    }

    // ---------- detalhe e ações ----------
    async function detalhe(id) {
        const c = await consultar(`admin/chamados/${enc(id)}`), d = $("ch-dlg"), aberto = ABERTOS.includes(c.status), l = c.logsTecnicos || {};
        const ev = c.eventos.map((e) => { const txt = e.tipo === "criado" ? "Chamado aberto" : e.tipo === "assumido" ? "Assumiu o chamado" : e.tipo === "status" ? `${ST[e.de]?.[0] || e.de} → ${ST[e.para]?.[0] || e.para}` : e.tipo === "comentario" ? "" : e.texto;
            return `<div class="ch-ev${e.interno ? " int" : ""}"><div class="m">${esc(dt(e.em))} · ${esc(e.autor || "—")}${e.interno ? " · nota interna" : ""}</div>${txt ? `<div>${esc(txt)}</div>` : ""}${e.texto && !["atribuido", "prioridade", "transferido", "notificacao"].includes(e.tipo) ? `<div>${esc(e.texto)}</div>` : ""}${["transferido", "notificacao"].includes(e.tipo) ? `<div>${esc(e.texto)}</div>` : ""}</div>`; }).join("");
        const tecnico = [l.nome && `${l.nome}: ${l.mensagem || ""}`, l.rota && `Rota: ${l.rota}`, l.status && `Status HTTP: ${l.status}`, l.codigo && `Código: ${l.codigo}`, l.tela && `Tela: ${l.tela}`].filter(Boolean).join("\n");
        d.innerHTML = `<form method="dialog"><div class="ax-row"><h2 class="ax-grow">${esc(c.protocolo)} · ${esc(c.titulo)}</h2><button class="ax-btn sm" value="x" aria-label="Fechar">✕</button></div>
            <div class="ax-row ax-mt">${badge(c.setor || SETOR[c.departamento], COR_SETOR[c.departamento])} <span class="ax-badge ch-pri-${esc(c.prioridade)}">${esc(PRI[c.prioridade] || c.prioridade)}</span> ${badge(...(ST[c.status] || [c.status, ""]))}${c.transferencias ? ` ${badge(`transferido ${c.transferencias}x`, "y")}` : ""}</div>
            ${c.classificacao ? `<p class="ax-sm ax-mt"><b>Por que veio para este setor:</b> ${esc(c.classificacao.motivo)} <span class="ax-mut">(confiança ${esc(c.classificacao.confianca)}${c.classificacao.automatica === false ? "" : ", roteamento automático"})</span></p>` : ""}
            <div class="ax-split ax-mt ax-sm"><div><span class="ax-mut">Solicitante</span><br>${esc(c.solicitante?.nome || "—")} <span class="ax-mut">(${esc(c.solicitante?.tipo || "")})</span></div><div><span class="ax-mut">Responsável</span><br>${esc(c.atribuidoNome || "—")}</div><div><span class="ax-mut">Aberto em</span><br>${esc(dt(c.criadoEm))}</div></div>
            ${tecnico ? `<h3 class="ax-mt">O que aconteceu</h3><div class="ch-pre ax-mt">${esc(tecnico)}</div>` : ""}
            ${c.resolucao ? `<p class="ax-sm ax-mt"><b>Resolução:</b> ${esc(c.resolucao)}</p>` : ""}
            <h3 class="ax-mt">Linha do tempo</h3><div class="ch-tl ax-mt">${ev}</div><div class="ax-row ax-mt" id="ch-acoes"></div></form>`;
        const A = $("ch-acoes"), acao = async (rota, corpo) => { await chamarFuncao(`admin/chamados/${enc(id)}/${rota}`, corpo); return true; };
        const btn = (txt, fn, cls = "") => { const b = document.createElement("button"); b.type = "button"; b.className = "ax-btn sm " + cls; b.textContent = txt; b.addEventListener("click", seguro(async () => { if (await fn()) { d.close(); await carregar(true); } })); A.append(b); };
        if (aberto) btn("💬 Responder / comentar", async () => { const v = await formulario({ titulo: "Comentar", ok: "Enviar", campos: [{ n: "texto", label: "Mensagem", tipo: "textarea", req: true, max: 1000 }, { n: "publico", label: "Visibilidade", tipo: "checkbox", dica: "Visível ao solicitante (desmarcado = nota interna)" }] }); return v && acao("comentarios", { texto: v.texto, interno: !v.publico }); });
        if (c.status === "aberto" || (c.status === "em_atendimento" && !c.atribuidoUid)) btn("✋ Assumir", () => acao("assumir", {}), "pri");
        for (const p of (TRANSICOES[c.status] || []).filter((x) => x !== "em_atendimento" || c.status !== "aberto")) {
            const rot = { aguardando_usuario: "Aguardar usuário", resolvido: "Resolver", aberto: "Devolver à fila", cancelado: "Cancelar", em_atendimento: c.status === "resolvido" ? "Reabrir" : "Retomar" }[p], exige = p === "resolvido" || p === "cancelado";
            btn(rot, async () => { const v = await formulario({ titulo: rot, ok: rot, perigo: p === "cancelado", campos: [{ n: "nota", label: p === "resolvido" ? "O que foi feito (o solicitante verá)" : exige ? "Motivo" : "Nota (opcional)", tipo: "textarea", req: exige, min: exige ? 5 : 0, max: 1000 }] }); return v && acao("status", { status: p, nota: v.nota }); }, p === "cancelado" ? "danger" : p === "resolvido" ? "ok" : "");
        }
        if (aberto) btn("↔ Transferir de setor", async () => { const v = await formulario({ titulo: "Transferir de setor", texto: "Use quando o roteamento automático errou. O protocolo continua o mesmo e o chamado volta para a fila do novo setor.", ok: "Transferir", campos: [{ n: "departamento", label: "Para", tipo: "select", opcoes: Object.entries(SETOR).filter(([k]) => k !== c.departamento) }, { n: "motivo", label: "Motivo", tipo: "textarea", req: true, min: 5, max: 500 }] }); return v && acao("transferir", v); });
        d.showModal();
    }

    // ---------- eventos ----------
    $("ch-visao").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) { S.visao = b.dataset.v; seguro(() => carregar(true))(); } });
    for (const id of ["ch-dep", "ch-pri"]) $(id).addEventListener("change", seguro(() => carregar(true)));
    let tb; $("ch-busca").addEventListener("input", () => { clearTimeout(tb); tb = setTimeout(seguro(() => carregar(true)), 350); });
    $("ch-atualizar").addEventListener("click", seguro(() => carregar(true))); $("ch-mais").addEventListener("click", seguro(() => carregar(false)));
    $("ch-body").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-id]"); if (tr) seguro(() => detalhe(tr.dataset.id))(); });
    setInterval(() => { if (!document.hidden) atualizarBadge(); }, 60_000);

    /** Link vindo do aviso (push/chat): `?chamado=ID#chamados` abre direto o detalhe. */
    function abrirPorLink() { const id = new URLSearchParams(location.search).get("chamado"); if (id && /^[\w-]{4,64}$/.test(id)) { history.replaceState(null, "", location.pathname + location.hash); seguro(() => detalhe(id))(); } }
    return { carregar, atualizarBadge, abrirPorLink };
}
