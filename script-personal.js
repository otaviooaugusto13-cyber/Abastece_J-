// ==========================================
// IMPORTAÇÕES DO FIREBASE (SDK Modular v10)
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, query, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Suas credenciais reais do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyA2PVDpo4X3G8ok_Mk5MU1WeRUaxwIhEpg",
    authDomain: "app-diego-e0591.firebaseapp.com",
    projectId: "app-diego-e0591",
    storageBucket: "app-diego-e0591.firebasestorage.app",
    messagingSenderId: "69109305372",
    appId: "1:69109305372:web:5139a52f1342671c520fd9",
    measurementId: "G-P2J3HHKK2R"
};

// Inicializa o Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Seu CPF de Administrador (Acesso liberado direto com status ativo)
const ADMIN_CPF = "11122233344";

// ==========================================
// ESTADO DO PERFIL, MENSAGENS E TARIFAS
// ==========================================

let dadosPerfil = {
    nome: "Professor",
    cref: "",
    cpf: "",
    bio: "",
    fotoUrl: null,
    tarifas: {
        normal: 60,
        surge: 85,
        discount: 45
    }
};

const bancoAlunosCadastrados = [
    { cpf: "12345678901", nome: "Lucas Silveira", objetivo: "Condicionamento Físico" },
    { cpf: "98765432100", nome: "Fernanda Lima", objetivo: "Emagrecimento" }
];

let conversaAtiva = null;

// ==========================================
// AUTENTICAÇÃO COM O GOOGLE
// ==========================================

async function loginComGoogle() {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;

        // Procura se o e-mail do Google já tem cadastro no Firestore
        const q = query(collection(db, "profissionais"), where("email", "==", user.email));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const profData = querySnapshot.docs[0].data();
            
            if (profData.status === "ativo") {
                dadosPerfil.nome = profData.nome || user.displayName;
                dadosPerfil.cpf = profData.cpf;
                dadosPerfil.cref = profData.cref;
                dadosPerfil.fotoUrl = user.photoURL;
                finalizarLogin(true, profData.nome, profData.cpf, profData.cref);
            } else if (profData.status === "pendente") {
                alert("⏳ Seu cadastro realizado via Google está EM ANÁLISE pela equipe TAPAGO.\n\nAssim que liberado, você poderá acessar o painel.");
            } else {
                alert("❌ Acesso não liberado para este e-mail.");
            }
        } else {
            // Se não encontrou pelo e-mail, solicita CPF e CREF para complementar a proposta
            const cpfInput = prompt("Login Google realizado com sucesso!\n\nPara concluir sua solicitação de Personal no TAPAGO, digite seu CPF (apenas números):");
            if (!cpfInput) return;

            const crefInput = prompt("Digite seu CREF (Ex: 123456-G/SP):");
            if (!crefInput) return;

            const cpf = cpfInput.replace(/\D/g, '');
            const cref = crefInput.trim();

            if (cpf.length < 11) {
                alert("CPF inválido. Operação cancelada.");
                return;
            }

            await setDoc(doc(db, "profissionais", cpf), {
                nome: user.displayName,
                email: user.email,
                cpf: cpf,
                cref: cref,
                fotoGoogle: user.photoURL,
                status: "pendente",
                criadoEm: new Date().toISOString()
            });

            alert("🚀 Solicitação enviada com sucesso com sua conta do Google!\n\nSeus dados estão em fila de análise em nossa base de dados.");
        }
    } catch (error) {
        console.error("Erro na autenticação com Google:", error);
        alert("Falha ao autenticar com o Google. Verifique se a janela de popup foi permitida pelo navegador.");
    }
}

// ==========================================
// INICIALIZAÇÃO E LOGIN TRADICIONAL
// ==========================================

window.addEventListener('DOMContentLoaded', () => {
    const savedProfile = localStorage.getItem('tapago_personal_user');
    if (savedProfile) {
        const parsed = JSON.parse(savedProfile);
        document.getElementById('input-nome').value = parsed.nome || '';
        document.getElementById('input-cpf').value = parsed.cpf || '';
        document.getElementById('input-cref').value = parsed.cref || '';
        document.getElementById('check-remember').checked = true;
    }
});

