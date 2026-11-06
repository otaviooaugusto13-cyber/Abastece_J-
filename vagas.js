// ============================================================
// ABASTECE JÁ — Mural de Vagas e Divulgação do profissional (app do promotor).
// Telas: "Mural de vagas" (feed + filtros + candidatura em 1 clique + minhas candidaturas) e "Divulgação e currículo"
// (opt-in LGPD + upload do PDF com confirmação). Todas as regras valem no SERVIDOR; aqui só se mostra e se envia a intenção.
// Dependências entram por parâmetro (como em documento.js): o módulo não importa Firebase e as partes puras são testáveis sem navegador.
// Nada do servidor vira HTML sem passar por esc().
// ============================================================
export const MAX_PDF_BYTES = 5 * 1024 * 1024;
const STATUS = { pendente: ["Enviada", "gray"], em_analise: ["Em análise", "blue"], aceita: ["Aceita", "green"], recusada: ["Não seguiu", "red"] };
const FALTA = {
    nome: "seu nome completo (em Meus dados)", cpf: "seu CPF (em Meus dados)", nascimento: "sua data de nascimento (em Meus dados)",
    divulgacao: "aceitar a divulgação dos seus dados e currículo", curriculo: "enviar o currículo em PDF"
};

/** Validação rápida no aparelho (o servidor confere o conteúdo de verdade). */
export function validarArquivoPdf(arq) {
    if (!arq) return { ok: false, erro: "Escolha um arquivo." };
    const nome = String(arq.name || "");
    if (!(arq.type === "application/pdf" || /\.pdf$/i.test(nome))) return { ok: false, erro: "O currículo precisa estar em PDF." };
    if (!arq.size) return { ok: false, erro: "O arquivo está vazio." };
    if (arq.size > MAX_PDF_BYTES) return { ok: false, erro: `O PDF passa de 5 MB (tem ${fmtTamanho(arq.size)}). Reduza o arquivo e tente de novo.` };
    return { ok: true, erro: "" };
}
export const fmtTamanho = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
export const textoFaltas = (falta = []) => falta.map((f) => FALTA[f]).filter(Boolean);
export const rotuloStatus = (s) => STATUS[s] || [s || "—", "gray"];
/** Para onde levar a pessoa a partir do que falta: dados cadastrais abrem a ficha; o resto fica na aba de divulgação. */
export const destinoDasFaltas = (falta = []) => (falta.some((f) => ["divulgacao", "curriculo"].includes(f)) ? "divulgacao" : "dados");
const fmtData = (ms) => (ms ? new Date(ms).toLocaleDateString("pt-BR") : "");
const lerComoDataUrl = (arq) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("Não foi possível ler o arquivo.")); r.readAsDataURL(arq); });

/**
 * @param {object} d
 * @param {(caminho:string)=>Promise<any>} d.consultar  GET autenticado
 * @param {(caminho:string, corpo?:object, metodo?:string)=>Promise<any>} d.enviar  chamada autenticada (chamarFuncao)
 * @param {(caminho:string)=>Promise<void>} d.abrirPDF  abre PDF protegido (abrirPDFProtegido)
 * @param {Function} d.dialogo @param {(id:string)=>void} d.abrir @param {(id:string)=>void} d.irPara
 * @param {Function} d.ok @param {Function} d.erro @param {Function} d.esc @param {Function} d.skeleton @param {Function} d.vazio
 */
