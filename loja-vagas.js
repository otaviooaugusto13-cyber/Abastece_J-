// ============================================================
// ABASTECE JÁ — Vagas da loja (app da loja/contratante).
// A loja anuncia vagas (rascunho ou publicar), encerra, vê os candidatos, muda o status da candidatura e abre o currículo em PDF.
// Usa a API /loja/vagas… (server/rotas/vagas.js). TODAS as regras valem no SERVIDOR (cobrança, moderação, consentimento do candidato,
// limite de vagas, só candidatos da própria vaga); aqui só se mostra e se envia a intenção.
// Dependências entram por parâmetro (como em vagas.js do promotor). Nada do servidor vira HTML sem passar por esc().
// ============================================================
export const TIPOS = [["degustacao", "Degustação"], ["promotor", "Promotor"], ["repositor", "Repositor"]];
export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const STATUS_VAGA = { rascunho: ["Rascunho", "gray"], ativa: ["No ar", "green"], encerrada: ["Encerrada", "red"] };
const MODERACAO = { pendente: ["Em moderação", "blue"], aprovada: ["", ""], rejeitada: ["Recusada pela moderação", "red"] };
const STATUS_CAND = { pendente: ["Nova", "gray"], em_analise: ["Em análise", "blue"], aceita: ["Aceita", "green"], recusada: ["Não seguiu", "red"] };

export const rotuloVaga = (s) => STATUS_VAGA[s] || [s || "—", "gray"];
export const rotuloModeracao = (m) => MODERACAO[m] || ["", ""];
export const rotuloCandidatura = (s) => STATUS_CAND[s] || [s || "—", "gray"];
const fmtData = (ms) => (ms ? new Date(ms).toLocaleDateString("pt-BR") : "");

/** Validação rápida no aparelho (o servidor confere de verdade). Devolve a mensagem do 1º problema ou "". */
export function validarVaga(d) {
    if (String(d.titulo || "").trim().length < 5) return "O título precisa ter pelo menos 5 letras.";
    if (String(d.descricao || "").trim().length < 20) return "Descreva a vaga com pelo menos 20 letras (o que a pessoa vai fazer, horário, benefícios).";
    if (String(d.cidade || "").trim().length < 2) return "Informe a cidade.";
    if (!UFS.includes(String(d.uf || "").toUpperCase())) return "Escolha o estado (UF).";
    if (!TIPOS.some(([v]) => v === d.tipo)) return "Escolha o tipo de atuação.";
    return "";
}

/** Texto do aviso de plano que vem em GET /loja/vagas. */
export function textoPlano(plano) {
    if (!plano) return "";
    if (plano.gratuito) return `Lançamento: publicar é grátis${plano.gratuitoAte ? ` até ${fmtData(Date.parse(plano.gratuitoAte) || plano.gratuitoAte)}` : ""}${plano.limiteGratis ? ` (até ${plano.limiteGratis} vagas no ar ao mesmo tempo)` : ""}.`;
    return plano.modelo === "creditos" ? `Cada publicação usa 1 crédito. Saldo: ${plano.creditos || 0}.` : "Para publicar é preciso ter a assinatura de vagas ativa. Fale com a equipe do Abastece Já.";
}