async function validarProfissional() {
    const nome = document.getElementById('input-nome').value.trim();
    const cpf = document.getElementById('input-cpf').value.replace(/\D/g, '');
    const cref = document.getElementById('input-cref').value.trim();
    const lembreme = document.getElementById('check-remember').checked;

    if (nome === "" || cpf === "" || cref === "") {
        alert("Preencha todos os campos obrigatórios.");
        return;
    }

    document.getElementById('login-loader').style.display = 'block';
    document.getElementById('btn-login').style.display = 'none';

    try {
        const regexCref = /\d+-G\/[A-Z]{2}/i; 
        
        if (cpf.length < 11) {
            alert("Erro: CPF inválido.");
            document.getElementById('login-loader').style.display = 'none';
            document.getElementById('btn-login').style.display = 'block';
            return;
        } else if (!regexCref.test(cref)) {
            alert("Erro: CREF formato incorreto. Ex: 123456-G/SP");
            document.getElementById('login-loader').style.display = 'none';
            document.getElementById('btn-login').style.display = 'block';
            return;
        }

        if (cpf === ADMIN_CPF) {
            dadosPerfil.nome = nome;
            dadosPerfil.cpf = cpf;
            dadosPerfil.cref = cref;

            await setDoc(doc(db, "profissionais", cpf), {
                nome, cpf, cref, status: "ativo", atualizadoEm: new Date()
            });

            finalizarLogin(lembreme, nome, cpf, cref);
            return;
        }

        const q = query(collection(db, "profissionais"), where("cpf", "==", cpf));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const profData = querySnapshot.docs[0].data();
            
            if (profData.status === "ativo") {
                dadosPerfil.nome = profData.nome;
                dadosPerfil.cpf = profData.cpf;
                dadosPerfil.cref = profData.cref;
                finalizarLogin(lembreme, profData.nome, cpf, cref);
            } else if (profData.status === "pendente") {
                document.getElementById('login-loader').style.display = 'none';
                document.getElementById('btn-login').style.display = 'block';
                alert("⏳ Seu cadastro já foi recebido e está EM ANÁLISE pela equipe TAPAGO.\n\nAssim que liberado, você conseguirá acessar o painel.");
            } else {
                document.getElementById('login-loader').style.display = 'none';
                document.getElementById('btn-login').style.display = 'block';
                alert("❌ Acesso não liberado. Entre em contato com o suporte.");
            }
        } else {
            await setDoc(doc(db, "profissionais", cpf), {
                nome: nome,
                cpf: cpf,
                cref: cref,
                status: "pendente",
                criadoEm: new Date().toISOString()
            });

            document.getElementById('login-loader').style.display = 'none';
            document.getElementById('btn-login').style.display = 'block';

            alert("🚀 Solicitação enviada com sucesso!\n\nSeus dados foram salvos e estão em fila de análise no banco de dados.");
        }
    } catch (error) {
        console.error("Erro na validação com Firebase:", error);
        document.getElementById('login-loader').style.display = 'none';
        document.getElementById('btn-login').style.display = 'block';
        alert("Erro de conexão com o banco de dados. Verifique o console.");
    }
}

function finalizarLogin(lembreme, nome, cpf, cref) {
    document.getElementById('login-loader').style.display = 'none';
    document.getElementById('btn-login').style.display = 'block';

    if (lembreme) {
        localStorage.setItem('tapago_personal_user', JSON.stringify({ nome, cpf, cref }));
    } else {
        localStorage.removeItem('tapago_personal_user');
    }

    atualizarExibicaoPerfil();
    document.getElementById('screen-login-personal').classList.remove('active');
    document.getElementById('screen-dashboard').classList.add('active');
    carregarAgendaDoBanco();
}

// ==========================================
// CONFIGURAÇÃO DE TARIFAS DE HORA/AULA
// ==========================================

function salvarTarifas() {
    const normal = parseFloat(document.getElementById('rate-normal').value) || 60;
    const surge = parseFloat(document.getElementById('rate-surge').value) || 85;
    const discount = parseFloat(document.getElementById('rate-discount').value) || 45;

    dadosPerfil.tarifas.normal = normal;
    dadosPerfil.tarifas.surge = surge;
    dadosPerfil.tarifas.discount = discount;
    alert("✅ Tabela de preços atualizada com sucesso!");
}

function abrirModalPricing(index) {
    indiceVagaSelecionada = index;
    document.getElementById('display-rate-normal').innerText = dadosPerfil.tarifas.normal;
    document.getElementById('display-rate-surge').innerText = dadosPerfil.tarifas.surge;
    document.getElementById('display-rate-discount').innerText = dadosPerfil.tarifas.discount;
    document.getElementById('modal-pricing').classList.add('active');
}

function fecharModalPricing() {
    document.getElementById('modal-pricing').classList.remove('active');
    indiceVagaSelecionada = null;
}