export function iniciarVagas({ consultar, enviar, abrirPDF, dialogo, abrir, irPara, ok, erro, esc, skeleton, vazio, raiz = document }) {
    const $ = (id) => raiz.getElementById(id);
    if (!$("tab-vagas") || !$("tab-divulgacao")) return { carregarMural() {}, carregarDivulgacao() {} };
    const st = { perfil: null, vista: "mural", filtros: { cidade: "", tipo: "", rede: "" }, facetas: null, escolhido: null, ocupado: false, enviando: new Set() };

    // ---------- perfil / divulgação ----------
    async function lerPerfil() { st.perfil = await consultar("perfil/vagas"); return st.perfil; }
    function pintarAviso() {
        const a = $("vg-aviso"), p = st.perfil; if (!a || !p) return;
        const f = textoFaltas(p.falta); a.hidden = p.pronto;
        if (!p.pronto) { a.className = "banner mb"; a.innerHTML = `<span class="ico">📄</span><div>Para se candidatar falta: <strong>${esc(f.join(", "))}</strong>.<br><button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px" data-vg-completar>Completar perfil</button></div>`; }
    }
    function pintarDivulgacao() {
        const p = st.perfil; if (!p) return;
        $("dv-termo").textContent = p.termo.texto; $("dv-consent").checked = p.aceitaDivulgacao;
        $("dv-consent-info").textContent = p.aceitaDivulgacao ? `Autorizado${p.aceitaEm ? ` em ${fmtData(p.aceitaEm)}` : ""}. Você pode retirar a qualquer momento.` : "Desligado: nenhuma empresa vê seus dados e você não consegue se candidatar.";
        $("dv-nome").textContent = p.nomeCompleto || "—"; $("dv-cpf").textContent = p.cpfMascarado || "—";
        const c = p.curriculo, tem = !!c;
        $("dv-pdf-estado").textContent = tem ? `${c.nomeArquivo} · ${fmtTamanho(c.bytes)}${c.enviadoEm ? ` · enviado em ${fmtData(c.enviadoEm)}` : ""}` : "Nenhum currículo enviado ainda.";
        $("dv-ver").hidden = !tem; $("dv-apagar").hidden = !tem; $("dv-escolher").textContent = tem ? "Trocar currículo" : "Escolher PDF";
        pintarEscolhido(); pintarAviso();
    }
    function pintarEscolhido() {
        const e = st.escolhido, box = $("dv-novo"); box.hidden = !e; if (!e) return;
        $("dv-novo-nome").textContent = `${e.arq.name} · ${fmtTamanho(e.arq.size)}`;
        const b = $("dv-enviar"); b.disabled = st.ocupado; b.textContent = st.ocupado ? "Enviando…" : "Confirmar e enviar";
    }
    async function carregarDivulgacao() { try { await lerPerfil(); pintarDivulgacao(); } catch (e) { erro(e.message); } }

    async function alternarConsentimento() {
        const box = $("dv-consent"), quer = box.checked;
        if (!quer) {
            const r = await dialogo({ titulo: "Retirar autorização?", texto: "As empresas deixam de ver seu currículo e você não poderá se candidatar até autorizar de novo. Candidaturas já enviadas continuam, sem o anexo.", icone: "🔒", acoes: [{ rotulo: "Retirar autorização", valor: "sim", tipo: "danger" }, { rotulo: "Manter", valor: null, tipo: "ghost" }] });
            if (r !== "sim") { box.checked = true; return; }
        }
        box.disabled = true;
        try { st.perfil = await enviar("perfil/vagas/consentimento", { aceito: quer, versao: st.perfil?.termo?.versao }, "PUT"); ok(quer ? "Divulgação autorizada." : "Autorização retirada."); }
        catch (e) { box.checked = !quer; if (e.code === "termo-desatualizado") await lerPerfil().catch(() => {}); erro(e.message); }
        finally { box.disabled = false; pintarDivulgacao(); }
    }
    function escolherArquivo(arq) {
        const v = validarArquivoPdf(arq); $("dv-erro").textContent = v.erro;
        st.escolhido = v.ok ? { arq } : null; pintarEscolhido();
    }
    async function enviarCurriculo() {
        const e = st.escolhido; if (!e || st.ocupado) return;
        st.ocupado = true; pintarEscolhido();
        try {
            st.perfil = await enviar("perfil/curriculo", { arquivo: await lerComoDataUrl(e.arq), nome: e.arq.name }, "PUT");
            st.escolhido = null; $("dv-arquivo").value = ""; $("dv-erro").textContent = ""; ok("Currículo enviado.");
        } catch (x) { $("dv-erro").textContent = x.message; erro(x.message); }
        finally { st.ocupado = false; pintarDivulgacao(); }
    }
    async function apagarCurriculo() {
        const r = await dialogo({ titulo: "Apagar currículo?", texto: "O arquivo é removido de vez. Candidaturas já enviadas ficam sem o anexo.", icone: "🗑️", acoes: [{ rotulo: "Apagar", valor: "sim", tipo: "danger" }, { rotulo: "Cancelar", valor: null, tipo: "ghost" }] });
        if (r !== "sim") return;
        try { st.perfil = await enviar("perfil/curriculo", {}, "DELETE"); ok("Currículo apagado."); } catch (e) { erro(e.message); }
        pintarDivulgacao();
    }

    // ---------- mural ----------
    const opcoes = (lista, todas) => `<option value="">${esc(todas)}</option>${lista.map((o) => `<option value="${esc(o.valor)}">${esc(o.rotulo)}</option>`).join("")}`;
    function pintarFiltros() {
        const f = st.facetas; if (!f) return;
        const por = [["vg-f-cidade", f.cidades, "Todas as cidades", "cidade"], ["vg-f-tipo", f.tipos, "Todos os tipos", "tipo"], ["vg-f-rede", f.redes, "Todas as redes", "rede"]];
        for (const [id, lista, todas, chave] of por) { const el = $(id); el.innerHTML = opcoes(lista, todas); el.value = lista.some((o) => o.valor === st.filtros[chave]) ? st.filtros[chave] : ""; st.filtros[chave] = el.value; }
    }
    function cartao(v) {
        const [rot, cor] = v.jaCandidatou ? rotuloStatus(v.statusCandidatura) : [];
        const acao = v.jaCandidatou ? `<span class="badge ${cor}">✓ Candidatura: ${esc(rot)}</span>` : `<button type="button" class="btn btn-primary btn-sm" data-vg-candidatar="${esc(v.id)}" ${st.enviando.has(v.id) ? "disabled" : ""}>${st.enviando.has(v.id) ? "Enviando…" : "Candidatar-se"}</button>`;
        return `<article class="card vg-card" aria-label="${esc(v.titulo)}">
            <div class="vg-topo"><span class="badge">${esc(v.tipoRotulo)}</span>${v.apenasMaiores ? '<span class="badge gray">+18</span>' : ""}</div>
            <h3>${esc(v.titulo)}</h3><p class="vg-emp">${esc(v.empresa.nome)} · 📍 ${esc(v.cidade)} - ${esc(v.uf)}</p>
            <p class="vg-desc">${esc(v.descricao)}</p>
            <div class="vg-rodape"><small class="muted">${v.expiraEm ? `Até ${esc(fmtData(v.expiraEm))}` : ""}</small>${acao}</div>
            ${v.jaCandidatou ? "" : '<small class="muted vg-lgpd">Ao se candidatar, enviamos seu nome, CPF e currículo à empresa.</small>'}
        </article>`;
    }
    async function carregarMural() {
        const l = $("vg-lista"); l.innerHTML = skeleton(3);
        try {
            const q = new URLSearchParams(Object.entries(st.filtros).filter(([, v]) => v)).toString();
            const [r] = await Promise.all([consultar(`vagas${q ? `?${q}` : ""}`), lerPerfil().then(pintarAviso).catch(() => {})]);
            st.facetas = r.filtros; pintarFiltros();
            l.innerHTML = r.vagas.length ? r.vagas.map(cartao).join("") : vazio("💼", "Nenhuma vaga por aqui", Object.values(st.filtros).some(Boolean) ? "Tente tirar algum filtro." : "Novas vagas das empresas parceiras aparecem aqui.");
        } catch (e) { l.innerHTML = vazio("⚠️", "Não deu para carregar as vagas", e.message); }
    }
    async function carregarMinhas() {
        const l = $("vg-minhas"); l.innerHTML = skeleton(2);
        try {
            const r = await consultar("vagas/minhas-candidaturas");
            l.innerHTML = r.length ? r.map((c) => { const [rot, cor] = rotuloStatus(c.status); return `<div class="card vg-card"><div class="vg-topo"><span class="badge ${cor}">${esc(rot)}</span></div><h3>${esc(c.vaga)}</h3><p class="vg-emp">${esc(c.empresa)} · enviada em ${esc(fmtData(c.candidatouEm))}</p></div>`; }).join("") : vazio("📨", "Você ainda não se candidatou", "Quando se candidatar, o andamento aparece aqui.");
        } catch (e) { l.innerHTML = vazio("⚠️", "Não deu para carregar", e.message); }
    }
    function mostrarVista(v) {
        st.vista = v; $("vg-vista-mural").hidden = v !== "mural"; $("vg-vista-minhas").hidden = v !== "minhas";
        for (const b of raiz.querySelectorAll("[data-vg-vista]")) { const on = b.dataset.vgVista === v; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); }
        return v === "mural" ? carregarMural() : carregarMinhas();
    }

    /** Modal "complete seu perfil" (pré-checagem no app E resposta 409 do servidor). */
    async function pedirConclusao(falta) {
        const itens = textoFaltas(falta);
        const r = await dialogo({ titulo: "Complete seu perfil", texto: `Para se candidatar falta: ${itens.join("; ")}.`, icone: "📄", acoes: [{ rotulo: "Completar agora", valor: "ir" }, { rotulo: "Agora não", valor: null, tipo: "ghost" }] });
        if (r === "ir") { if (destinoDasFaltas(falta) === "divulgacao") irPara("tab-divulgacao"); else abrir("sheet-perfil"); }
    }
    async function candidatar(id) {
        if (st.enviando.has(id)) return;
        st.enviando.add(id);                                   // marca ANTES de qualquer await: cliques repetidos não passam
        let recarregar = false;
        try {
            if (!st.perfil) await lerPerfil();
            if (!st.perfil.pronto) return await pedirConclusao(st.perfil.falta);
            recarregar = true;
            await enviar(`vagas/${encodeURIComponent(id)}/candidatar`, {}); ok("Candidatura enviada! Acompanhe em “Minhas candidaturas”.");
        } catch (e) {
            if (e.code === "perfil-incompleto") { await lerPerfil().catch(() => {}); await pedirConclusao(e.detalhe?.falta || []); }
            else if (e.code === "ja-candidatou") ok("Você já se candidatou a esta vaga."); else erro(e.message);
        } finally { st.enviando.delete(id); if (recarregar || st.vista === "mural") await carregarMural(); }
    }

    // ---------- eventos ----------
    raiz.addEventListener("click", (e) => {
        const g = (s) => e.target.closest(s);
        let el;
        if ((el = g("[data-vg-vista]"))) mostrarVista(el.dataset.vgVista);
        else if ((el = g("[data-vg-candidatar]"))) candidatar(el.dataset.vgCandidatar);
        else if (g("[data-vg-completar]")) pedirConclusao(st.perfil?.falta || []);
        else if (g("#dv-ver")) abrirPDF("perfil/curriculo").catch((x) => erro(x.message));
        else if (g("#dv-ver-novo") && st.escolhido) { const u = URL.createObjectURL(st.escolhido.arq); window.open(u, "_blank"); setTimeout(() => URL.revokeObjectURL(u), 120000); }
        else if (g("#dv-enviar")) enviarCurriculo();
        else if (g("#dv-cancelar-novo")) { st.escolhido = null; $("dv-arquivo").value = ""; $("dv-erro").textContent = ""; pintarEscolhido(); }
        else if (g("#dv-apagar")) apagarCurriculo();
    });
    $("dv-consent").addEventListener("change", alternarConsentimento);
    $("dv-arquivo").addEventListener("change", (e) => escolherArquivo(e.target.files?.[0]));
    for (const [id, chave] of [["vg-f-cidade", "cidade"], ["vg-f-tipo", "tipo"], ["vg-f-rede", "rede"]]) $(id).addEventListener("change", (e) => { st.filtros[chave] = e.target.value; carregarMural(); });

    return { carregarMural: () => mostrarVista(st.vista), carregarDivulgacao };
}