export function iniciarVagasLoja({ consultar, enviar, abrirPDF, ok, erro, esc, skeleton, vazio, raiz = document }) {
    const $ = (id) => raiz.getElementById(id), secao = $("tab-vagas");
    if (!secao || !$("vl-lista")) return { carregar() {} };
    const st = { dados: null, aberta: null, cands: new Map(), ocupado: new Set(), formAberto: false };

    // ---------- formulário ----------
    const opts = (lista, atual) => lista.map(([v, r]) => `<option value="${esc(v)}"${v === atual ? " selected" : ""}>${esc(r)}</option>`).join("");
    function montarForm() {
        $("vl-tipo").innerHTML = `<option value="">Tipo de atuação</option>${opts(TIPOS)}`;
        $("vl-uf").innerHTML = `<option value="">UF</option>${opts(UFS.map((u) => [u, u]))}`;
    }
    function mostrarForm(sim) {
        st.formAberto = sim; $("vl-form").hidden = !sim; $("vl-novo").hidden = sim;
        if (sim) { $("vl-erro").textContent = ""; $("vl-titulo").focus?.({ preventScroll: false }); }
    }
    const lerForm = () => ({
        titulo: $("vl-titulo").value.trim(), descricao: $("vl-descricao").value.trim(), cidade: $("vl-cidade").value.trim(),
        uf: $("vl-uf").value, tipo: $("vl-tipo").value, apenasMaiores: $("vl-maiores").checked
    });
    async function salvar(publicar) {
        const d = lerForm(), msg = validarVaga(d); $("vl-erro").textContent = msg; if (msg || st.ocupado.has("form")) return;
        st.ocupado.add("form"); $("vl-rascunho").disabled = $("vl-publicar").disabled = true;
        try {
            await enviar("loja/vagas", { ...d, publicar }, "POST");
            ok(publicar ? "Vaga enviada. Se precisar de moderação, ela entra no ar assim que for aprovada." : "Rascunho salvo.");
            $("vl-form").querySelectorAll("input[type=text],textarea,select").forEach((e) => { e.value = ""; }); $("vl-maiores").checked = true;
            mostrarForm(false); await carregar();
        } catch (e) { $("vl-erro").textContent = mensagem(e); erro(mensagem(e)); }
        finally { st.ocupado.delete("form"); $("vl-rascunho").disabled = $("vl-publicar").disabled = false; }
    }
    function mensagem(e) {
        if (e?.code === "plano-necessario") return "Sua loja precisa de plano ativo para publicar. Fale com a equipe do Abastece Já.";
        return e?.message || "Não foi possível concluir. Tente de novo.";
    }

    // ---------- lista ----------
    function cartao(v) {
        const [rs, cs] = rotuloVaga(v.status), [rm, cm] = rotuloModeracao(v.moderacao), aberta = st.aberta === v.id, busy = st.ocupado.has(v.id);
        const acao = v.status === "ativa"
            ? `<button type="button" class="btn btn-ghost btn-sm" data-vl-status="encerrada" data-id="${esc(v.id)}" ${busy ? "disabled" : ""}>Encerrar</button>`
            : `<button type="button" class="btn btn-primary btn-sm" data-vl-status="ativa" data-id="${esc(v.id)}" ${busy ? "disabled" : ""}>${v.status === "encerrada" ? "Publicar de novo" : "Publicar"}</button>`;
        return `<article class="card vg-card" aria-label="${esc(v.titulo)}">
            <div class="vg-topo"><span class="badge ${cs}">${esc(rs)}</span>${rm ? `<span class="badge ${cm}">${esc(rm)}</span>` : ""}<span class="badge">${esc(v.tipoRotulo)}</span>${v.apenasMaiores ? '<span class="badge gray">+18</span>' : ""}</div>
            <h3>${esc(v.titulo)}</h3><p class="vg-emp">📍 ${esc(v.cidade)} - ${esc(v.uf)}${v.expiraEm ? ` · até ${esc(fmtData(v.expiraEm))}` : ""}</p>
            ${v.moderacaoMotivo && v.moderacao === "rejeitada" ? `<p class="small muted">Motivo: ${esc(v.moderacaoMotivo)}</p>` : ""}
            <p class="vg-desc">${esc(v.descricao)}</p>
            <div class="vg-rodape"><button type="button" class="btn btn-ghost btn-sm" data-vl-cands="${esc(v.id)}" aria-expanded="${aberta}">👥 ${v.candidaturas || 0} candidato(s)</button>${acao}</div>
            <div class="vl-cands" id="vl-c-${esc(v.id)}" ${aberta ? "" : "hidden"}>${aberta ? listaCands(v.id) : ""}</div>
        </article>`;
    }
    function listaCands(id) {
        const r = st.cands.get(id); if (!r) return skeleton(1);
        if (r.erro) return vazio("⚠️", "Não deu para carregar", r.erro);
        if (!r.itens.length) return `<p class="muted small">Ninguém se candidatou ainda.</p>`;
        return r.itens.map((c) => {
            const [rot, cor] = rotuloCandidatura(c.status), busy = st.ocupado.has(c.id);
            const btn = (s, t, cls) => `<button type="button" class="btn ${cls} btn-sm" data-vl-cand="${esc(c.id)}" data-st="${s}" ${busy || c.status === s ? "disabled" : ""}>${t}</button>`;
            const pdf = c.temCurriculo ? `<button type="button" class="btn btn-ghost btn-sm" data-vl-pdf="${esc(c.id)}">📄 Currículo</button>` : `<small class="muted">${c.curriculoRemovido ? "Currículo removido pelo candidato" : c.divulgacaoAtiva ? "Sem currículo" : "Retirou a autorização"}</small>`;
            return `<div class="vl-cand"><div class="vl-cand-topo"><strong>${esc(c.nome)}</strong><span class="badge ${cor}">${esc(rot)}</span></div>
                <small class="muted">CPF ${esc(c.cpfMascarado || "—")} · ${esc(fmtData(c.candidatouEm))}</small>
                <div class="dv-acoes">${pdf}${btn("em_analise", "Em análise", "btn-ghost")}${btn("aceita", "Aceitar", "btn-primary")}${btn("recusada", "Recusar", "btn-ghost")}</div></div>`;
        }).join("");
    }
    function pintar() {
        const d = st.dados; if (!d) return;
        const plano = textoPlano(d.plano), a = $("vl-plano"); a.hidden = !plano; a.innerHTML = plano ? `<span class="ico">💼</span><div class="small">${esc(plano)}</div>` : "";
        $("vl-lista").innerHTML = d.vagas.length ? d.vagas.map(cartao).join("") : vazio("💼", "Você ainda não anunciou vagas", "Toque em “Nova vaga” para anunciar e receber currículos de profissionais.");
    }
    async function carregar() {
        $("vl-lista").innerHTML = skeleton(2);
        try { st.dados = await consultar("loja/vagas"); pintar(); if (st.aberta) carregarCands(st.aberta); }
        catch (e) { $("vl-lista").innerHTML = vazio("⚠️", "Não deu para carregar as vagas", e.message); }
    }
    async function carregarCands(id) {
        try { const r = await consultar(`loja/vagas/${encodeURIComponent(id)}/candidaturas`); st.cands.set(id, { itens: r.candidaturas || [] }); }
        catch (e) { st.cands.set(id, { erro: e.message }); }
        if (st.aberta === id) { const el = $(`vl-c-${id}`); if (el) el.innerHTML = listaCands(id); }
    }

    // ---------- ações ----------
    async function mudarStatusVaga(id, novo) {
        if (st.ocupado.has(id)) return; st.ocupado.add(id); pintar();
        try { await enviar(`loja/vagas/${encodeURIComponent(id)}/status`, { status: novo }, "PUT"); ok(novo === "ativa" ? "Vaga enviada para publicação." : "Vaga encerrada."); st.ocupado.delete(id); await carregar(); }
        catch (e) { st.ocupado.delete(id); erro(mensagem(e)); pintar(); }
    }
    async function mudarStatusCand(id, novo) {
        if (st.ocupado.has(id)) return; st.ocupado.add(id);
        const el = $(`vl-c-${st.aberta}`); if (el) el.innerHTML = listaCands(st.aberta);
        try { await enviar(`loja/vagas/candidaturas/${encodeURIComponent(id)}/status`, { status: novo }, "PUT"); ok("Status atualizado."); }
        catch (e) { erro(mensagem(e)); }
        st.ocupado.delete(id); if (st.aberta) await carregarCands(st.aberta);
    }
    async function abrirPdf(id) {
        try { await abrirPDF(`loja/vagas/candidaturas/${encodeURIComponent(id)}/curriculo`); }
        catch (e) { erro(e?.message || "Não foi possível abrir o currículo."); }
    }

    secao.addEventListener("click", (e) => {
        const g = (a) => e.target.closest(`[${a}]`); let el;
        if (g("data-vl-novo")) mostrarForm(true);
        else if (g("data-vl-cancelar")) mostrarForm(false);
        else if (g("data-vl-rascunho")) salvar(false);
        else if (g("data-vl-publicar")) salvar(true);
        else if ((el = g("data-vl-status"))) mudarStatusVaga(el.dataset.id, el.dataset.vlStatus);
        else if ((el = g("data-vl-cands"))) {
            const id = el.dataset.vlCands; st.aberta = st.aberta === id ? null : id;
            if (st.aberta && !st.cands.has(id)) carregarCands(id); pintar();
        }
        else if ((el = g("data-vl-cand"))) mudarStatusCand(el.dataset.vlCand, el.dataset.st);
        else if ((el = g("data-vl-pdf"))) abrirPdf(el.dataset.vlPdf);
    });
    montarForm();
    return { carregar };
}