function confirmarVagaAvulsa(tipo) {
    if (indiceVagaSelecionada !== null) {
        let precoFinal = dadosPerfil.tarifas.normal;
        if (tipo === 'promocional') precoFinal = dadosPerfil.tarifas.discount;
        if (tipo === 'premium') precoFinal = dadosPerfil.tarifas.surge;

        agendaDeHoje[indiceVagaSelecionada].status = "livre";
        agendaDeHoje[indiceVagaSelecionada].preco = precoFinal;
        renderizarAgenda();
        fecharModalPricing();
        alert(`✅ Vaga liberada no Radar por R$ ${precoFinal},00.`);
    }
}

// ==========================================
// CADASTRO DE ALUNO POR CPF
// ==========================================

function abrirModalCadastrarAluno() {
    document.getElementById('modal-cadastrar-aluno').classList.add('active');
}

function fecharModalCadastrarAluno() {
    document.getElementById('modal-cadastrar-aluno').classList.remove('active');
    document.getElementById('cad-aluno-cpf').value = "";
    document.getElementById('cad-aluno-nome').value = "";
    document.getElementById('cad-aluno-objetivo').value = "";
    document.getElementById('status-cpf-busca').style.display = "none";
}

async function consultarCpfAluno() {
    const cpfDigitado = document.getElementById('cad-aluno-cpf').value.trim();
    const statusDiv = document.getElementById('status-cpf-busca');

    if (cpfDigitado.length === 11) {
        statusDiv.style.display = "block";
        statusDiv.innerText = "Consultando base de dados reais...";

        try {
            const q = query(collection(db, "usuarios"), where("cpf", "==", cpfDigitado));
            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                const alunoData = querySnapshot.docs[0].data();
                document.getElementById('cad-aluno-nome').value = alunoData.nome;
                document.getElementById('cad-aluno-objetivo').value = alunoData.objetivo || "Geral";
                statusDiv.innerText = "✓ Aluno localizado na nuvem TAPAGO!";
                statusDiv.style.color = "var(--neon-green)";
            } else {
                const alunoLocal = bancoAlunosCadastrados.find(a => a.cpf === cpfDigitado);
                if (alunoLocal) {
                    document.getElementById('cad-aluno-nome').value = alunoLocal.nome;
                    document.getElementById('cad-aluno-objetivo').value = alunoLocal.objetivo;
                    statusDiv.innerText = "✓ Aluno localizado na base local!";
                    statusDiv.style.color = "var(--neon-green)";
                } else {
                    statusDiv.innerText = "ℹ CPF não encontrado. Um pré-cadastro será gerado.";
                    statusDiv.style.color = "var(--gold)";
                }
            }
        } catch (e) {
            console.error("Erro na busca de aluno:", e);
        }
    }
}

async function confirmarCadastroAluno() {
    const nome = document.getElementById('cad-aluno-nome').value.trim();
    const objetivo = document.getElementById('cad-aluno-objetivo').value.trim();
    const cpf = document.getElementById('cad-aluno-cpf').value.trim();

    if (!nome) {
        alert("Digite o nome do aluno.");
        return;
    }

    const novoSlot = {
        hora: "12:00",
        aluno: nome,
        objetivo: objetivo || "Geral",
        status: "ocupado",
        cpfAluno: cpf
    };

    try {
        await addDoc(collection(db, "agenda"), novoSlot);
        agendaDeHoje.push(novoSlot);
        renderizarAgenda();
        fecharModalCadastrarAluno();
        alert(`🎉 Aluno ${nome} matriculado e salvo no Firestore!`);
    } catch (e) {
        console.error("Erro ao salvar no Firestore:", e);
        agendaDeHoje.push(novoSlot);
        renderizarAgenda();
        fecharModalCadastrarAluno();
        alert(`🎉 Aluno ${nome} matriculado localmente!`);
    }
}

// ==========================================
// CHAT COM ALUNOS
// ==========================================

function abrirConversa(nomeAluno) {
    conversaAtiva = nomeAluno;
    document.getElementById('chat-list-view').style.display = 'none';
    document.getElementById('chat-conversation-view').style.display = 'block';
    document.getElementById('chat-active-name').innerText = nomeAluno;
}

function fecharConversa() {
    document.getElementById('chat-list-view').style.display = 'block';
    document.getElementById('chat-conversation-view').style.display = 'none';
    conversaAtiva = null;
}

