// ==========================================================================
// ABASTECE JÁ — chat em tempo real por pedido (loja ⇄ promotor)
// Mensagens ficam em solicitacoes/{id}/mensagens. Só as duas partes leem/escrevem.
// ==========================================================================
import { collection, addDoc, query, orderBy, limitToLast, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db, auth, $, esc, toast } from "./comum.js";

let unsub = null;

function garantirModal() {
    if ($("modal-chat-pedido")) return;
    const m = document.createElement("div");
    m.id = "modal-chat-pedido"; m.className = "app-overlay"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); m.setAttribute("aria-labelledby", "chat-titulo");
    m.innerHTML = `<div class="glass modal-box chat-box-wrap">
        <div class="chat-head"><div><h3 id="chat-titulo"></h3><small id="chat-sub" class="muted-line"></small></div><button class="chat-close" aria-label="Fechar chat" id="chat-fechar">✕</button></div>
        <div id="chat-msgs" class="chat-msgs" aria-live="polite"></div>
        <div class="chat-send"><input id="chat-input" type="text" maxlength="500" placeholder="Digite sua mensagem…" autocomplete="off"><button id="chat-enviar" class="btn btn-primary" aria-label="Enviar">➤</button></div>
    </div>`;
    document.body.appendChild(m);
    $("chat-fechar").onclick = fecharChat;
    m.addEventListener("click", (e) => { if (e.target === m) fecharChat(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharChat(); });
}

export function fecharChat() {
    if (unsub) { unsub(); unsub = null; }
    const m = $("modal-chat-pedido"); if (m) m.classList.remove("active");
}

export function abrirChat(pedidoId, titulo, subtitulo = "") {
    if (!auth.currentUser) return toast("Faça login primeiro.", "erro");
    garantirModal();
    $("chat-titulo").textContent = titulo; $("chat-sub").textContent = subtitulo;
    $("modal-chat-pedido").classList.add("active");
    const box = $("chat-msgs"); box.innerHTML = '<div class="skeleton sk-line"></div><div class="skeleton sk-line short"></div>';
    const meuUid = auth.currentUser.uid;
    const col = collection(db, "solicitacoes", pedidoId, "mensagens");
    if (unsub) unsub();
    unsub = onSnapshot(query(col, orderBy("criadoEm"), limitToLast(100)), (snap) => {
        box.innerHTML = snap.empty ? '<p class="muted-line" style="text-align:center;margin-top:20px">Nenhuma mensagem ainda. Combine detalhes do turno por aqui. 👋</p>' :
            snap.docs.map((d) => { const x = d.data(); const h = x.criadoEm?.toDate?.().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) || "";
                return `<div class="msg ${x.de === meuUid ? "msg-sent" : "msg-received"}">${esc(x.texto)}<small>${h}</small></div>`; }).join("");
        box.scrollTop = box.scrollHeight;
    }, () => { box.innerHTML = '<p class="muted-line" style="text-align:center">Não foi possível carregar o chat.</p>'; });

    const enviar = async () => {
        const inp = $("chat-input"), texto = inp.value.trim();
        if (!texto) return;
        inp.value = "";
        try { await addDoc(col, { de: meuUid, texto, criadoEm: serverTimestamp() }); }
        catch (e) { console.error(e); inp.value = texto; toast("Mensagem não enviada. Tente de novo.", "erro"); }
    };
    $("chat-enviar").onclick = enviar;
    $("chat-input").onkeydown = (e) => { if (e.key === "Enter") enviar(); };
    setTimeout(() => $("chat-input").focus(), 50);
}
