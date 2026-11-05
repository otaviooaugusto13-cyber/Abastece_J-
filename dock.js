// ============================================================
// ABASTECE JÁ — Dock flutuante (5 atalhos + botão central), bottom sheet do mapa e visões da aba Pedidos.
// Sem dependências: recebe a função de rota (irPara) do script do portal, então a regra de cada tela
// (ex.: ligar o GPS só nas ofertas) continua onde sempre esteve.
// ============================================================

/**
 * @param {object} o
 * @param {HTMLElement} o.dock          <nav class="dock">
 * @param {(id:string)=>void} o.irPara  função de rota do portal
 * @param {string} o.inicio             id da aba que é a Home (ganha body.home-ativa → mapa em tela cheia)
 * @param {Record<string,string>} [o.aliases]  abas secundárias que acendem outro ícone (ex.: { "tab-chat": "tab-pedidos" })
 * @param {()=>void} o.centro           ação do botão central
 * @param {(id:string)=>boolean} [o.centroAtivo]  true se o botão central deve aparecer "ligado" para essa aba
 * @param {(id:string)=>void} [o.aoMarcar]        gancho extra a cada troca de aba
 */
export function iniciarDock({ dock, irPara, inicio, aliases = {}, centro, centroAtivo = () => false, aoMarcar }) {
    document.body.classList.add("tem-dock");
    const itens = [...dock.querySelectorAll("[data-tab]")], fab = dock.querySelector("[data-acao='centro']");
    const vibrar = () => { try { navigator.vibrate?.(8); } catch { /* sem vibração */ } };

    function marcar(id) {
        const alvo = aliases[id] || id;
        for (const b of itens) {
            const on = b.dataset.tab === alvo;
            b.classList.toggle("is-active", on);
            if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
        }
        const fabOn = !!centroAtivo(id);
        fab?.classList.toggle("is-active", fabOn);
        if (fabOn) fab?.setAttribute("aria-current", "page"); else fab?.removeAttribute("aria-current");
        document.body.classList.toggle("home-ativa", id === inicio);
        aoMarcar?.(id);
    }
    dock.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b || !dock.contains(b)) return;
        vibrar();
        if (b.dataset.acao === "centro") centro(); else if (b.dataset.tab) irPara(b.dataset.tab);
    });
    return { marcar };
}

/** Aba Pedidos com duas visões: "novo" (formulário + promotores) e "lista" (andamento/pagos/conversas). */
export function iniciarVistaPedidos(raiz) {
    const novo = raiz.querySelector("#vista-novo"), lista = raiz.querySelector("#vista-lista");
    const mostrar = (modo) => { if (novo) novo.hidden = modo !== "novo"; if (lista) lista.hidden = modo === "novo"; raiz.dataset.vista = modo; };
    raiz.addEventListener("click", (e) => {
        const b = e.target.closest("[data-acao]"); if (!b) return;
        if (b.dataset.acao === "novo-pedido") mostrar("novo"); else if (b.dataset.acao === "ver-pedidos") mostrar("lista");
    });
    mostrar("lista");
    return { mostrar, atual: () => raiz.dataset.vista };
}

/**
 * Bottom sheet deslizável (aberto ↔ recolhido). Arrasto por Pointer Events (toque e mouse) na área .sm-topo;
 * o botão .sm-handle também alterna por clique/Enter/Espaço (acessível). Lembra, na sessão, que o convite já foi visto.
 */
export function iniciarSheetMapa(el, { dock } = {}) {
    const topo = el.querySelector(".sm-topo"), handle = el.querySelector(".sm-handle");
    const CHAVE = "abj-sheet-mapa-visto", MOVEU = 6;
    let estado = "aberto", y0 = 0, base = 0, t0 = 0, arrastando = false, moveu = false;
    const peek = () => { const d = dock?.getBoundingClientRect?.(); return (d && d.height ? window.innerHeight - d.top : 76) + 64; };   // sobra uma faixa acima do dock
    const oculto = () => Math.max(0, el.offsetHeight - peek());
    const lerVisto = () => { try { return sessionStorage.getItem(CHAVE) === "1"; } catch { return false; } };
    const gravarVisto = () => { try { sessionStorage.setItem(CHAVE, "1"); } catch { /* modo privado */ } };

    function ir(novo, { lembrar = true } = {}) {
        estado = novo; el.dataset.estado = novo;
        el.style.transform = novo === "aberto" ? "translateY(0)" : `translateY(${oculto()}px)`;
        handle.setAttribute("aria-expanded", String(novo === "aberto"));
        if (lembrar && novo === "recolhido") gravarVisto();
    }
    topo.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        arrastando = true; moveu = false; y0 = e.clientY; t0 = performance.now();
        base = estado === "aberto" ? 0 : oculto(); el.classList.add("arrastando");
    });
    topo.addEventListener("pointermove", (e) => {
        if (!arrastando) return;
        const dy = e.clientY - y0;
        // A captura do ponteiro só começa quando vira arrasto: capturar já no toque redirecionaria o "click" e a alça nunca receberia o toque simples.
        if (!moveu && Math.abs(dy) > MOVEU) { moveu = true; try { topo.setPointerCapture?.(e.pointerId); } catch { /* ponteiro já liberado */ } }
        el.style.transform = `translateY(${Math.min(oculto(), Math.max(0, base + dy))}px)`;
    });
    const soltar = (e) => {
        if (!arrastando) return; arrastando = false; el.classList.remove("arrastando");
        if (!moveu) return;                                              // foi um toque: o click do handle decide
        const dy = e.clientY - y0, v = dy / Math.max(1, performance.now() - t0);      // px/ms
        const pos = Math.min(oculto(), Math.max(0, base + dy));
        ir(v > 0.5 ? "recolhido" : v < -0.5 ? "aberto" : pos > oculto() / 2 ? "recolhido" : "aberto");
    };
    topo.addEventListener("pointerup", soltar); topo.addEventListener("pointercancel", soltar);
    handle.addEventListener("click", () => { if (moveu) { moveu = false; return; } ir(estado === "aberto" ? "recolhido" : "aberto"); });
    window.addEventListener("resize", () => ir(estado, { lembrar: false }));
    ir(lerVisto() ? "recolhido" : "aberto", { lembrar: false });
    return { abrir: () => ir("aberto"), recolher: () => ir("recolhido"), estado: () => estado };
}