function enviarMensagemChat() {
    const input = document.getElementById('input-chat-msg');
    const texto = input.value.trim();

    if (texto === "") return;

    const chatBox = document.getElementById('chat-box');
    const horaAtual = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const msgDiv = document.createElement('div');
    msgDiv.className = 'msg msg-sent';
    msgDiv.innerHTML = `<p>${texto}</p><span class="msg-time">${horaAtual}</span>`;
    
    chatBox.appendChild(msgDiv);
    input.value = "";
    chatBox.scrollTop = chatBox.scrollHeight;

    setTimeout(() => {
        const replyDiv = document.createElement('div');
        replyDiv.className = 'msg msg-received';
        replyDiv.innerHTML = `<p>Perfeito, professor! Combinado.</p><span class="msg-time">${horaAtual}</span>`;
        chatBox.appendChild(replyDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    }, 1200);
}

// ==========================================
// FUNÇÕES DE PERFIL E TEMA
// ==========================================

function atualizarExibicaoPerfil() {
    const primeiraLetra = dadosPerfil.nome.charAt(0).toUpperCase();

    document.getElementById('nome-exibicao').innerText = dadosPerfil.nome;
    document.getElementById('perfil-nome-display').innerText = dadosPerfil.nome;
    document.getElementById('perfil-cref-display').innerText = `CREF: ${dadosPerfil.cref}`;
    
    document.getElementById('initials-header').innerText = primeiraLetra;
    document.getElementById('initials-perfil').innerText = primeiraLetra;

    if (dadosPerfil.fotoUrl) {
        document.getElementById('img-avatar-header').src = dadosPerfil.fotoUrl;
        document.getElementById('img-avatar-header').style.display = 'block';
        document.getElementById('initials-header').style.display = 'none';

        document.getElementById('img-perfil-preview').src = dadosPerfil.fotoUrl;
        document.getElementById('img-perfil-preview').style.display = 'block';
        document.getElementById('initials-perfil').style.display = 'none';
    }
}

function atualizarFotoPerfil(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            dadosPerfil.fotoUrl = e.target.result;
            atualizarExibicaoPerfil();
        };
        reader.readAsDataURL(file);
    }
}

function salvarBio() {
    dadosPerfil.bio = document.getElementById('input-bio').value;
    alert("✅ Biografia atualizada!");
}

function alternarTema() {
    document.body.classList.toggle('light-theme');
    const claro = document.body.classList.contains('light-theme');
    document.getElementById('label-tema').innerText = claro ? "Modo Claro Ativo" : "Modo Escuro Ativo";
    document.getElementById('icon-tema').innerText = claro ? "☀️" : "🌙";
}

function sairModoPessoal() {
    if (confirm("Deseja realmente sair da sua conta?")) {
        document.getElementById('screen-dashboard').classList.remove('active');
        document.getElementById('screen-login-personal').classList.add('active');
    }
}

// ==========================================
// GESTÃO DA AGENDA DE TREINOS
// ==========================================

let agendaDeHoje = [];
let indiceVagaSelecionada = null;
let ganhosAvulsos = 450;

async function carregarAgendaDoBanco() {
    try {
        const querySnapshot = await getDocs(collection(db, "agenda"));
        agendaDeHoje = [];
        
        querySnapshot.forEach((doc) => {
            agendaDeHoje.push(doc.data());
        });

        if (agendaDeHoje.length === 0) {
            agendaDeHoje = [
                { hora: "08:00", aluno: "Carlos Andrade", objetivo: "Hipertrofia", status: "ocupado" },
                { hora: "09:00", aluno: "Mariana Souza", objetivo: "Emagrecimento", status: "ocupado" },
                { hora: "10:00", aluno: "Roberto Costa", objetivo: "Força", status: "ocupado" },
                { hora: "11:00", aluno: "Vaga Livre", objetivo: "Disponível no Radar", status: "livre", preco: 85 }
            ];
        }

        renderizarAgenda();
    } catch (error) {
        console.error("Erro ao carregar agenda do Firestore:", error);
        agendaDeHoje = [
            { hora: "08:00", aluno: "Carlos Andrade", objetivo: "Hipertrofia", status: "ocupado" },
            { hora: "09:00", aluno: "Mariana Souza", objetivo: "Emagrecimento", status: "ocupado" },
            { hora: "10:00", aluno: "Roberto Costa", objetivo: "Força", status: "ocupado" },
            { hora: "11:00", aluno: "Vaga Livre", objetivo: "Disponível no Radar", status: "livre", preco: 85 }
        ];
        renderizarAgenda();
    }
}

