// ============================================================
// ABASTECE JÁ — Envio do documento de identificação (RG/CNH) para aprovação do perfil.
// Funciona igual para loja e promotor (o servidor decide a coleção pelo papel do token).
// Todas as dependências entram por parâmetro: o módulo não importa Firebase, então é testável sem rede.
// ============================================================
const TIPOS = { rg: { rotulo: "RG", lados: ["frente", "verso"], obrigatorios: ["frente", "verso"] }, cnh: { rotulo: "CNH", lados: ["frente", "verso"], obrigatorios: ["frente"] } };
const AVISO = {
    nenhum: null,
    incompleto: { cls: "", ico: "📎", txt: "Falta enviar o restante do documento." },
    enviado: { cls: "", ico: "⏳", txt: "Documento em análise. Avisamos você assim que a equipe responder." },
    aprovado: { cls: "", ico: "✅", txt: "Documento aprovado. Seu perfil está verificado." },
    recusado: { cls: "red", ico: "⚠️", txt: "Documento recusado." }
};

/**
 * @param {object} d
 * @param {(caminho:string)=>Promise<any>} d.consultar          GET autenticado (ex.: consultar de firebase.js)
 * @param {(caminho:string, corpo:object)=>Promise<any>} d.enviar  POST autenticado (ex.: chamarFuncao)
 * @param {(arquivo:File)=>Promise<{foto:string}>} d.comprimir  File → JPEG comprimido (deArquivo de camera.js)
 * @param {(id:string)=>void} d.abrir @param {(id:string)=>void} d.fechar
 * @param {(msg:string)=>void} d.ok @param {(msg:string)=>void} d.erro
 */
export function iniciarDocumento({ consultar, enviar, comprimir, abrir, fechar, ok, erro, raiz = document }) {
    const $ = (id) => raiz.getElementById(id);
    const folha = $("sheet-documento"); if (!folha) return { abrir() {} };
    const st = { tipo: "rg", fotos: {}, enviadas: new Set(), status: "nenhum", motivo: "", ocupado: false };

    const slot = (lado) => $(`slot-${lado}`);
    const obrigatorios = () => TIPOS[st.tipo].obrigatorios;
    const pendentesDeEnvio = () => Object.keys(st.fotos);                                   // lados escolhidos agora
    const completo = () => obrigatorios().every((l) => st.fotos[l] || st.enviadas.has(l));
    const bloqueado = () => st.status === "aprovado" || st.status === "enviado" && pendentesDeEnvio().length === 0;

    function pintarSlots() {
        for (const lado of ["frente", "verso"]) {
            const s = slot(lado), tem = !!st.fotos[lado] || st.enviadas.has(lado);
            s.classList.toggle("tem-foto", tem);
            s.querySelector(".doc-prev").style.backgroundImage = st.fotos[lado] ? `url(${st.fotos[lado]})` : "";
            const facultativo = !obrigatorios().includes(lado);
            s.querySelector("small").textContent = tem ? (st.fotos[lado] ? "Toque para trocar" : "Enviado ✓") : facultativo ? "Opcional · toque para fotografar" : "Toque para fotografar";
            s.querySelector("input").disabled = st.status === "aprovado";
        }
    }
    function pintarStatus() {
        const b = $("doc-status"), a = AVISO[st.status];
        if (!a) { b.hidden = true; return; }
        b.hidden = false; b.className = `banner mb ${a.cls}`.trim();
        b.textContent = "";
        const ico = Object.assign(document.createElement("span"), { className: "ico", textContent: a.ico });
        const txt = document.createElement("div"); txt.textContent = a.txt + (st.status === "recusado" && st.motivo ? ` Motivo: ${st.motivo}` : "");   // textContent: nada do servidor vira HTML
        b.append(ico, txt);
    }
    function pintar() {
        for (const b of folha.querySelectorAll("[data-tipo]")) { const on = b.dataset.tipo === st.tipo; b.classList.toggle("sel", on); b.setAttribute("aria-checked", String(on)); b.disabled = st.status === "aprovado"; }
        $("slot-verso").querySelector("strong").textContent = st.tipo === "cnh" ? "Verso (opcional)" : "Verso";
        pintarStatus(); pintarSlots();
        const btn = $("doc-enviar");
        btn.disabled = st.ocupado || bloqueado() || !completo() || pendentesDeEnvio().length === 0;
        btn.textContent = st.ocupado ? "Enviando…" : st.status === "aprovado" ? "Documento aprovado ✓" : st.status === "enviado" && !pendentesDeEnvio().length ? "Em análise" : "Enviar para análise";
    }

    async function carregar() {
        try {
            const e = await consultar("perfil/documento");
            st.status = e.status || "nenhum"; st.motivo = e.motivo || ""; st.enviadas = new Set(e.lados || []);
            if (e.tipo && TIPOS[e.tipo]) st.tipo = e.tipo;
        } catch { /* sem conexão: o formulário continua utilizável */ }
        st.fotos = {}; $("doc-erro").textContent = ""; pintar();
    }

    folha.addEventListener("change", async (e) => {
        const inp = e.target.closest("input[type=file][data-lado]"); if (!inp) return;
        const lado = inp.dataset.lado, arq = inp.files?.[0]; inp.value = ""; if (!arq) return;
        $("doc-erro").textContent = "";
        try { const r = await comprimir(arq); st.fotos[lado] = r.foto; }
        catch (x) { $("doc-erro").textContent = x.message || "Não foi possível ler a foto."; }
        pintar();
    });
    folha.addEventListener("click", (e) => {
        const t = e.target.closest("[data-tipo]"); if (!t || t.disabled) return;
        if (t.dataset.tipo !== st.tipo) { st.tipo = t.dataset.tipo; st.fotos = {}; st.enviadas = new Set(); pintar(); }   // trocar o tipo recomeça: o servidor também descarta o anterior
    });
    $("doc-enviar").addEventListener("click", async () => {
        if (st.ocupado) return; st.ocupado = true; $("doc-erro").textContent = ""; pintar();
        try {
            for (const lado of TIPOS[st.tipo].lados) {
                if (!st.fotos[lado]) continue;
                const r = await enviar(`perfil/documento/${lado}`, { tipo: st.tipo, foto: st.fotos[lado] });   // um lado por requisição: cada foto cabe no limite de corpo da API
                st.enviadas.add(lado); delete st.fotos[lado]; st.status = r.status || st.status;
            }
            ok(st.status === "enviado" ? "Documento enviado para análise." : "Foto enviada. Falta o restante.");
            await carregar();
            if (st.status === "enviado") fechar("sheet-documento");
        } catch (x) { $("doc-erro").textContent = x.message || "Não foi possível enviar. Tente de novo."; erro?.(x.message || "Falha no envio."); }
        finally { st.ocupado = false; pintar(); }
    });

    return { async abrir() { abrir("sheet-documento"); await carregar(); } };
}
