// Painel administrativo. A autorização é do SERVIDOR (claim role=admin); esta tela apenas consome a API.
import { signInWithPopup, signOut, onAuthStateChanged, reauthenticateWithPopup } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, googleProvider, chamarFuncao, consultar, baixarCSVProtegido, papelAtual, renovarToken } from "./firebase.js";
import { brl, esc, fmtDataHora } from "./core.js";
const $ = (id) => document.getElementById(id);
const msg = (t = "") => { $("adm-msg").textContent = t; };
const dt = (iso) => (iso ? fmtDataHora(iso) : "—");

$("btn-adm-login").addEventListener("click", () => signInWithPopup(auth, googleProvider).catch((e) => ($("adm-erro").textContent = "Falha no login.")));
$("btn-adm-sair").addEventListener("click", () => signOut(auth));
onAuthStateChanged(auth, async (u) => {
    $("adm-app").hidden = true; $("adm-login").hidden = false;
    if (!u) return;
    if ((await papelAtual()) !== "admin") { $("adm-erro").textContent = "Esta conta não tem permissão de administrador."; await signOut(auth); return; }
    $("adm-login").hidden = true; $("adm-app").hidden = false; $("adm-quem").textContent = u.email; abrirAba("cadastros");
});

/** Ações de dinheiro exigem login recente: confirma com o Google e repete uma vez. */
async function sensivel(fn) {
    try { return await fn(); } catch (e) {
        if (e.code !== "reautenticar") throw e;
        await reauthenticateWithPopup(auth.currentUser, googleProvider); await renovarToken(); return fn();
    }
}
const seguro = (fn) => async (...a) => { msg(); try { await fn(...a); } catch (e) { console.error(e); msg(e.message || "Erro"); } };

// ---------- abas ----------
const abas = { cadastros: carregarCadastros, treino: carregarModulos, pagamentos: carregarPagamentos, saques: carregarSaques, conciliacao: () => {}, auditoria: carregarAuditoria };
function abrirAba(a) {
    for (const b of document.querySelectorAll("#adm-abas .pill")) b.classList.toggle("sel", b.dataset.aba === a);
    for (const k of Object.keys(abas)) $("aba-" + k).hidden = k !== a;
    seguro(abas[a])();
}
$("adm-abas").addEventListener("click", (e) => { const b = e.target.closest("[data-aba]"); if (b) abrirAba(b.dataset.aba); });
document.addEventListener("click", seguro(async (e) => { const b = e.target.closest("[data-csv]"); if (b) await baixarCSVProtegido(`admin/exportar/${b.dataset.csv}.csv`, `abastece-ja-${b.dataset.csv}.csv`); }));

// ---------- cadastros ----------
async function carregarCadastros() {
    const l = await consultar(`admin/promotores?status=${$("f-status").value}`);
    $("t-cad").innerHTML = l.length ? l.map((p) => `<tr><td>${esc(p.nome)}</td><td>${esc(p.cidade)}</td><td>${p.treinamentoOk ? '<span class="ok">✓</span>' : "—"}</td><td>${dt(p.criadoEm)}</td><td><button class="btn btn-ghost btn-sm" data-ficha="${esc(p.uid)}">Analisar</button></td></tr>`).join("") : '<tr><td colspan="5" class="muted">Nenhum cadastro.</td></tr>';
}
$("f-status").addEventListener("change", seguro(carregarCadastros)); $("btn-recarregar-cad").addEventListener("click", seguro(carregarCadastros));
document.addEventListener("click", seguro(async (e) => {
    const f = e.target.closest("[data-ficha]"); if (f) return abrirFicha(f.dataset.ficha);
    const s = e.target.closest("[data-set-status]"); if (s) {
        const novo = s.dataset.setStatus, motivo = novo === "ativo" ? "" : prompt("Motivo:") || ""; if (novo !== "ativo" && !motivo) return;
        await chamarFuncao(`admin/promotores/${s.dataset.uid}/status`, { status: novo, motivo }); $("ficha").hidden = true; await carregarCadastros();
    }
}));
async function abrirFicha(uid) {
    const p = await consultar(`admin/promotores/${encodeURIComponent(uid)}`), r = p.responsavel, t = p.habilitacao;
    $("ficha").hidden = false;
    $("ficha").innerHTML = `<h3>${esc(p.nome)} <span class="badge">${esc(p.status)}</span> ${p.menor ? '<span class="badge red">MENOR (16–17)</span>' : ""}</h3>
        <p class="small">E-mail: ${esc(p.email)} · Tel.: ${esc(p.telefone)} · CPF: ${esc(p.cpfMascarado)} · Nascimento: ${esc(p.nascimento || "—")} (${p.idade ?? "?"} anos)</p>
        ${r ? `<div class="card gold mt"><strong>Responsável legal:</strong> ${esc(r.nome)} (${esc(r.parentesco)}) · CPF ${esc(r.cpfMascarado)} · Tel. ${esc(r.telefone)}<br><span class="small muted">Autorização registrada em ${dt(p.autorizacaoEm)}. Confirme com o responsável antes de aprovar.</span></div>` : p.menor ? '<p class="ruim mt">Falta autorização do responsável — não é possível aprovar.</p>' : ""}
        <p class="small mt">Treinamento: ${p.treinamento.concluidos}/${p.treinamento.total} · Pendências: ${esc((t.pendencias || []).join(", ") || "nenhuma")}</p>
        <div class="linha mt"><button class="btn btn-primary btn-sm" data-set-status="ativo" data-uid="${esc(uid)}">Aprovar</button><button class="btn btn-ghost btn-sm" data-set-status="pendente" data-uid="${esc(uid)}">Voltar p/ análise</button><button class="btn btn-ghost btn-sm" data-set-status="bloqueado" data-uid="${esc(uid)}">Bloquear</button></div>`;
}

