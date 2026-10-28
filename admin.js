// Painel administrativo. A autorização é do SERVIDOR (claim role=admin); esta tela só consome a API e lê o Firestore
// com as permissões que as regras já concedem ao admin (profissionais, contratantes, solicitacoes).
import { signInWithPopup, signOut, onAuthStateChanged, reauthenticateWithPopup } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { collection, query, where, orderBy, limit, onSnapshot, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db, googleProvider, chamarFuncao, consultar, baixarCSVProtegido, papelAtual, renovarToken } from "./firebase.js";
import { brl, esc, fmtDataHora, fmtData, hojeLocal } from "./core.js";
import { VALOR_DIARIA_CENTAVOS, COMISSAO_PLATAFORMA_CENTAVOS, REPASSE_PROFISSIONAL_CENTAVOS, TAXA_FIXA_CENTAVOS, HORAS_MIN_TURNO, HORAS_MAX_TURNO, MAX_VEZES_SEMANA_LOJA } from "./config.js";

const $ = (id) => document.getElementById(id);
const dt = (v) => fmtDataHora(v) || "—";
const msg = (t = "") => { $("ax-msg").textContent = t; };
const S = { vista: "visao", ut: "promotor", us: "pendente", fa: "pag", missoes: [], lojas: [], pend: [], promo: [], mods: [], aud: [], pagos: [], conc: [], ativos: null, totLojas: null };
const unsubs = [];
const TITULOS = { visao: "Visão geral", usuarios: "Usuários", missoes: "Missões", financeiro: "Financeiro", treino: "Treinamento", moderacao: "Moderação e logs", config: "Configurações" };
const ST = { aberta: ["Aguardando", "b"], aceita: ["Aceita", "y"], paga: ["Paga", "g"], concluida: ["Concluída", "g"], cancelada: ["Cancelada", "r"] };
const badge = (s) => { const [t, c] = ST[s] || [s || "—", ""]; return `<span class="ax-badge ${c}">${esc(t)}</span>`; };
const td = (l, h, c = "") => `<td data-l="${esc(l)}"${c ? ` class="${c}"` : ""}>${h}</td>`;
const vazio = (n, t) => `<tr><td colspan="${n}" class="ax-empty">${esc(t)}</td></tr>`;
const tsDate = (t) => (t?.toDate ? t.toDate() : t ? new Date(t) : null);
const hm = (t) => tsDate(t)?.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) || "";
const presenca = (m) => (m.checkoutEm ? `<span class="ax-ok">✓ ${hm(m.checkinEm)}–${hm(m.checkoutEm)}</span>${(m.divergencias || []).length ? ' <span class="ax-badge r">divergência</span>' : ""}` : m.checkinEm ? `<span class="ax-warn">desde ${hm(m.checkinEm)}</span>` : "—");
const buscaOk = (campos, q) => !q || campos.some((c) => String(c ?? "").toLowerCase().includes(q));

// ---------- toasts, erros, diálogos ----------
function toast(texto, tipo = "", ms = 7000, destino = "") {
    const el = document.createElement("div"); el.className = "ax-toast " + tipo;
    el.innerHTML = `<span class="t">${esc(texto)}</span><button aria-label="Fechar">×</button>`;
    el.querySelector("button").addEventListener("click", (e) => { e.stopPropagation(); el.remove(); });
    if (destino) { el.querySelector(".t").style.cursor = "pointer"; el.querySelector(".t").addEventListener("click", () => { el.remove(); ir(destino); }); }
    $("ax-toasts").append(el); if (ms) setTimeout(() => el.remove(), ms);
}
const seguro = (fn) => async (...a) => { msg(); try { await fn(...a); } catch (e) { console.error(e); msg(e.message || "Erro"); toast(e.message || "Erro inesperado.", "err"); } };
/** Ações de dinheiro exigem login recente: confirma com o Google e repete uma vez. */
async function sensivel(fn) {
    try { return await fn(); } catch (e) {
        if (e.code !== "reautenticar") throw e;
        await reauthenticateWithPopup(auth.currentUser, googleProvider); await renovarToken(); return fn();
    }
}
/** Substitui prompt()/confirm(): retorna true/texto ao confirmar, null ao cancelar. */
function pedir({ titulo, texto = "", rotulo = "", min = 0, ok = "Confirmar", perigo = false }) {
    const d = $("ax-dlg"), i = $("ax-dlg-i"), b = $("ax-dlg-ok");
    $("ax-dlg-t").textContent = titulo; $("ax-dlg-p").textContent = texto; $("ax-dlg-c").hidden = !rotulo; $("ax-dlg-l").textContent = rotulo;
    i.value = ""; $("ax-dlg-e").textContent = ""; b.textContent = ok; b.className = "ax-btn " + (perigo ? "danger" : "pri");
    return new Promise((res) => {
        const validar = (ev) => { if (rotulo && i.value.trim().length < min) { ev.preventDefault(); $("ax-dlg-e").textContent = `Informe pelo menos ${min} caracteres.`; } };
        b.addEventListener("click", validar);
        d.addEventListener("close", () => { b.removeEventListener("click", validar); res(d.returnValue === "ok" ? (rotulo ? i.value.trim() : true) : null); }, { once: true });
        d.returnValue = ""; d.showModal();
    });
}

