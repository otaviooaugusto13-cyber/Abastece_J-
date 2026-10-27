import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth, db, googleProvider } from "./firebase.js";
import { EMPRESA } from "./config.js";
import { brl, esc, fmtData, fmtDataHora, mascaraDoc, soDigitos } from "./core.js";
import { $, iniciarTema, registrarSW } from "./ui.js";
iniciarTema(); registrarSW();

const id = new URLSearchParams(location.search).get("id");
const mostrar = (q) => { $("estado").hidden = q !== "estado"; $("login").hidden = q !== "login"; $("nota").hidden = q !== "nota"; $("acoes").hidden = q !== "nota"; };
const falha = (t) => { $("estado").hidden = false; $("estado").innerHTML = `<span>${esc(t)} <a href="index.html">Voltar ao painel</a></span>`; $("login").hidden = $("nota").hidden = $("acoes").hidden = true; };
const METODO = { bank_transfer: "Pix", pix: "Pix", credit_card: "Cartão de crédito", debit_card: "Cartão de débito", account_money: "Saldo Mercado Pago", ticket: "Boleto" };
const docFmt = (d) => (d ? mascaraDoc(d) : "—");
// CPF do prestador aparece parcialmente (privacidade); CNPJ aparece completo.
const docPrestador = (d) => { if (String(d || "").includes("*")) return String(d).replace(/\*/g, "•"); const x = soDigitos(d); return x.length === 11 ? `•••.${x.slice(3, 6)}.${x.slice(6, 9)}-••` : docFmt(x); };

$("btn-imprimir").onclick = () => window.print();
$("btn-entrar").onclick = () => signInWithPopup(auth, googleProvider).catch(() => {});

onAuthStateChanged(auth, async (u) => {
    if (!id) return falha("Link inválido: nota não encontrada.");
    if (!u) return mostrar("login");
    mostrar("estado");
    try {
        const s = await getDoc(doc(db, "notas", id));
        if (!s.exists()) return falha("Nota não encontrada.");
        render(s.data());
    } catch (e) {
        console.error(e);
        falha(e.code === "permission-denied" ? "Esta nota pertence a outra conta. Entre com a conta da loja." : "Não foi possível carregar a nota.");
    }
});

function render(n) {
    const v = n.valores || {}, t = n.tomador || {}, p = n.prestador || {}, sv = n.servico || {}, pg = n.pagamento || {};
    document.title = `Nota ${n.numeroFmt} — Abastece Já`;
    $("nota").innerHTML = `
        <div class="cab">
            <div><h1>${esc(EMPRESA.razaoSocial)}</h1><p>CNPJ ${esc(EMPRESA.cnpj)} · ${esc(EMPRESA.cidade)}</p><p>${esc(EMPRESA.email)}</p></div>
            <div class="num"><span>NOTA DE SERVIÇO · SÉRIE ${esc(n.serie || "A1")}</span><strong>Nº ${esc(n.numeroFmt)}</strong><span>Emitida em ${esc(fmtDataHora(n.emitidaEm))}</span><br><span class="selo-pago">PAGO</span></div>
        </div>
        <div class="grade">
            <div class="bloco"><h3>Tomador (contratante)</h3><p><strong>${esc(t.razaoSocial || "—")}</strong></p><p>${esc(docFmt(t.documento))}</p><p>${esc(t.endereco || "")}</p><p>${esc(t.email || "")}</p></div>
            <div class="bloco"><h3>Prestador (profissional autônomo)</h3><p><strong>${esc(p.nome || "—")}</strong></p><p>${esc(docPrestador(p.documento))}</p></div>
        </div>
        <div class="bloco"><h3>Serviço</h3>
            <table>
                <thead><tr><th>Descrição</th><th class="r">Valor</th></tr></thead>
                <tbody>
                    <tr><td><strong>${esc(sv.descricao || "Reposição/abastecimento")}</strong><br><span style="color:#555">${esc(sv.loja || "")} · ${esc(fmtData(sv.data))} · ${esc(sv.horario || "")}</span></td><td class="r">${brl(v.valor)}</td></tr>
                    <tr><td>Taxa de serviço</td><td class="r">${brl(v.taxaFixa)}</td></tr>
                </tbody>
                <tfoot><tr><td>Total pago</td><td class="r">${brl(v.total)}</td></tr></tfoot>
            </table>
        </div>
        <div class="bloco"><h3>Pagamento</h3><p>Forma: ${esc(METODO[pg.metodo] || pg.metodo || "—")}${pg.simulado ? " (pagamento de teste)" : ""}</p><p>Mercado Pago nº ${esc(pg.mpPaymentId || "—")}</p></div>
        <div class="aviso"><strong>Importante:</strong> este documento é um comprovante de serviço emitido pela plataforma e não substitui a NFS-e ou nota fiscal do prestador, quando exigida. Consulte sua contabilidade.</div>
        <p class="rodape">Documento gerado eletronicamente. Código: ${esc(id)}</p>`;
    mostrar("nota");
}