// ---------- treinamento ----------
async function carregarModulos() {
    const l = await consultar("admin/treinamento/modulos");
    $("t-mod").innerHTML = l.length ? l.map((m) => `<tr><td>${m.ordem}</td><td>${esc(m.titulo)}<br><span class="muted small">${esc(m.id)}</span></td><td>${esc(m.provedor)}</td><td>${Math.round(m.duracaoSeg / 60)} min</td><td>${m.ativo ? '<span class="ok">sim</span>' : "não"}</td><td><button class="btn btn-ghost btn-sm" data-edit-mod='${esc(JSON.stringify(m))}'>Editar</button></td></tr>`).join("") : '<tr><td colspan="6" class="ruim">Nenhum módulo: ninguém consegue aceitar turnos até você publicar o treinamento.</td></tr>';
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-edit-mod]"); if (!b) return; const m = JSON.parse(b.dataset.editMod); $("m-id").value = m.id; $("m-ordem").value = m.ordem; $("m-titulo").value = m.titulo; $("m-prov").value = m.provedor; $("m-ref").value = m.videoRef; $("m-dur").value = m.duracaoSeg; $("m-ativo").checked = !!m.ativo; });
$("btn-salvar-mod").addEventListener("click", seguro(async () => {
    const id = $("m-id").value.trim(), corpo = { ordem: Number($("m-ordem").value), titulo: $("m-titulo").value.trim(), provedor: $("m-prov").value, videoRef: $("m-ref").value.trim(), duracaoSeg: Number($("m-dur").value), ativo: $("m-ativo").checked };
    await chamarFuncao(id ? `admin/treinamento/modulos/${encodeURIComponent(id)}` : "admin/treinamento/modulos", corpo, id ? "PUT" : "POST");
    for (const x of ["m-id", "m-ordem", "m-titulo", "m-ref", "m-dur"]) $(x).value = ""; await carregarModulos();
}));