// ---------- exportação client-side (CSV pt-BR p/ Excel; defesa contra formula injection) ----------
const cel = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function baixarLinhas(nome, cab, linhas) {
    if (!linhas.length) return toast("Nada para exportar com estes filtros.", "err");
    const blob = new Blob(["\uFEFF" + [cab, ...linhas].map((l) => l.map(cel).join(";")).join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `abastece-ja-${nome}-${hojeLocal()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const reais = (c) => ((Number(c) || 0) / 100).toFixed(2).replace(".", ",");

// ---------- login / sessão ----------
$("ax-entrar").addEventListener("click", () => signInWithPopup(auth, googleProvider).catch(() => ($("ax-login-erro").textContent = "Falha no login.")));
$("ax-sair").addEventListener("click", () => signOut(auth));
onAuthStateChanged(auth, async (u) => {
    unsubs.splice(0).forEach((f) => f());
    $("ax-app").hidden = true; $("ax-login").hidden = false;
    if (!u) return;
    if ((await papelAtual()) !== "admin") { $("ax-login-erro").textContent = "Esta conta não tem permissão de administrador."; await signOut(auth); return; }
    $("ax-login").hidden = true; $("ax-app").hidden = false; $("ax-quem").textContent = $("ax-quem2").textContent = u.email;
    ouvir(); abrir(location.hash.slice(1) in TITULOS ? location.hash.slice(1) : "visao");
    seguro(kpiContagens)(); seguro(kpiVolume)(); seguro(carregarAviso)();
});

// ---------- navegação (drawer no mobile) ----------
const menu = (o) => { $("ax-side").classList.toggle("open", o); $("ax-veil").hidden = !o; $("ax-burger").setAttribute("aria-expanded", String(o)); document.body.style.overflow = o ? "hidden" : ""; };
$("ax-burger").addEventListener("click", () => menu(!$("ax-side").classList.contains("open")));
$("ax-veil").addEventListener("click", () => menu(false));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") menu(false); });
const CARGA = { visao: () => renderVisao(), usuarios: () => carregarUsuarios(), missoes: () => renderMissoes(), financeiro: () => finAba(S.fa), treino: () => carregarModulos(), moderacao: () => { renderAlertas(); return carregarAuditoria(); }, config: () => carregarConfig() };
function ir(v) { if (location.hash === "#" + v) abrir(v); else location.hash = v; }
function abrir(v) {
    if (!(v in TITULOS)) v = "visao";
    S.vista = v; menu(false); $("ax-titulo").textContent = TITULOS[v]; document.title = `${TITULOS[v]} — Admin Abastece Já`;
    for (const k of Object.keys(TITULOS)) $("v-" + k).hidden = k !== v;
    for (const b of document.querySelectorAll("#ax-nav .ax-nav")) b.classList.toggle("sel", b.dataset.v === v);
    seguro(CARGA[v])();
}
window.addEventListener("hashchange", () => { if (!$("ax-app").hidden) abrir(location.hash.slice(1)); });
$("ax-nav").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) ir(b.dataset.v); });
$("ax-sino").addEventListener("click", () => ir(S.pend.length ? "usuarios" : "moderacao"));
document.addEventListener("click", (e) => { const b = e.target.closest("[data-ir]"); if (b) ir(b.dataset.ir); });
document.addEventListener("click", seguro(async (e) => { const b = e.target.closest("[data-csv]"); if (b) await baixarCSVProtegido(`admin/exportar/${b.dataset.csv}.csv`, `abastece-ja-${b.dataset.csv}.csv`); }));

// ---------- tempo real (Firestore) ----------
function ouvir() {
    const escutar = (q, fn) => { let pronto = false; unsubs.push(onSnapshot(q, (s) => { fn(s, pronto); pronto = true; }, (e) => { console.error(e); msg("Tempo real indisponível: " + (e.code || e.message)); })); };
    escutar(query(collection(db, "profissionais"), where("status", "==", "pendente"), limit(200)), (s, p) => {
        S.pend = s.docs.map((d) => ({ uid: d.id, ...d.data() }));
        if (p) s.docChanges().forEach((c) => c.type === "added" && toast(`Novo merchandiser aguardando aprovação: ${c.doc.data().nome || "sem nome"}`, "new", 10000, "usuarios"));
        badges(); if (S.vista === "usuarios" && S.ut === "promotor" && S.us === "pendente") seguro(carregarUsuarios)();
    });
    escutar(query(collection(db, "contratantes"), orderBy("criadoEm", "desc"), limit(300)), (s, p) => {
        S.lojas = s.docs.map((d) => ({ uid: d.id, ...d.data() }));
        if (p) { s.docChanges().forEach((c) => c.type === "added" && toast(`Nova loja cadastrada: ${c.doc.data().razaoSocial || c.doc.data().nome || "sem nome"}`, "new", 10000, "usuarios")); seguro(kpiContagens)(); }
        if (S.vista === "usuarios" && S.ut === "loja") renderLojas();
    });
    escutar(query(collection(db, "solicitacoes"), orderBy("criadoEm", "desc"), limit(400)), (s) => {
        S.missoes = s.docs.map((d) => ({ id: d.id, ...d.data() }));
        badges(); if (S.vista === "visao") renderVisao(); if (S.vista === "missoes") renderMissoes(); if (S.vista === "moderacao") renderAlertas();
    });
}
function badges() {
    const n = S.pend.length, a = alertas().length;
    $("n-pend").hidden = !n; $("n-pend").textContent = n; $("n-alert").hidden = !a; $("n-alert").textContent = a;
    $("ax-sino-n").hidden = !(n + a); $("ax-sino-n").textContent = n + a > 99 ? "99+" : n + a;
}

// ---------- visão geral ----------
async function kpiContagens() {
    const [l, a] = await Promise.all([getCountFromServer(collection(db, "contratantes")), getCountFromServer(query(collection(db, "profissionais"), where("status", "==", "ativo")))]);
    S.totLojas = l.data().count; S.ativos = a.data().count; renderVisao();
}
async function kpiVolume() { S.pagos = await consultar("admin/pagamentos"); renderVisao(); }
function renderVisao() {
    const abertas = S.missoes.filter((m) => m.status === "aberta").length, reais_ = S.pagos.filter((p) => p.status === "aprovado" && !p.simulado);
    $("k-lojas").textContent = S.totLojas ?? "—"; $("k-lojas-s").textContent = S.lojas.length ? `${S.lojas.length} mais recentes carregadas` : "";
    $("k-ativos").textContent = S.ativos ?? "—"; $("k-ativos-s").textContent = `${S.pend.length} pendente(s) de aprovação`;
    $("k-abertas").textContent = abertas; $("k-abertas-s").textContent = `de ${S.missoes.length} missões recentes`;
    $("k-vol").textContent = brl(reais_.reduce((t, p) => t + (p.totalCentavos || 0), 0)); $("k-vol-s").textContent = `${reais_.length} pagamento(s) aprovado(s) · últimos 300`;
    const cont = {}; for (const m of S.missoes) cont[m.status] = (cont[m.status] || 0) + 1;
    const cor = { aberta: "var(--ax-blue)", aceita: "var(--ax-gold)", paga: "var(--ax-green)", concluida: "#2fb37d", cancelada: "var(--ax-red)" }, tot = S.missoes.length || 1;
    $("g-status").innerHTML = Object.keys(ST).filter((k) => cont[k]).map((k) => `<div style="width:${(cont[k] / tot) * 100}%;background:${cor[k]}" title="${esc(ST[k][0])}: ${cont[k]}"></div>`).join("");
    $("g-status-l").innerHTML = Object.keys(ST).map((k) => `<span><i style="background:${cor[k]}"></i>${esc(ST[k][0])}: ${cont[k] || 0}</span>`).join("");
    const dias = [], hoje = new Date(); for (let i = 13; i >= 0; i--) { const d = new Date(hoje); d.setDate(d.getDate() - i); dias.push(d.toLocaleDateString("sv-SE")); }
    const soma = Object.fromEntries(dias.map((d) => [d, 0])); for (const p of reais_) { const d = p.pagoEm ? new Date(p.pagoEm).toLocaleDateString("sv-SE") : ""; if (d in soma) soma[d] += p.totalCentavos || 0; }
    const max = Math.max(1, ...Object.values(soma));
    $("g-vol").innerHTML = dias.map((d) => `<div title="${esc(fmtData(d))}: ${esc(brl(soma[d]))}"><b style="height:${(soma[d] / max) * 100}%"></b><span>${esc(d.slice(8))}</span></div>`).join("");
    const al = alertas();
    $("v-resumo").innerHTML = (S.pend.length ? `<div class="ax-alert w"><span>⏳</span><div>${S.pend.length} cadastro(s) de merchandiser aguardando aprovação.</div></div>` : "") + al.slice(0, 3).map(htmlAlerta).join("") || '<p class="ax-mut ax-sm">Nada exigindo atenção agora.</p>';
}

// ---------- usuários ----------
const filtrosUsuarios = () => { const q = $("u-busca").value.trim().toLowerCase(); return q; };
async function carregarUsuarios() {
    for (const b of document.querySelectorAll("#u-tipo .ax-pill")) b.classList.toggle("sel", b.dataset.t === S.ut);
    for (const b of document.querySelectorAll("#u-status .ax-pill")) b.classList.toggle("sel", b.dataset.s === S.us);
    $("u-status").hidden = S.ut === "loja";
    if (S.ut === "loja") return renderLojas();
    $("u-nota").textContent = "";
    S.promo = await consultar(`admin/promotores?status=${encodeURIComponent(S.us)}`); renderPromotores();
}
const listaPromotores = () => { const q = filtrosUsuarios(); return S.promo.filter((p) => buscaOk([p.nome, p.cidade, p.uid], q)); };
function renderPromotores() {
    const l = listaPromotores();
    $("u-head").innerHTML = "<tr><th>Nome</th><th>Cidade</th><th>Treino</th><th>Nota</th><th>Criado</th><th></th></tr>";
    $("u-body").innerHTML = l.length ? l.map((p) => `<tr>${td("Nome", esc(p.nome))}${td("Cidade", esc(p.cidade || "—"))}${td("Treino", p.treinamentoOk ? '<span class="ax-ok">✓</span>' : "—")}${td("Nota", p.ratingMedia ? esc(p.ratingMedia) : "—")}${td("Criado", dt(p.criadoEm))}${td("", `<div class="ax-acts">
        <button class="ax-btn sm" data-acao="ficha" data-uid="${esc(p.uid)}">Perfil</button>
        ${p.status !== "ativo" ? `<button class="ax-btn sm ok" data-acao="aprovar" data-uid="${esc(p.uid)}">${p.status === "bloqueado" ? "Reativar" : "Aprovar"}</button>` : ""}
        ${p.status !== "bloqueado" ? `<button class="ax-btn sm danger" data-acao="bloquear" data-uid="${esc(p.uid)}">Bloquear</button>` : ""}</div>`, "acts")}</tr>`).join("") : vazio(6, "Nenhum cadastro neste filtro.");
}
function renderLojas() {
    const q = filtrosUsuarios(), l = S.lojas.filter((x) => buscaOk([x.razaoSocial, x.nome, x.email, x.documento], q));
    $("u-nota").textContent = "Lojas entram ativas no cadastro; o backend ainda não tem status de aprovação/suspensão de loja (ver observações da entrega).";
    $("u-head").innerHTML = "<tr><th>Loja</th><th>Ramo</th><th>E-mail</th><th>Cadastro</th><th></th></tr>";
    $("u-body").innerHTML = l.length ? l.map((x) => `<tr>${td("Loja", esc(x.razaoSocial || x.nome || "—"))}${td("Ramo", esc(x.ramo || "—"))}${td("E-mail", esc(x.email || "—"))}${td("Cadastro", dt(x.criadoEm))}${td("", `<button class="ax-btn sm" data-acao="ficha-loja" data-uid="${esc(x.uid)}">Perfil</button>`, "acts")}</tr>`).join("") : vazio(5, "Nenhuma loja encontrada.");
}
$("u-tipo").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) { S.ut = b.dataset.t; seguro(carregarUsuarios)(); } });
$("u-status").addEventListener("click", (e) => { const b = e.target.closest("[data-s]"); if (b) { S.us = b.dataset.s; seguro(carregarUsuarios)(); } });
$("u-busca").addEventListener("input", () => (S.ut === "loja" ? renderLojas() : renderPromotores()));
$("u-atualizar").addEventListener("click", seguro(carregarUsuarios));
$("u-csv").addEventListener("click", () => {
    if (S.ut === "loja") baixarLinhas("lojas", ["UID", "Razão social", "Ramo", "E-mail", "Telefone", "Endereço", "Cadastro"], S.lojas.map((x) => [x.uid, x.razaoSocial || x.nome, x.ramo, x.email, x.telefone, x.endereco, dt(x.criadoEm)]));
    else baixarLinhas(`merchandisers-${S.us}`, ["UID", "Nome", "Cidade", "Status", "Treinamento", "Nota", "Criado"], listaPromotores().map((p) => [p.uid, p.nome, p.cidade, p.status, p.treinamentoOk ? "sim" : "não", p.ratingMedia, dt(p.criadoEm)]));
});
const fichaAbrir = (html, acoes) => { $("ax-ficha-c").innerHTML = html; $("ax-ficha-a").innerHTML = acoes + '<button class="ax-btn" data-acao="fechar">Fechar</button>'; if (!$("ax-ficha").open) $("ax-ficha").showModal(); };
async function abrirFicha(uid) {
    const p = await consultar(`admin/promotores/${encodeURIComponent(uid)}`), r = p.responsavel, t = p.habilitacao || {};
    fichaAbrir(`<h2>${esc(p.nome)} <span class="ax-badge">${esc(p.status)}</span> ${p.menor ? '<span class="ax-badge r">MENOR (16–17)</span>' : ""}</h2>
        <dl class="ax-dl"><dt>E-mail</dt><dd>${esc(p.email)}</dd><dt>Telefone</dt><dd>${esc(p.telefone)}</dd><dt>CPF</dt><dd>${esc(p.cpfMascarado)}</dd><dt>Cidade</dt><dd>${esc(p.cidade || "—")}</dd><dt>Nascimento</dt><dd>${esc(p.nascimento || "—")} (${esc(p.idade ?? "?")} anos)</dd>
        <dt>Treinamento</dt><dd>${esc(p.treinamento?.concluidos)}/${esc(p.treinamento?.total)}</dd><dt>Pendências</dt><dd>${esc((t.pendencias || []).join(", ") || "nenhuma")}</dd></dl>
        ${r ? `<div class="ax-alert w"><div><strong>Responsável legal:</strong> ${esc(r.nome)} (${esc(r.parentesco)}) · CPF ${esc(r.cpfMascarado)} · Tel. ${esc(r.telefone)}<br><span class="ax-xs ax-mut">Autorização registrada em ${esc(dt(p.autorizacaoEm))}. Confirme com o responsável antes de aprovar.</span></div></div>` : p.menor ? '<p class="ax-bad">Falta autorização do responsável — não é possível aprovar.</p>' : ""}`,
        `<button class="ax-btn ok" data-acao="aprovar" data-uid="${esc(uid)}">Aprovar</button><button class="ax-btn" data-acao="analise" data-uid="${esc(uid)}">Voltar p/ análise</button><button class="ax-btn danger" data-acao="bloquear" data-uid="${esc(uid)}">Bloquear</button>`);
}
function abrirFichaLoja(uid) {
    const x = S.lojas.find((l) => l.uid === uid); if (!x) return;
    fichaAbrir(`<h2>${esc(x.razaoSocial || x.nome || "Loja")}</h2><dl class="ax-dl"><dt>Documento</dt><dd>${esc(x.documento || "—")}</dd><dt>Ramo</dt><dd>${esc(x.ramo || "—")}</dd><dt>E-mail</dt><dd>${esc(x.email || "—")}</dd><dt>Telefone</dt><dd>${esc(x.telefone || "—")}</dd><dt>Endereço</dt><dd>${esc(x.endereco || "—")}</dd><dt>Cadastro</dt><dd>${esc(dt(x.criadoEm))}</dd><dt>UID</dt><dd>${esc(x.uid)}</dd></dl>
        <p class="ax-xs ax-mut">Missões desta loja: ${S.missoes.filter((m) => m.uid === uid).length} (entre as 400 mais recentes).</p>`, "");
}
async function mudarStatus(uid, novo) {
    let motivo = "";
    if (novo === "ativo") { if (!(await pedir({ titulo: "Aprovar cadastro?", texto: "O servidor confere idade e autorização do responsável antes de aprovar.", ok: "Aprovar" }))) return; }
    else { motivo = await pedir({ titulo: novo === "bloqueado" ? "Bloquear usuário" : "Voltar para análise", texto: novo === "bloqueado" ? "As sessões do usuário serão derrubadas. O motivo fica na auditoria." : "O motivo fica na auditoria.", rotulo: "Motivo", min: 3, ok: "Confirmar", perigo: novo === "bloqueado" }); if (!motivo) return; }
    await chamarFuncao(`admin/promotores/${encodeURIComponent(uid)}/status`, { status: novo, motivo });
    toast("Status atualizado.", "ok"); if ($("ax-ficha").open) $("ax-ficha").close(); await carregarUsuarios(); seguro(kpiContagens)();
}
document.addEventListener("click", seguro(async (e) => {
    const b = e.target.closest("[data-acao]"); if (!b) return; const uid = b.dataset.uid;
    switch (b.dataset.acao) {
        case "ficha": return abrirFicha(uid);
        case "ficha-loja": return abrirFichaLoja(uid);
        case "aprovar": return mudarStatus(uid, "ativo");
        case "analise": return mudarStatus(uid, "pendente");
        case "bloquear": return mudarStatus(uid, "bloqueado");
        case "fechar": return $("ax-ficha").close();
    }
}));

// ---------- missões ----------
const listaMissoes = () => {
    const st = $("m-status").value, q = $("m-busca").value.trim().toLowerCase(), de = $("m-de").value, ate = $("m-ate").value;
    return S.missoes.filter((m) => (!st || m.status === st) && (!de || m.data >= de) && (!ate || m.data <= ate) && buscaOk([m.loja, m.promotorNome, m.foco], q));
};
function renderMissoes() {
    const l = listaMissoes();
    $("m-nota").textContent = `${l.length} de ${S.missoes.length} missões (as 400 mais recentes, atualizadas em tempo real).`;
    $("m-body").innerHTML = l.length ? l.map((m) => `<tr>${td("Data", esc(fmtData(m.data)))}${td("Horário", esc(m.horario || "—"))}${td("Loja", esc(m.loja || "—"))}${td("Foco", esc(m.foco || "—"))}${td("Repasse", esc(brl(m.valorPromotorCentavos)))}${td("Promotor", esc(m.promotorNome || "—"))}${td("Presença", presenca(m))}${td("Status", badge(m.status))}</tr>`).join("") : vazio(8, "Nenhuma missão neste filtro.");
}
for (const id of ["m-status", "m-busca", "m-de", "m-ate"]) $(id).addEventListener("input", renderMissoes);
$("m-csv").addEventListener("click", () => baixarLinhas("missoes", ["ID", "Data", "Entrada", "Saída", "Loja", "Foco", "Repasse (R$)", "Promotor", "Status", "Check-in", "Check-out", "Trabalhado (min)", "Divergências", "Criada em"], listaMissoes().map((m) => [m.id, m.data, m.entrada, m.saida, m.loja, m.foco, reais(m.valorPromotorCentavos), m.promotorNome, m.status, hm(m.checkinEm), hm(m.checkoutEm), m.trabalhadoMin ?? "", (m.divergencias || []).join(", "), dt(m.criadoEm)])));

// ---------- financeiro ----------
async function finAba(f) {
    S.fa = f; for (const b of document.querySelectorAll("#f-abas .ax-pill")) b.classList.toggle("sel", b.dataset.f === f);
    for (const k of ["pag", "saq", "conc"]) $("f-" + k).hidden = k !== f;
    if (f === "pag") await carregarPagamentos(); if (f === "saq") await carregarSaques();
}
$("f-abas").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (b) seguro(finAba)(b.dataset.f); });
async function carregarPagamentos() {
    S.pagos = await consultar("admin/pagamentos");
    $("f-pag-b").innerHTML = S.pagos.length ? S.pagos.map((p) => `<tr>${td("Pedido", `${esc(p.id)}${p.simulado ? ' <span class="ax-badge">teste</span>' : ""}${p.estornoParcialCentavos ? ' <span class="ax-badge r">estorno parcial</span>' : ""}`)}${td("Status", esc(p.status))}${td("Total", esc(brl(p.totalCentavos)))}${td("Repasse", esc(brl(p.repasseCentavos)))}${td("Comissão", esc(brl(p.comissaoCentavos)))}${td("Pago em", dt(p.pagoEm))}${td("", p.status === "aprovado" ? `<button class="ax-btn sm danger" data-estornar="${esc(p.id)}">Estornar</button>` : "", "acts")}</tr>`).join("") : vazio(7, "Sem pagamentos.");
    renderVisao();
}
async function carregarSaques() {
    const l = await consultar(`admin/saques?status=${encodeURIComponent($("f-saq-st").value)}`);
    $("f-saq-b").innerHTML = l.length ? l.map((s) => `<tr>${td("Quando", dt(s.em))}${td("Profissional", esc(s.uid))}${td("Valor", esc(brl(s.valorCentavos)))}${td("Pix", s.pix ? `${esc(s.pix.tipo)}: <code>${esc(s.pix.chave)}</code>` : esc(s.comprovante || "—"))}${td("", s.status === "solicitado" ? `<div class="ax-acts"><button class="ax-btn sm ok" data-pagar="${esc(s.id)}">Marcar pago</button><button class="ax-btn sm danger" data-rejeitar="${esc(s.id)}">Rejeitar</button></div>` : "", "acts")}</tr>`).join("") : vazio(5, "Nada aqui.");
}
$("f-saq-st").addEventListener("change", seguro(carregarSaques));
$("f-liberar").addEventListener("click", seguro(async () => { const r = await chamarFuncao("admin/liberar-saldos", {}); toast(`${r.liberados} lançamento(s) liberado(s).`, "ok"); }));
document.addEventListener("click", seguro(async (e) => {
    const est = e.target.closest("[data-estornar]"), pg = e.target.closest("[data-pagar]"), rj = e.target.closest("[data-rejeitar]");
    if (est) {
        const motivo = await pedir({ titulo: "Estornar pagamento", texto: "Devolve o valor à loja no Mercado Pago e desfaz repasse e comissão. Será auditado.", rotulo: "Motivo do estorno", min: 5, ok: "Estornar", perigo: true }); if (!motivo) return;
        const r = await sensivel(() => chamarFuncao(`admin/pedidos/${encodeURIComponent(est.dataset.estornar)}/estornar`, { motivo }));
        toast(r.saldoNegativo ? "Estornado. Atenção: a carteira do profissional ficou negativa." : "Estornado.", r.saldoNegativo ? "err" : "ok"); await carregarPagamentos();
    }
    if (pg) { const c = await pedir({ titulo: "Marcar saque como pago", rotulo: "ID/comprovante do Pix enviado", min: 3, ok: "Marcar pago" }); if (!c) return; await sensivel(() => chamarFuncao(`admin/saques/${encodeURIComponent(pg.dataset.pagar)}/pagar`, { comprovante: c })); toast("Saque pago.", "ok"); await carregarSaques(); }
    if (rj) { const m = await pedir({ titulo: "Rejeitar saque", texto: "O valor volta à carteira do profissional.", rotulo: "Motivo da rejeição", min: 3, ok: "Rejeitar", perigo: true }); if (!m) return; await sensivel(() => chamarFuncao(`admin/saques/${encodeURIComponent(rj.dataset.rejeitar)}/rejeitar`, { motivo: m })); toast("Saque rejeitado.", "ok"); await carregarSaques(); }
}));
async function conciliar(mp) {
    const r = await consultar(`admin/conciliacao${mp ? "?mp=1" : ""}`), t = r.totais;
    S.conc = r.divergencias.filter((d) => !d.informativo).map((d) => ({ n: "e", t: `Divergência financeira: ${d.tipo}`, d: d.descricao })); badges();
    $("c-res").innerHTML = `<h3 class="${r.ok ? "ax-ok" : "ax-bad"}">${r.ok ? "✓ Tudo conciliado" : "✗ Há divergências"}</h3>
        <p class="ax-sm ax-mt">Recebido líquido: <strong>${esc(brl(t.recebidoLiquidoCentavos))}</strong> · Saldos: <strong>${esc(brl(t.saldosCentavos))}</strong> · Saques em aberto: ${esc(brl(t.saquesSolicitadosCentavos))} · Saques pagos: ${esc(brl(t.saquesPagosCentavos))} · Diferença: <strong class="${t.diferencaCentavos ? "ax-bad" : "ax-ok"}">${esc(brl(t.diferencaCentavos))}</strong></p>
        <p class="ax-xs ax-mut">${esc(r.contagens.lancamentos)} lançamentos · ${esc(r.contagens.carteiras)} carteiras · ${esc(r.contagens.pagamentos)} pagamentos${mp ? ` · ${esc(r.contagens.conferidosMP)} conferidos no Mercado Pago` : ""}</p>
        ${r.divergencias.length ? `<div class="ax-tw ax-mt"><table class="ax-tbl"><thead><tr><th>Tipo</th><th>Ref.</th><th>Descrição</th><th>Esperado</th><th>Encontrado</th></tr></thead><tbody>${r.divergencias.map((d) => `<tr>${td("Tipo", esc(d.tipo) + (d.informativo ? " (info)" : ""))}${td("Ref.", esc(d.ref))}${td("Descrição", esc(d.descricao))}${td("Esperado", `<pre>${esc(JSON.stringify(d.esperado))}</pre>`)}${td("Encontrado", `<pre>${esc(JSON.stringify(d.encontrado))}</pre>`)}</tr>`).join("")}</tbody></table></div>` : ""}`;
    return r;
}
$("c-rodar").addEventListener("click", seguro(() => conciliar(false))); $("c-rodar-mp").addEventListener("click", seguro(() => conciliar(true)));

// ---------- treinamento ----------
async function carregarModulos() {
    S.mods = await consultar("admin/treinamento/modulos");
    $("t-body").innerHTML = S.mods.length ? S.mods.map((m) => `<tr>${td("Ordem", esc(m.ordem))}${td("Título", `${esc(m.titulo)}<br><span class="ax-xs ax-mut">${esc(m.id)}</span>`)}${td("Fonte", esc(m.provedor))}${td("Duração", Math.round(m.duracaoSeg / 60) + " min")}${td("Ativo", m.ativo ? '<span class="ax-ok">sim</span>' : "não")}${td("", `<button class="ax-btn sm" data-edit-mod="${esc(m.id)}">Editar</button>`, "acts")}</tr>`).join("") : `<tr><td colspan="6" class="ax-empty ax-bad">Nenhum módulo: ninguém consegue aceitar turnos até você publicar o treinamento.</td></tr>`;
}
const limparModulo = () => { for (const x of ["t-id", "t-ordem", "t-titulo", "t-ref", "t-dur"]) $(x).value = ""; $("t-ativo").checked = true; };
$("t-limpar").addEventListener("click", limparModulo);
document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-edit-mod]"); if (!b) return; const m = S.mods.find((x) => x.id === b.dataset.editMod); if (!m) return;
    $("t-id").value = m.id; $("t-ordem").value = m.ordem; $("t-titulo").value = m.titulo; $("t-prov").value = m.provedor; $("t-ref").value = m.videoRef; $("t-dur").value = m.duracaoSeg; $("t-ativo").checked = !!m.ativo;
    $("t-titulo").scrollIntoView({ behavior: "smooth", block: "center" });
});
$("t-salvar").addEventListener("click", seguro(async () => {
    const id = $("t-id").value.trim(), corpo = { ordem: Number($("t-ordem").value), titulo: $("t-titulo").value.trim(), provedor: $("t-prov").value, videoRef: $("t-ref").value.trim(), duracaoSeg: Number($("t-dur").value), ativo: $("t-ativo").checked };
    await chamarFuncao(id ? `admin/treinamento/modulos/${encodeURIComponent(id)}` : "admin/treinamento/modulos", corpo, id ? "PUT" : "POST");
    toast("Módulo salvo.", "ok"); limparModulo(); await carregarModulos();
}));

// ---------- moderação e auditoria ----------
/** Alertas derivados das missões em tempo real + divergências da última conciliação. (O app ainda não registra check-in/check-out.) */
function alertas() {
    const h = hojeLocal(), a = [], d = (m) => `${m.loja || "Loja"} · ${fmtData(m.data)} ${m.horario || ""} · ${m.promotorNome || "sem promotor"}`;
    const agora = new Date(), min = agora.getHours() * 60 + agora.getMinutes(), mi = (x) => { const [p, q] = String(x || "0:0").split(":").map(Number); return p * 60 + q; }, d7 = new Date(Date.now() - 7 * 864e5).toLocaleDateString("sv-SE");
    for (const m of S.missoes) {
        const andamento = m.status === "aceita" || m.status === "paga";
        if (andamento && m.data === h && !m.checkinEm && min > mi(m.entrada) + 15 && min <= mi(m.saida)) a.push({ n: "w", t: "Sem check-in (mais de 15 min de atraso)", d: d(m) });
        if (andamento && m.checkinEm && !m.checkoutEm && (m.data < h || (m.data === h && min > mi(m.saida) + 30))) a.push({ n: "w", t: "Sem check-out após o fim do turno", d: d(m) });
        if ((m.divergencias || []).length && m.data >= d7) a.push({ n: "w", t: `Divergência de presença: ${m.divergencias.join(", ")}`, d: d(m) });
        if (m.status === "aceita" && m.data < h) a.push({ n: "w", t: "Turno vencido sem pagamento/conclusão", d: d(m) });
        else if (m.status === "aberta" && m.data < h) a.push({ n: "", t: "Oferta expirada sem promotor", d: d(m) });
    }
    return [...S.conc, ...a];
}
const htmlAlerta = (x) => `<div class="ax-alert ${x.n}"><span>${x.n === "e" ? "⛔" : x.n === "w" ? "⚠️" : "ℹ️"}</span><div><strong>${esc(x.t)}</strong><br><span class="ax-sm ax-mut">${esc(x.d)}</span></div></div>`;
function renderAlertas() { const a = alertas(); $("a-lista").innerHTML = a.length ? a.slice(0, 60).map(htmlAlerta).join("") + (a.length > 60 ? `<p class="ax-xs ax-mut">+ ${a.length - 60} alerta(s) não exibidos.</p>` : "") : '<p class="ax-mut ax-sm">Nenhum alerta no momento.</p>'; }
$("a-conc").addEventListener("click", seguro(async () => { const r = await conciliar(false); renderAlertas(); toast(r.ok ? "Conciliação sem divergências." : "Há divergências financeiras.", r.ok ? "ok" : "err"); }));
const listaAud = () => { const q = $("a-busca").value.trim().toLowerCase(); return S.aud.filter((a) => buscaOk([a.acao, a.alvo, a.uid, a.papel, a.ip], q)); };
async function carregarAuditoria() { S.aud = await consultar("admin/auditoria?limite=200"); renderAuditoria(); }
function renderAuditoria() {
    const l = listaAud();
    $("a-body").innerHTML = l.length ? l.map((a) => `<tr>${td("Quando", dt(a.em))}${td("Quem", `${esc(a.papel)} <span class="ax-xs ax-mut">${esc(a.uid)}</span>`)}${td("Ação", esc(a.acao))}${td("Alvo", esc(a.alvo))}${td("IP", esc(a.ip))}</tr>`).join("") : vazio(5, "Sem registros.");
}
$("a-busca").addEventListener("input", renderAuditoria); $("a-atualizar").addEventListener("click", seguro(carregarAuditoria));
$("a-csv").addEventListener("click", () => baixarLinhas("auditoria", ["Quando", "Papel", "UID", "Ação", "Alvo", "IP"], listaAud().map((a) => [dt(a.em), a.papel, a.uid, a.acao, a.alvo, a.ip])));

// ---------- configurações ----------
const dl = (pares) => pares.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("");
function carregarConfig() {
    $("c-taxas").innerHTML = dl([["Diária paga pela loja", esc(brl(VALOR_DIARIA_CENTAVOS))], ["Comissão da plataforma", `${esc(brl(COMISSAO_PLATAFORMA_CENTAVOS))} (${((COMISSAO_PLATAFORMA_CENTAVOS / VALOR_DIARIA_CENTAVOS) * 100).toFixed(0)}%)`], ["Repasse ao profissional", esc(brl(REPASSE_PROFISSIONAL_CENTAVOS))], ["Taxa fixa p/ loja", esc(brl(TAXA_FIXA_CENTAVOS))], ["Duração do turno", `${HORAS_MIN_TURNO}–${HORAS_MAX_TURNO} h`], ["Máx. turnos/semana por loja", String(MAX_VEZES_SEMANA_LOJA)]]);
    $("c-integ").innerHTML = dl([["Mercado Pago", "MP_ACCESS_TOKEN · MP_WEBHOOK_SECRET"], ["Firebase Admin", "FIREBASE_SERVICE_ACCOUNT"], ["Criptografia de dados", "chaves de gerar-chaves.js"], ["Cron de liberação", "CRON_SECRET → POST /interno/liberar"]]);
    return carregarAviso();
}
$("c-testar-mp").addEventListener("click", seguro(async () => { const r = await conciliar(true); toast(r.ok ? "Mercado Pago respondeu e tudo confere." : "Conciliação com divergências — veja Financeiro.", r.ok ? "ok" : "err"); }));
async function carregarAviso() {
    const a = await consultar("admin/aviso");
    $("c-av-txt").value = a.texto || ""; $("c-av-nivel").value = a.nivel || "info"; $("c-av-on").checked = !!a.ativo;
    $("ax-aviso").hidden = !a.ativo; $("ax-aviso").textContent = a.ativo ? `Aviso global ativo: ${a.texto}` : "";
}
$("c-av-salvar").addEventListener("click", seguro(async () => {
    await chamarFuncao("admin/aviso", { texto: $("c-av-txt").value.trim(), nivel: $("c-av-nivel").value, ativo: $("c-av-on").checked }, "PUT");
    toast("Aviso salvo.", "ok"); await carregarAviso();
}));