function renderizarAgenda() {
    const lista = document.getElementById('lista-agenda');
    if (!lista) return;
    lista.innerHTML = ""; 

    agendaDeHoje.forEach((slot, index) => {
        const div = document.createElement('div');
        
        if (slot.status === "concluida") {
            div.className = `glass agenda-slot slot-concluida`;
            div.innerHTML = `
                <div class="slot-time">${slot.hora}</div>
                <div class="slot-info">
                    <div class="slot-info-name">${slot.aluno} (Check-in OK)</div>
                    <div class="slot-info-desc">Pagamento Liberado</div>
                </div>
            `;
        } else if (slot.status === "livre") {
            div.className = `glass agenda-slot slot-livre`;
            div.innerHTML = `
                <div class="slot-time">${slot.hora}</div>
                <div class="slot-info">
                    <div class="slot-info-name">VAGA ABERTA</div>
                    <div class="slot-info-desc">Radar Ativo: R$ ${slot.preco || dadosPerfil.tarifas.normal},00</div>
                </div>
                <div style="display:flex; flex-direction:column;">
                    <button class="btn-slot-action" onclick="cancelarVagaAvulsa(${index})">Cancelar</button>
                </div>
            `;
        } else {
            div.className = `glass agenda-slot slot-ocupado`;
            div.innerHTML = `
                <div class="slot-time">${slot.hora}</div>
                <div class="slot-info">
                    <div class="slot-info-name">${slot.aluno}</div>
                    <div class="slot-info-desc">Foco: ${slot.objetivo}</div>
                </div>
                <div style="display:flex; flex-direction:column; align-items:flex-end;">
                    <button class="btn-slot-action btn-qr" onclick="abrirQRCode(${index})">Check-in QR</button>
                    <button class="btn-slot-action" onclick="abrirModalPricing(${index})">Aluno Faltou</button>
                </div>
            `;
        }
        
        lista.appendChild(div);
    });
}

function cancelarVagaAvulsa(index) {
    agendaDeHoje[index].status = "ocupado";
    agendaDeHoje[index].aluno = "Horário Fechado";
    agendaDeHoje[index].objetivo = "Indisponível";
    renderizarAgenda();
}

function abrirQRCode(index) {
    indiceVagaSelecionada = index;
    document.getElementById('modal-qrcode').classList.add('active');
}

function fecharModalQRCode() {
    document.getElementById('modal-qrcode').classList.remove('active');
    indiceVagaSelecionada = null;
}

function simularLeituraQRCode() {
    if (indiceVagaSelecionada !== null) {
        agendaDeHoje[indiceVagaSelecionada].status = "concluida";
        renderizarAgenda();
        fecharModalQRCode();
        atualizarFinanceiro(dadosPerfil.tarifas.normal);
        alert("📸 Leitura de QR Code concluída! Aula validada e pagamento creditado.");
    }
}

function atualizarFinanceiro(valorAdicional) {
    ganhosAvulsos += valorAdicional;
    document.getElementById('valor-avulso').innerText = `R$ ${ganhosAvulsos}`;
    let total = 4200 + ganhosAvulsos;
    document.getElementById('valor-total').innerText = `R$ ${total.toLocaleString('pt-BR')}`;
}

function switchTabPersonal(tabId, navElement) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    const tabAlvo = document.getElementById(tabId);
    if (tabAlvo) tabAlvo.classList.add('active');
    
    document.querySelectorAll('#nav-personal .nav-item').forEach(item => item.classList.remove('active'));
    if (navElement) {
        navElement.classList.add('active');
    }
}

// ==========================================
// EXPOSIÇÃO GLOBAL DE FUNÇÕES - IMPORTANTE!
// ==========================================
window.validarProfissional = validarProfissional;
window.loginComGoogle = loginComGoogle;
window.salvarTarifas = salvarTarifas;
window.abrirModalPricing = abrirModalPricing;
window.fecharModalPricing = fecharModalPricing;
window.confirmarVagaAvulsa = confirmarVagaAvulsa;
window.abrirModalCadastrarAluno = abrirModalCadastrarAluno;
window.fecharModalCadastrarAluno = fecharModalCadastrarAluno;
window.consultarCpfAluno = consultarCpfAluno;
window.confirmarCadastroAluno = confirmarCadastroAluno;
window.abrirConversa = abrirConversa;
window.fecharConversa = fecharConversa;
window.enviarMensagemChat = enviarMensagemChat;
window.atualizarFotoPerfil = atualizarFotoPerfil;
window.salvarBio = salvarBio;
window.alternarTema = alternarTema;
window.sairModoPessoal = sairModoPessoal;
window.cancelarVagaAvulsa = cancelarVagaAvulsa;
window.abrirQRCode = abrirQRCode;
window.fecharModalQRCode = fecharModalQRCode;
window.simularLeituraQRCode = simularLeituraQRCode;
window.switchTabPersonal = switchTabPersonal;