// ---------- pagamentos / estornos ----------
async function carregarPagamentos() {
    const l = await consultar("admin/pagamentos");
    $("t-pag").innerHTML = l.map((p) => `<tr><td>${esc(p.id)}${p.simulado ? ' <span class="badge gray">teste</span>' : ""}${p.estornoParcialCentavos ? ' <span class="badge red">estorno parcial</span>' : ""}</td><td>${esc(p.status)}</td><td>${brl(p.totalCentavos)}</td><td>${brl(p.repasseCentavos)}</td><td>${brl(p.comissaoCentavos)}</td><td>${dt(p.pagoEm)}</td><td>${p.status === "aprovado" ? `<button class="btn btn-ghost btn-sm" data-estornar="${esc(p.id)}">Estornar</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="7" class="muted">Sem pagamentos.</td></tr>';
}
document.addEventListener("click", seguro(async (e) => {
    const b = e.target.closest("[data-estornar]"); if (!b) return;
    const motivo = prompt("Motivo do estorno (será auditado):"); if (!motivo || motivo.trim().length < 5) return;
    if (!confirm("Estornar devolve o valor à loja no Mercado Pago e desfaz repasse e comissão. Confirmar?")) return;
    const r = await sensivel(() => chamarFuncao(`admin/pedidos/${encodeURIComponent(b.dataset.estornar)}/estornar`, { motivo: motivo.trim() }));
    msg(r.saldoNegativo ? "Estornado. Atenção: a carteira do profissional ficou negativa." : "Estornado."); await carregarPagamentos();
}));
$("btn-liberar").addEventListener("click", seguro(async () => { const r = await chamarFuncao("admin/liberar-saldos", {}); msg(`${r.liberados} lançamento(s) liberado(s).`); }));

// ---------- saques ----------
async function carregarSaques() {
    const l = await consultar(`admin/saques?status=${$("f-saque").value}`);
    $("t-saq").innerHTML = l.map((s) => `<tr><td>${dt(s.em)}</td><td>${esc(s.uid)}</td><td>${brl(s.valorCentavos)}</td><td>${s.pix ? `${esc(s.pix.tipo)}: <code>${esc(s.pix.chave)}</code>` : esc(s.comprovante || "—")}</td><td>${s.status === "solicitado" ? `<button class="btn btn-primary btn-sm" data-pagar="${esc(s.id)}">Marcar pago</button> <button class="btn btn-ghost btn-sm" data-rejeitar="${esc(s.id)}">Rejeitar</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">Nada aqui.</td></tr>';
}
$("f-saque").addEventListener("change", seguro(carregarSaques));
document.addEventListener("click", seguro(async (e) => {
    const p = e.target.closest("[data-pagar]"), r = e.target.closest("[data-rejeitar]");
    if (p) { const c = prompt("ID/comprovante do Pix enviado:"); if (!c) return; await sensivel(() => chamarFuncao(`admin/saques/${encodeURIComponent(p.dataset.pagar)}/pagar`, { comprovante: c })); await carregarSaques(); }
    if (r) { const m = prompt("Motivo da rejeição (o valor volta à carteira):"); if (!m) return; await sensivel(() => chamarFuncao(`admin/saques/${encodeURIComponent(r.dataset.rejeitar)}/rejeitar`, { motivo: m })); await carregarSaques(); }
}));

// ---------- conciliação ----------
async function conciliar(mp) {
    const r = await consultar(`admin/conciliacao${mp ? "?mp=1" : ""}`), t = r.totais;
    $("conc-res").innerHTML = `<h3 class="${r.ok ? "ok" : "ruim"}">${r.ok ? "✓ Tudo conciliado" : "✗ Há divergências"}</h3>
        <p class="small">Recebido líquido: <strong>${brl(t.recebidoLiquidoCentavos)}</strong> · Saldos (carteiras + plataforma): <strong>${brl(t.saldosCentavos)}</strong> · Saques em aberto: ${brl(t.saquesSolicitadosCentavos)} · Saques pagos: ${brl(t.saquesPagosCentavos)} · Diferença: <strong class="${t.diferencaCentavos ? "ruim" : "ok"}">${brl(t.diferencaCentavos)}</strong></p>
        <p class="muted small">${r.contagens.lancamentos} lançamentos · ${r.contagens.carteiras} carteiras · ${r.contagens.pagamentos} pagamentos${mp ? ` · ${r.contagens.conferidosMP} conferidos no Mercado Pago` : ""}</p>
        ${r.divergencias.length ? `<div class="tw"><table><thead><tr><th>Tipo</th><th>Ref.</th><th>Descrição</th><th>Esperado</th><th>Encontrado</th></tr></thead><tbody>${r.divergencias.map((d) => `<tr><td>${esc(d.tipo)}${d.informativo ? " (info)" : ""}</td><td>${esc(d.ref)}</td><td>${esc(d.descricao)}</td><td><pre>${esc(JSON.stringify(d.esperado))}</pre></td><td><pre>${esc(JSON.stringify(d.encontrado))}</pre></td></tr>`).join("")}</tbody></table></div>` : ""}`;
}
$("btn-conc").addEventListener("click", seguro(() => conciliar(false))); $("btn-conc-mp").addEventListener("click", seguro(() => conciliar(true)));

// ---------- auditoria ----------
async function carregarAuditoria() {
    const l = await consultar("admin/auditoria?limite=150");
    $("t-aud").innerHTML = l.map((a) => `<tr><td>${dt(a.em)}</td><td>${esc(a.papel)} <span class="muted small">${esc(a.uid)}</span></td><td>${esc(a.acao)}</td><td>${esc(a.alvo)}</td><td>${esc(a.ip)}</td></tr>`).join("");
}
