// Aba "Vagas" do painel Admin/TI: cadastrar e moderar vagas (inclusive em nome de redes parceiras), ver candidatos com o PDF do currículo,
// gerir empresas e virar a chave de cobrança. A autorização é do SERVIDOR (rotas /admin/vagas*, papel admin); esta tela só consome a API.
// Nada de innerHTML com dado cru: tudo passa por esc(). CPF completo só sob demanda (login recente + auditoria no servidor).
import { chamarFuncao, consultar, abrirPDFProtegido } from "./firebase.js";
import { esc, fmtDataHora, reaisParaCentavos } from "./core.js";

const $ = (id) => document.getElementById(id);
const enc = encodeURIComponent;
const TIPOS = [["repositor", "Repositor"], ["promotor", "Promotor"], ["degustacao", "Degustação"]];
const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const ST_VAGA = { rascunho: ["Rascunho", ""], ativa: ["Ativa", "g"], encerrada: ["Encerrada", "r"] };
const ST_MOD = { pendente: ["Em moderação", "y"], aprovada: ["Aprovada", "g"], rejeitada: ["Recusada", "r"] };
const ST_CAND = [["pendente", "Recebida"], ["em_analise", "Em análise"], ["aceita", "Aceita"], ["recusada", "Recusada"]];
const TIPO_EMP = [["rede", "Rede"], ["loja", "Loja"], ["marca", "Marca"], ["outra", "Outra"]];
const reais = (c) => ((Number(c) || 0) / 100).toFixed(2).replace(".", ",");
const badge = ([t, c]) => `<span class="ax-badge ${c}">${esc(t)}</span>`;
const opt = (lista, sel = "", vazio = "") => `${vazio ? `<option value="">${esc(vazio)}</option>` : ""}${lista.map(([v, r]) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(r)}</option>`).join("")}`;
const vazioTr = (n, t) => `<tr><td colspan="${n}" class="ax-empty">${esc(t)}</td></tr>`;
const td = (l, h) => `<td data-l="${esc(l)}">${h}</td>`;
const campo = (id, rotulo, ctl) => `<div><label class="ax-lbl" for="${id}">${esc(rotulo)}</label>${ctl}</div>`;

/** deps: { sensivel, toast, seguro, pedir } vindos de admin.js. */
export function iniciarVagasAdmin({ sensivel, toast, seguro, pedir }) {
    const S = { aba: "vagas", empresas: [], vagas: [], filtro: { status: "", moderacao: "", empresaId: "" }, cand: { vagaId: "", status: "", q: "", cpf: "" }, resultado: null, cfg: null };
    const painel = () => $("vg-painel");

    async function carregarEmpresas() { S.empresas = await consultar("admin/vagas/empresas"); }
    async function carregar() { await carregarEmpresas(); await abrirAba(S.aba); }
    async function abrirAba(a) {
        S.aba = a;
        for (const b of document.querySelectorAll("#vg-abas .ax-pill")) b.classList.toggle("sel", b.dataset.a === a);
        if (a === "vagas") await pintarVagas(); else if (a === "candidatos") await pintarCandidatos(); else if (a === "empresas") pintarEmpresas(); else await pintarCobranca();
    }

    // ---------- vagas ----------
    async function pintarVagas() {
        const q = new URLSearchParams(Object.entries(S.filtro).filter(([, v]) => v)).toString();
        S.vagas = await consultar(`admin/vagas${q ? `?${q}` : ""}`);
        const emp = S.empresas.map((e) => [e.id, e.nome]);
        painel().innerHTML = `
        <div class="ax-card ax-mb"><h2>Nova vaga</h2>
          <p class="ax-xs ax-mut ax-mt">Publicada em nome da empresa escolhida, já aprovada e sem cobrança (use para o onboarding de redes parceiras). Cadastre a empresa na aba “Empresas”.</p>
          <div class="ax-grid ax-g2 ax-mt">
            ${campo("nv-emp", "Empresa / rede", `<select class="ax-sel" id="nv-emp">${opt(emp, "", "Escolha…")}</select>`)}
            ${campo("nv-tipo", "Tipo de atuação", `<select class="ax-sel" id="nv-tipo">${opt(TIPOS)}</select>`)}
            ${campo("nv-titulo", "Título", '<input class="ax-in" id="nv-titulo" maxlength="80" placeholder="Ex.: Repositor — Mercearia">')}
            ${campo("nv-exp", "Válida até (opcional)", '<input class="ax-in" id="nv-exp" type="date">')}
            ${campo("nv-cidade", "Cidade", '<input class="ax-in" id="nv-cidade" maxlength="80" placeholder="Itapira">')}
            ${campo("nv-uf", "UF", `<select class="ax-sel" id="nv-uf">${opt(UFS.map((u) => [u, u]), "SP")}</select>`)}
          </div>
          ${campo("nv-desc", "Descrição (mín. 20 caracteres)", '<textarea class="ax-ta" id="nv-desc" rows="4" maxlength="2000" placeholder="Turno, atividades, requisitos…"></textarea>').replace("<div>", '<div class="ax-mt">')}
          <label class="ax-row ax-mt"><input type="checkbox" id="nv-maiores" checked> <span class="ax-sm">Só para maiores de 18 anos (desmarque apenas se a vaga puder receber 16–17 anos)</span></label>
          <div class="ax-row ax-mt"><button class="ax-btn pri" data-vg="criar-publicar">Publicar agora</button><button class="ax-btn" data-vg="criar-rascunho">Salvar rascunho</button></div>
        </div>
        <div class="ax-card"><div class="ax-row ax-mb">
          <select class="ax-sel ax-grow" id="vf-emp" aria-label="Empresa">${opt(emp, S.filtro.empresaId, "Todas as empresas")}</select>
          <select class="ax-sel ax-grow" id="vf-st" aria-label="Status">${opt(Object.entries(ST_VAGA).map(([k, v]) => [k, v[0]]), S.filtro.status, "Todos os status")}</select>
          <select class="ax-sel ax-grow" id="vf-mod" aria-label="Moderação">${opt(Object.entries(ST_MOD).map(([k, v]) => [k, v[0]]), S.filtro.moderacao, "Toda moderação")}</select></div>
          <div class="ax-tw"><table class="ax-tbl"><thead><tr><th>Vaga</th><th>Local</th><th>Status</th><th>Moderação</th><th>Validade</th><th>Candidatos</th><th></th></tr></thead><tbody>${
            S.vagas.length ? S.vagas.map(linhaVaga).join("") : vazioTr(7, "Nenhuma vaga com estes filtros.")}</tbody></table></div></div>`;
    }
    function linhaVaga(v) {
        const acoes = [
            v.status !== "ativa" ? `<button class="ax-btn sm ok" data-vg="status" data-id="${esc(v.id)}" data-v="ativa">Publicar</button>` : `<button class="ax-btn sm" data-vg="status" data-id="${esc(v.id)}" data-v="encerrada">Encerrar</button>`,
            v.moderacao !== "aprovada" ? `<button class="ax-btn sm ok" data-vg="moderar" data-id="${esc(v.id)}" data-v="aprovada">Aprovar</button>` : "",
            v.moderacao !== "rejeitada" ? `<button class="ax-btn sm danger" data-vg="moderar" data-id="${esc(v.id)}" data-v="rejeitada">Recusar</button>` : "",
            `<button class="ax-btn sm" data-vg="ver-cand" data-id="${esc(v.id)}">Candidatos</button>`
        ].join(" ");
        return `<tr>${td("Vaga", `<strong>${esc(v.titulo)}</strong><br><span class="ax-xs ax-mut">${esc(v.empresa.nome)} · ${esc(v.tipoRotulo)}${v.apenasMaiores ? " · +18" : ""}${v.gratuita ? " · grátis" : ""}</span>`)}${td("Local", `${esc(v.cidade)} - ${esc(v.uf)}`)}${td("Status", badge(ST_VAGA[v.status] || [v.status, ""]))}${
            td("Moderação", badge(ST_MOD[v.moderacao] || [v.moderacao, ""]) + (v.moderacaoMotivo ? `<br><span class="ax-xs ax-mut">${esc(v.moderacaoMotivo)}</span>` : ""))}${td("Validade", v.expiraEm ? esc(fmtDataHora(v.expiraEm).split(",")[0]) : "—")}${td("Candidatos", esc(String(v.candidaturas)))}${td("Ações", acoes)}</tr>`;
    }
    async function criarVaga(publicar) {
        const v = (id) => $(id).value.trim();
        const corpo = { empresaId: v("nv-emp"), titulo: v("nv-titulo"), descricao: v("nv-desc"), cidade: v("nv-cidade"), uf: v("nv-uf"), tipo: v("nv-tipo"), apenasMaiores: $("nv-maiores").checked, publicar };
        if (v("nv-exp")) corpo.expiraEm = v("nv-exp");
        if (!corpo.empresaId) return toast("Escolha a empresa.", "err");
        await chamarFuncao("admin/vagas", corpo); toast(publicar ? "Vaga publicada." : "Rascunho salvo.", "ok"); await pintarVagas();
    }

    // ---------- candidatos ----------
    async function pintarCandidatos() {
        if (!S.vagas.length) S.vagas = await consultar("admin/vagas");
        const lista = S.vagas.map((v) => [v.id, `${v.titulo} — ${v.empresa.nome} (${v.candidaturas})`]);
        painel().innerHTML = `<div class="ax-card ax-mb"><div class="ax-grid ax-g2">
            ${campo("cd-vaga", "Vaga", `<select class="ax-sel" id="cd-vaga">${opt(lista, S.cand.vagaId, "Escolha a vaga…")}</select>`)}
            ${campo("cd-st", "Situação", `<select class="ax-sel" id="cd-st">${opt(ST_CAND, S.cand.status, "Todas")}</select>`)}
            ${campo("cd-q", "Nome", `<input class="ax-in" id="cd-q" maxlength="80" value="${esc(S.cand.q)}" placeholder="Parte do nome">`)}
            ${campo("cd-cpf", "CPF (cruzamento)", `<input class="ax-in" id="cd-cpf" inputmode="numeric" maxlength="14" value="${esc(S.cand.cpf)}" placeholder="Só dígitos">`)}</div>
          <div class="ax-row ax-mt"><button class="ax-btn pri" data-vg="buscar">Buscar</button></div></div>
          <div class="ax-card"><p class="ax-xs ax-mut ax-mb" id="cd-info"></p><div class="ax-tw"><table class="ax-tbl"><thead><tr><th>Nome</th><th>CPF</th><th>Candidatou em</th><th>Situação</th><th>Currículo</th></tr></thead><tbody id="cd-b"></tbody></table></div></div>`;
        if (S.cand.vagaId) await buscar(); else $("cd-b").innerHTML = vazioTr(5, "Escolha uma vaga para ver os candidatos.");
    }
    async function buscar() {
        S.cand = { vagaId: $("cd-vaga").value, status: $("cd-st").value, q: $("cd-q").value.trim(), cpf: $("cd-cpf").value.replace(/\D/g, "") };
        if (!S.cand.vagaId) return toast("Escolha a vaga.", "err");
        const corpo = {}; for (const k of ["status", "q", "cpf"]) if (S.cand[k]) corpo[k] = S.cand[k];
        S.resultado = await chamarFuncao(`admin/vagas/${enc(S.cand.vagaId)}/candidaturas`, corpo);       // POST: o CPF do filtro não fica na URL
        const r = S.resultado;
        $("cd-info").textContent = `${r.vaga.titulo} · ${r.vaga.empresa.nome} · ${r.candidaturas.length} candidato(s)`;
        $("cd-b").innerHTML = r.candidaturas.length ? r.candidaturas.map((c) => `<tr>${td("Nome", `<strong>${esc(c.nome)}</strong>`)}${
            td("CPF", `<span id="cpf-${esc(c.id)}">${esc(c.cpfMascarado)}</span> <button class="ax-btn sm" data-vg="cpf" data-id="${esc(c.id)}">Ver</button>`)}${td("Candidatou em", esc(fmtDataHora(c.candidatouEm) || "—"))}${
            td("Situação", `<select class="ax-sel" data-vg="cand-st" data-id="${esc(c.id)}" aria-label="Situação">${opt(ST_CAND, c.status)}</select>`)}${
            td("Currículo", c.temCurriculo ? `<button class="ax-btn sm pri" data-vg="pdf" data-id="${esc(c.id)}">Abrir PDF</button>` : `<span class="ax-xs ax-mut">${esc(c.curriculoRemovido ? "Removido pelo candidato" : !c.divulgacaoAtiva ? "Autorização retirada" : "Sem anexo")}</span>`)}</tr>`).join("") : vazioTr(5, "Nenhum candidato com estes filtros.");
    }

    // ---------- empresas ----------
    function pintarEmpresas() {
        painel().innerHTML = `<div class="ax-card ax-mb"><h2>Nova empresa / rede parceira</h2><div class="ax-row ax-mt">
            <input class="ax-in ax-grow" id="ne-nome" maxlength="80" placeholder="Ex.: Rede São Vicente" aria-label="Nome"><select class="ax-sel" id="ne-tipo" aria-label="Tipo" style="max-width:160px">${opt(TIPO_EMP)}</select><button class="ax-btn pri" data-vg="emp-criar">Cadastrar</button></div></div>
          <div class="ax-card"><div class="ax-tw"><table class="ax-tbl"><thead><tr><th>Empresa</th><th>Tipo</th><th>Créditos</th><th>Assinatura</th><th></th></tr></thead><tbody>${
            S.empresas.length ? S.empresas.map((e) => `<tr>${td("Empresa", `<strong>${esc(e.nome)}</strong>`)}${td("Tipo", esc((TIPO_EMP.find((t) => t[0] === e.tipo) || [0, e.tipo])[1]))}${td("Créditos", esc(String(e.creditos)))}${
                td("Assinatura", e.assinaturaAte ? `${badge(e.assinaturaAtiva ? ["Vigente", "g"] : ["Vencida", "r"])} <span class="ax-xs ax-mut">até ${esc(fmtDataHora(e.assinaturaAte).split(",")[0])}</span>` : "—")}${
                td("Ações", `<button class="ax-btn sm" data-vg="emp-cred" data-id="${esc(e.id)}">± Créditos</button> <button class="ax-btn sm" data-vg="emp-ass" data-id="${esc(e.id)}">Assinatura</button>`)}</tr>`).join("") : vazioTr(5, "Nenhuma empresa cadastrada.")}</tbody></table></div></div>`;
    }

    // ---------- cobrança ----------
    async function pintarCobranca() {
        const c = S.cfg = await consultar("admin/vagas/config");
        painel().innerHTML = `<div class="ax-card"><div class="ax-row"><div class="ax-grow"><h2>Cobrança das vagas</h2><p class="ax-xs ax-mut">Chave de transição: lançamento gratuito → mensalidade ou créditos.</p></div>${badge(c.faseGratuitaAtiva ? ["Fase gratuita ATIVA", "g"] : ["Cobrança ATIVA", "y"])}</div>
          <p class="ax-xs ax-mut ax-mt">Ao desligar a fase gratuita, só valem para <strong>novas publicações</strong> das empresas: vagas já publicadas de graça seguem grátis até vencer. Vagas cadastradas pelo admin nunca são cobradas.</p>
          <label class="ax-row ax-mt"><input type="checkbox" id="cf-fase"${c.faseGratuita ? " checked" : ""}> <span class="ax-sm">Fase gratuita ligada</span></label>
          <div class="ax-grid ax-g2 ax-mt">
            ${campo("cf-ate", "Gratuito até (opcional — encerra sozinho)", `<input class="ax-in" id="cf-ate" type="date" value="${esc(c.gratuitoAte || "")}">`)}
            ${campo("cf-modelo", "Modelo após a fase gratuita", `<select class="ax-sel" id="cf-modelo">${opt([["mensalidade", "Mensalidade (assinatura)"], ["creditos", "Créditos por vaga"]], c.modelo)}</select>`)}
            ${campo("cf-mens", "Mensalidade (R$)", `<input class="ax-in" id="cf-mens" inputmode="decimal" value="${reais(c.mensalidadeCentavos)}">`)}
            ${campo("cf-cred", "Preço do crédito (R$)", `<input class="ax-in" id="cf-cred" inputmode="decimal" value="${reais(c.creditoCentavos)}">`)}
            ${campo("cf-dias", "Validade padrão da vaga (dias)", `<input class="ax-in" id="cf-dias" type="number" min="1" max="180" value="${esc(String(c.validadeDiasPadrao))}">`)}
            ${campo("cf-max", "Máx. de vagas ativas grátis por empresa", `<input class="ax-in" id="cf-max" type="number" min="1" max="100" value="${esc(String(c.maxVagasAtivasGratis))}">`)}</div>
          <label class="ax-row ax-mt"><input type="checkbox" id="cf-mod"${c.moderacaoLojas ? " checked" : ""}> <span class="ax-sm">Vagas publicadas pelas lojas passam por moderação</span></label>
          <p class="ax-xs ax-mut ax-mt">Pagamento: por enquanto a assinatura e os créditos são lançados manualmente na aba “Empresas”.</p>
          <div class="ax-row ax-mt"><button class="ax-btn pri" data-vg="cfg-salvar">Salvar</button></div></div>`;
    }
    async function salvarCfg() {
        const antes = S.cfg, fase = $("cf-fase").checked;
        if (fase !== antes.faseGratuita) {
            const ok = await pedir({ titulo: fase ? "Religar a fase gratuita?" : "Encerrar a fase gratuita?", texto: fase ? "As empresas voltam a publicar sem custo." : "Novas publicações das empresas passarão a exigir mensalidade ou crédito. Vagas já publicadas continuam grátis até vencer.", ok: "Confirmar", perigo: !fase });
            if (!ok) return;
        }
        const corpo = { faseGratuita: fase, gratuitoAte: $("cf-ate").value || null, modelo: $("cf-modelo").value, mensalidadeCentavos: reaisParaCentavos($("cf-mens").value) || 0, creditoCentavos: reaisParaCentavos($("cf-cred").value) || 0, validadeDiasPadrao: Number($("cf-dias").value), maxVagasAtivasGratis: Number($("cf-max").value), moderacaoLojas: $("cf-mod").checked };
        await chamarFuncao("admin/vagas/config", corpo, "PUT"); toast("Configuração salva.", "ok"); await pintarCobranca();
    }

    // ---------- eventos ----------
    const raiz = $("v-vagas");
    raiz.addEventListener("click", seguro(async (e) => {
        const ab = e.target.closest("#vg-abas .ax-pill"); if (ab) return abrirAba(ab.dataset.a);
        const b = e.target.closest("[data-vg]"); if (!b || b.tagName === "SELECT") return;
        const id = b.dataset.id, acao = b.dataset.vg;
        if (acao === "criar-publicar") await criarVaga(true);
        else if (acao === "criar-rascunho") await criarVaga(false);
        else if (acao === "status") { await chamarFuncao(`admin/vagas/${enc(id)}/status`, { status: b.dataset.v }, "PUT"); toast("Status atualizado.", "ok"); await pintarVagas(); }
        else if (acao === "moderar") {
            let motivo = ""; if (b.dataset.v === "rejeitada") { motivo = await pedir({ titulo: "Recusar vaga", texto: "A empresa verá este motivo.", rotulo: "Motivo", min: 5, ok: "Recusar", perigo: true }); if (!motivo) return; }
            await chamarFuncao(`admin/vagas/${enc(id)}/moderacao`, { estado: b.dataset.v, motivo }, "PUT"); toast("Moderação registrada.", "ok"); await pintarVagas();
        } else if (acao === "ver-cand") { S.cand = { vagaId: id, status: "", q: "", cpf: "" }; await abrirAba("candidatos"); }
        else if (acao === "buscar") await buscar();
        else if (acao === "pdf") await abrirPDFProtegido(`admin/vagas/candidaturas/${enc(id)}/curriculo`);
        else if (acao === "cpf") { const r = await sensivel(() => chamarFuncao(`admin/vagas/candidaturas/${enc(id)}/cpf`, {})); $(`cpf-${CSS.escape(id)}`).textContent = r.cpfFormatado; b.remove(); }
        else if (acao === "emp-criar") { await chamarFuncao("admin/vagas/empresas", { nome: $("ne-nome").value.trim(), tipo: $("ne-tipo").value }); toast("Empresa cadastrada.", "ok"); await carregarEmpresas(); pintarEmpresas(); }
        else if (acao === "emp-cred") {
            const t = await pedir({ titulo: "Ajustar créditos", texto: "Use número positivo para somar (compra) e negativo para subtrair.", rotulo: "Quantidade (ex.: 5 ou -1)", min: 1, ok: "Aplicar" }); if (t === null) return;
            const n = Number(t); if (!Number.isInteger(n) || n === 0) return toast("Informe um número inteiro diferente de zero.", "err");
            await chamarFuncao(`admin/vagas/empresas/${enc(id)}/plano`, { creditosDelta: n }, "PUT"); toast("Créditos atualizados.", "ok"); await carregarEmpresas(); pintarEmpresas();
        } else if (acao === "emp-ass") {
            const t = await pedir({ titulo: "Assinatura vigente até", texto: "Data no formato AAAA-MM-DD. Deixe só “-” para cancelar a assinatura.", rotulo: "Data (AAAA-MM-DD)", min: 1, ok: "Salvar" }); if (t === null) return;
            await chamarFuncao(`admin/vagas/empresas/${enc(id)}/plano`, { assinaturaAte: t === "-" ? null : t }, "PUT"); toast("Assinatura atualizada.", "ok"); await carregarEmpresas(); pintarEmpresas();
        } else if (acao === "cfg-salvar") await salvarCfg();
    }));
    raiz.addEventListener("change", seguro(async (e) => {
        const el = e.target;
        if (el.dataset.vg === "cand-st") { await chamarFuncao(`admin/vagas/candidaturas/${enc(el.dataset.id)}/status`, { status: el.value }, "PUT"); toast("Situação atualizada.", "ok"); }
        else if (el.id === "vf-emp") { S.filtro.empresaId = el.value; await pintarVagas(); }
        else if (el.id === "vf-st") { S.filtro.status = el.value; await pintarVagas(); }
        else if (el.id === "vf-mod") { S.filtro.moderacao = el.value; await pintarVagas(); }
    }));
    return { carregar };
}
