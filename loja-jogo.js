// Fluxos da loja ligados à camada de jogo: localização (GPS), marca, chamado relâmpago, auditoria da foto e reputação.
import { chamarFuncao, consultar, baixarBlobProtegido } from "./firebase.js";
import { esc, brl, SETORES } from "./core.js";
import { BONUS_RUPTURA_CENTAVOS, GEO_RAIO_METROS } from "./config.js";
import { $, ok, erro, abrir, fechar } from "./ui.js";
import { lerGPS } from "./geo.js";
import { coracoes, listaInfracoes } from "./gamificacao-ui.js";

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const SHEETS = `
<div id="sheet-local" class="app-overlay" aria-hidden="true"><div class="sheet"><div class="grab"></div>
  <div class="sub-head"><h2>Localização da loja</h2><button class="icon-btn" data-fechar="sheet-local" aria-label="Fechar">✕</button></div>
  <p class="muted small mb">É a partir dela que o promotor faz o check-in (a até ${GEO_RAIO_METROS} m). Faça isto <b>de dentro da loja</b>.</p>
  <button class="btn btn-ghost mb" id="lc-gps" type="button">📍 Usar o GPS deste aparelho</button>
  <p class="small" id="lc-gps-txt"></p>
  <div class="grid-2"><div class="field"><label for="lc-cidade">Cidade</label><input id="lc-cidade" type="text" maxlength="80" autocomplete="address-level2"></div>
  <div class="field"><label for="lc-uf">UF</label><select id="lc-uf">${UFS.map((u) => `<option>${u}</option>`).join("")}</select></div></div>
  <details class="mb"><summary class="small muted">Informar coordenadas manualmente</summary>
    <div class="grid-2 mt"><div class="field"><label for="lc-lat">Latitude</label><input id="lc-lat" type="text" inputmode="decimal" placeholder="-22.4358"></div><div class="field"><label for="lc-lng">Longitude</label><input id="lc-lng" type="text" inputmode="decimal" placeholder="-46.8216"></div></div></details>
  <p class="msg-erro" id="lc-erro" role="alert"></p>
  <button class="btn btn-primary" id="lc-salvar">Salvar localização</button>
</div></div>
<div id="sheet-ruptura" class="app-overlay" aria-hidden="true"><div class="sheet"><div class="grab"></div>
  <div class="sub-head"><h2>⚡ Chamado relâmpago</h2><button class="icon-btn" data-fechar="sheet-ruptura" aria-label="Fechar">✕</button></div>
  <p class="muted small mb">Gôndola vazia? Avisamos na hora os promotores habilitados <b>perto da sua loja</b>. O bônus de velocidade vai 100% para quem aceitar.</p>
  <div class="field"><label for="rp-loja">Loja (nome e endereço)</label><input id="rp-loja" type="text" maxlength="160"></div>
  <span class="lbl">Setor com ruptura</span><div class="chips mt" id="rp-setor" role="radiogroup" aria-label="Setor"></div>
  <span class="lbl mt">Bônus de velocidade</span>
  <div class="bonus-opcoes" role="radiogroup" aria-label="Bônus">${BONUS_RUPTURA_CENTAVOS.map((b, i) => `<label><input type="radio" name="rp-b" value="${b}" ${i === 1 ? "checked" : ""}>+ ${brl(b)}</label>`).join("")}</div>
  <div class="field"><label for="rp-obs">Observação (opcional)</label><input id="rp-obs" type="text" maxlength="200" placeholder="Ex: cerveja e refrigerante zerados"></div>
  <div class="split-card"><div class="linha"><span>Serviço (diária)</span><strong id="rp-v">—</strong></div><div class="linha"><span>Bônus</span><strong id="rp-b">—</strong></div><div class="linha total"><span>Você paga</span><strong id="rp-t">—</strong></div></div>
  <p class="muted small mt">O chamado expira em 30 minutos se ninguém aceitar (sem multa). Pagamento só depois do serviço.</p>
  <p class="msg-erro" id="rp-erro" role="alert"></p>
  <button class="btn btn-primary mt" id="rp-enviar">🚨 Disparar chamado</button>
</div></div>
<div id="sheet-audit" class="app-overlay" aria-hidden="true"><div class="sheet"><div class="grab"></div>
  <div class="sub-head"><h2>Foto da gôndola</h2><button class="icon-btn" data-fechar="sheet-audit" aria-label="Fechar">✕</button></div>
  <div class="camera-box" style="aspect-ratio:4/3"><img id="au-img" alt="Foto da gôndola reabastecida" hidden><p class="center muted" id="au-carr" style="padding:40px 10px">Carregando…</p></div>
  <p class="small muted mt" id="au-info"></p>
  <div id="au-form"><div class="gondola-opcoes"><label><input type="radio" name="au-r" value="aprovada" checked>👍 Está certo</label><label><input type="radio" name="au-r" value="contestada">⚠️ Contestar</label></div>
  <div class="field"><label for="au-com">Comentário (obrigatório ao contestar)</label><input id="au-com" type="text" maxlength="300"></div>
  <p class="msg-erro" id="au-erro" role="alert"></p><button class="btn btn-primary" id="au-enviar">Registrar avaliação</button></div>
</div></div>
<div id="sheet-rep-loja" class="app-overlay" aria-hidden="true"><div class="sheet"><div class="grab"></div>
  <div class="sub-head"><h2>Vidas da loja</h2><button class="icon-btn" data-fechar="sheet-rep-loja" aria-label="Fechar">✕</button></div><div id="rl-corpo"></div></div></div>`;

let C = null, audPedido = null, audUrl = null, setorRp = "";
export function iniciar(ctx) { C = ctx; if (!$("sheet-local")) document.body.insertAdjacentHTML("beforeend", SHEETS); ligar(); }

// ---------- reputação da loja ----------
export function pintarReputacao(r) {
    const el = $("rep-loja-home"); if (!el || !r) return;
    el.innerHTML = `<div class="vidas-linha"><div><b>Reputação da loja</b><div class="vidas-txt">Cancelar em cima da hora ou faltar gera advertência e multa. Com 3, a conta é bloqueada.</div></div><div style="text-align:right">${coracoes(r.vidas, r.vidasMax)}<div class="vidas-txt"><b>${r.vidas}</b> de ${r.vidasMax}</div></div></div>`;
    $("rl-corpo").innerHTML = `<div class="glass-card"><div class="vidas-linha"><h4>Vidas</h4>${coracoes(r.vidas, r.vidasMax)}</div><div class="mt">${listaInfracoes(r.infracoes)}</div></div>`;
}

// ---------- localização ----------
export const temLocal = (p) => Number.isFinite(p?.localizacao?.lat);
export function abrirLocal() {
    const l = C.perfil().localizacao || {}; $("lc-erro").textContent = ""; $("lc-gps-txt").textContent = temLocal(C.perfil()) ? `Atual: ${l.cidade || ""}/${l.uf || ""} (${Number(l.lat).toFixed(4)}, ${Number(l.lng).toFixed(4)})` : "";
    $("lc-cidade").value = l.cidade || ""; if (l.uf) $("lc-uf").value = l.uf; $("lc-lat").value = l.lat ?? ""; $("lc-lng").value = l.lng ?? ""; abrir("sheet-local");
}
async function salvarLocal() {
    const num = (v) => Number(String(v).replace(",", ".")), lat = num($("lc-lat").value), lng = num($("lc-lng").value), cidade = $("lc-cidade").value.trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || $("lc-lat").value === "") return ($("lc-erro").textContent = "Use o GPS ou informe as coordenadas.");
    if (cidade.length < 2) return ($("lc-erro").textContent = "Informe a cidade.");
    const b = $("lc-salvar"); b.disabled = true;
    try { const r = await chamarFuncao("loja/localizacao", { lat, lng, precisao: Number($("lc-gps").dataset.precisao) || undefined, cidade, uf: $("lc-uf").value }); C.setLocal(r.localizacao); ok("Localização salva ✓"); fechar("sheet-local"); }
    catch (e) { $("lc-erro").textContent = e.message || "Não foi possível salvar."; } finally { b.disabled = false; }
}

// ---------- chamado relâmpago ----------
function resumoRp() { const b = Number(document.querySelector('input[name="rp-b"]:checked')?.value || 0); $("rp-v").textContent = brl(20000); $("rp-b").textContent = "+ " + brl(b); $("rp-t").textContent = brl(20000 + b); }
function montarSetoresRp() { $("rp-setor").innerHTML = SETORES.map((s) => `<button type="button" class="chip${s.v === setorRp ? " sel" : ""}" role="radio" aria-checked="${s.v === setorRp}" data-rsetor="${esc(s.v)}"><span class="ico">${s.ico}</span>${esc(s.label)}</button>`).join(""); }
export function abrirRuptura() {
    if (!C.temCartao()) { abrir("sheet-cartao"); return erro("Cadastre um cartão para solicitar."); }
    if (!temLocal(C.perfil())) { abrirLocal(); return erro("Defina primeiro a localização da loja."); }
    setorRp = C.setor(); montarSetoresRp(); $("rp-loja").value = $("p-local").value || C.perfil().razaoSocial || ""; $("rp-erro").textContent = ""; resumoRp(); abrir("sheet-ruptura");
}
async function enviarRuptura() {
    const loja = $("rp-loja").value.trim(); if (loja.length < 3) return ($("rp-erro").textContent = "Informe o nome e endereço da loja.");
    const b = $("rp-enviar"); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Disparando…'; $("rp-erro").textContent = "";
    try {
        const r = await chamarFuncao("criarRuptura", { loja, foco: setorRp, bonusCentavos: Number(document.querySelector('input[name="rp-b"]:checked').value), observacao: $("rp-obs").value.trim(), marcaId: $("p-marca")?.value || undefined });
        ok(`Chamado disparado! ${r.destinatarios} promotor(es) avisado(s) perto de você.`); fechar("sheet-ruptura"); C.recarregar?.();
    } catch (e) {
        if (e.code === "localizacao-obrigatoria") { fechar("sheet-ruptura"); abrirLocal(); }
        $("rp-erro").textContent = e.message || "Não foi possível disparar o chamado.";
    } finally { b.disabled = false; b.textContent = "🚨 Disparar chamado"; }
}

// ---------- auditoria da foto ----------
export async function abrirAuditoria(p) {
    audPedido = p; $("au-img").hidden = true; $("au-carr").hidden = false; $("au-carr").textContent = "Carregando…"; $("au-erro").textContent = ""; $("au-com").value = "";
    $("au-form").hidden = !!p.auditoriaLoja; $("au-info").textContent = `${p.promotorNome || "Promotor"} declarou a gôndola ${p.checkout?.gondola === "cheia" ? "CHEIA" : "PARCIAL"}${p.checkout?.observacao ? ` · “${p.checkout.observacao}”` : ""}${p.auditoriaLoja ? ` · Sua avaliação: ${p.auditoriaLoja.resultado}` : ""}`; abrir("sheet-audit");
    try { if (audUrl) URL.revokeObjectURL(audUrl); audUrl = await baixarBlobProtegido(`execucao/foto/${encodeURIComponent(p.id)}`); $("au-img").src = audUrl; $("au-img").hidden = false; $("au-carr").hidden = true; }
    catch (e) { $("au-carr").textContent = "Não foi possível carregar a foto."; }
}
async function enviarAuditoria() {
    const r = document.querySelector('input[name="au-r"]:checked').value, com = $("au-com").value.trim();
    if (r === "contestada" && com.length < 5) return ($("au-erro").textContent = "Explique o que está errado (mín. 5 letras).");
    const b = $("au-enviar"); b.disabled = true;
    try { await chamarFuncao("auditarFoto", { solicitacaoId: audPedido.id, resultado: r, comentario: com }); ok("Avaliação registrada."); fechar("sheet-audit"); } catch (e) { $("au-erro").textContent = e.message || "Não foi possível registrar."; } finally { b.disabled = false; }
}

function ligar() {
    $("lc-gps").addEventListener("click", async () => {
        const b = $("lc-gps"); b.disabled = true; $("lc-gps-txt").textContent = "Lendo GPS…";
        try { const f = await lerGPS({ timeout: 20000 }); $("lc-lat").value = f.lat.toFixed(6); $("lc-lng").value = f.lng.toFixed(6); b.dataset.precisao = f.precisao; $("lc-gps-txt").textContent = `Posição lida (±${f.precisao} m). Confira a cidade e salve.`; }
        catch (e) { $("lc-gps-txt").textContent = e.message; } finally { b.disabled = false; }
    });
    $("lc-salvar").addEventListener("click", salvarLocal);
    $("rp-setor").addEventListener("click", (e) => { const b = e.target.closest("[data-rsetor]"); if (b) { setorRp = b.dataset.rsetor; montarSetoresRp(); } });
    document.querySelectorAll('input[name="rp-b"]').forEach((i) => i.addEventListener("change", resumoRp));
    $("rp-enviar").addEventListener("click", enviarRuptura); $("au-enviar").addEventListener("click", enviarAuditoria);
    $("sheet-audit").addEventListener("click", (e) => { if (e.target.closest("[data-fechar]") || e.target.id === "sheet-audit") { if (audUrl) { URL.revokeObjectURL(audUrl); audUrl = null; } } });
}
export const carregarMarcas = async () => { try { return await consultar("marcas"); } catch (e) { return []; } };
export { consultar };
