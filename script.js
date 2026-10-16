// Variáveis Globais
let userNameLogado = 'Promotor';
let mapRadar;
let userMarker;

// Banco de Lojas e Supermercados na Região
const lojasDB = [
    {
        nome: "Supermercado Central",
        especialidade: "Reposição de Gôndolas & Limpeza",
        lat: -22.4350,
        lng: -46.8220,
        elementId: "dist-roberto"
    },
    {
        nome: "Atacadão Bom Preço",
        especialidade: "Organização de Hortifrúti & Estoque",
        lat: -22.4430,
        lng: -46.8310,
        elementId: "dist-livia"
    }
];

// ==========================================
// GOOGLE MAPS & CÁLCULO DE DISTÂNCIA
// ==========================================

function initMap() {
    const mapaElemento = document.getElementById("mapa-quadrado");
    if (!mapaElemento) return;

    const pontoInicial = { lat: -22.4389, lng: -46.8258 }; // Itapira/SP

    mapRadar = new google.maps.Map(mapaElemento, {
        zoom: 14,
        center: pontoInicial,
        disableDefaultUI: true,
        styles: [
            { elementType: "geometry", stylers: [{ color: "#1a1a24" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a24" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
            { featureType: "road", elementType: "geometry", stylers: [{ color: "#2c2c38" }] },
            { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212123" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] }
        ]
    });

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (posicao) => {
                const localAluno = {
                    lat: posicao.coords.latitude,
                    lng: posicao.coords.longitude
                };

                mapRadar.setCenter(localAluno);

                userMarker = new google.maps.Marker({
                    position: localAluno,
                    map: mapRadar,
                    title: "Você",
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 7,
                        fillColor: "#39ff14",
                        fillOpacity: 1,
                        strokeWeight: 2,
                        strokeColor: "#ffffff"
                    }
                });

                lojasDB.forEach(loja => {
                    const localLoja = new google.maps.LatLng(loja.lat, loja.lng);
                    const posAluno = new google.maps.LatLng(localAluno.lat, localAluno.lng);

                    const metros = google.maps.geometry.spherical.computeDistanceBetween(posAluno, localLoja);
                    
                    let textoFormatado = "";
                    if (metros < 1000) {
                        textoFormatado = `${Math.round(metros)}m de você`;
                    } else {
                        textoFormatado = `${(metros / 1000).toFixed(1)}km de você`;
                    }

                    const pMarker = new google.maps.Marker({
                        position: { lat: loja.lat, lng: loja.lng },
                        map: mapRadar,
                        title: loja.nome
                    });

                    const infoWindow = new google.maps.InfoWindow({
                        content: `<div style="color:#000; font-weight:bold; padding:2px;">${loja.nome}<br><span style="font-weight:normal; font-size:11px;">📍 ${textoFormatado}</span></div>`
                    });

                    pMarker.addListener("click", () => {
                        infoWindow.open(mapRadar, pMarker);
                    });

                    const elem = document.getElementById(loja.elementId);
                    if (elem) elem.innerText = textoFormatado;
                });
            },
            () => {
                carregarMarcadoresPadrao(pontoInicial);
            }
        );
    } else {
        carregarMarcadoresPadrao(pontoInicial);
    }
}

function carregarMarcadoresPadrao(pontoInicial) {
    lojasDB.forEach(l => {
        new google.maps.Marker({
            position: { lat: l.lat, lng: l.lng },
            map: mapRadar,
            title: l.nome
        });
        const elem = document.getElementById(l.elementId);
        if (elem) elem.innerText = "Aprox. 1.2km de você";
    });
}

// ==========================================
// LOGIN E NAVEGAÇÃO
// ==========================================

function simulateLogin() {
    const inputName = document.getElementById('input-name').value.trim();
    if (inputName !== "") {
        userNameLogado = inputName;
    }

    document.getElementById('display-name-home').innerText = userNameLogado;
    document.getElementById('display-name-profile').innerText = userNameLogado;
    document.getElementById('main-user-avatar').innerText = userNameLogado.charAt(0).toUpperCase();
    document.getElementById('display-avatar-profile').innerText = userNameLogado.charAt(0).toUpperCase();

    navTo('screen-main');

    document.getElementById('skeleton-area').style.display = 'flex';
    document.getElementById('home-content').style.display = 'none';
    setTimeout(() => {
        document.getElementById('skeleton-area').style.display = 'none';
        document.getElementById('home-content').style.display = 'block';
    }, 1000);
}

function navTo(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function switchTab(tabId, navElement) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    if (navElement) navElement.classList.add('active');
}

function toggleTheme() {
    if (document.getElementById('theme-toggle').checked) {
        document.body.classList.add('light-theme');
    } else {
        document.body.classList.remove('light-theme');
    }
}

// ==========================================
// AVALIAÇÕES DAS LOJAS
// ==========================================

let dbAvaliacoes = {
    "Supermercado Central": [
        { autor: "Carlos S.", data: "2 dias atrás", texto: "Supermercado organizado, pagamento liberado logo após o check-out." }
    ],
    "Atacadão Bom Preço": [
        { autor: "Mariana R.", data: "Semana passada", texto: "Equipe da loja muito prestativa, excelente para tirar renda extra." }
    ]
};

let currentViewingTrainer = "";

function openTrainerProfile(nomeLoja) {
    currentViewingTrainer = nomeLoja;
    
    document.getElementById('tp-name').innerText = nomeLoja;
    document.getElementById('tp-avatar').innerText = nomeLoja === "Atacadão Bom Preço" ? "AB" : "SC";
    document.getElementById('tp-spec').innerText = nomeLoja === "Atacadão Bom Preço" ? "Organização de Hortifrúti & Estoque" : "Reposição de Gôndolas & Limpeza";
    
    renderReviews();
    document.getElementById('trainer-profile-overlay').classList.add('active');
}

function closeTrainerProfile() {
    document.getElementById('trainer-profile-overlay').classList.remove('active');
}

function renderReviews() {
    const listaArea = document.getElementById('reviews-list');
    listaArea.innerHTML = "";
    
    const avaliacoes = dbAvaliacoes[currentViewingTrainer] || [];
    
    if (avaliacoes.length === 0) {
        listaArea.innerHTML = "<p style='color: var(--text-muted); font-size: 13px;'>Nenhuma avaliação cadastrada ainda.</p>";
        return;
    }
    
    avaliacoes.forEach(av => {
        const div = document.createElement('div');
        div.className = 'review-card';
        div.innerHTML = `
            <div class="review-header">
                <span class="review-author">${av.autor}</span>
                <span class="review-date">${av.data}</span>
            </div>
            <div style="color: var(--gold); font-size: 10px; margin-bottom: 5px;">⭐⭐⭐⭐⭐</div>
            <div class="review-text">${av.texto}</div>
        `;
        listaArea.appendChild(div);
    });
}

function submitReview() {
    const textArea = document.getElementById('new-review-text');
    const texto = textArea.value.trim();
    
    if (texto === "") {
        alert("Escreva sua avaliação antes de publicar.");
        return;
    }
    
    if (!dbAvaliacoes[currentViewingTrainer]) {
        dbAvaliacoes[currentViewingTrainer] = [];
    }
    
    dbAvaliacoes[currentViewingTrainer].unshift({
        autor: userNameLogado + " (Você)",
        data: "Agora mesmo",
        texto: texto
    });
    
    textArea.value = "";
    renderReviews();
}

// ==========================================
// CHAT EM TEMPO REAL
// ==========================================

function openActiveChat(nomeLoja) {
    document.getElementById('active-chat-name').innerText = nomeLoja;
    document.getElementById('active-chat-avatar').innerText = nomeLoja === "Atacadão Bom Preço" ? "AB" : "SC";
    document.getElementById('active-chat-screen').classList.add('active');
    
    const msgsArea = document.getElementById('chat-messages');
    msgsArea.innerHTML = ''; 
    
    setTimeout(() => {
        const mensagemInicial = nomeLoja === 'Atacadão Bom Preço' 
            ? "Olá! Precisamos de reforço na reposição de hortifrúti hoje. Confirma presença?" 
            : "Fala promotor! Seu turno de reposição está confirmado para amanhã.";
        appendMessage(mensagemInicial, 'trainer');
    }, 400);
}

function closeActiveChat() {
    document.getElementById('active-chat-screen').classList.remove('active');
}

function handleEnter(event) {
    if (event.key === 'Enter') sendMessage();
}

function sendMessage() {
    const input = document.getElementById('chat-message-input');
    const texto = input.value.trim();
    if (texto === "") return;
    
    appendMessage(texto, 'user');
    input.value = '';
    
    setTimeout(() => {
        const respostas = [
            "Combinado! Te aguardo na entrada de funcionários.",
            "Perfeito, plantão aceito com sucesso!",
            "Show! Qualquer dúvida é só chamar no rádio da loja."
        ];
        const sorteada = respostas[Math.floor(Math.random() * respostas.length)];
        appendMessage(sorteada, 'trainer');
    }, 1200);
}

function appendMessage(texto, tipo) {
    const msgsArea = document.getElementById('chat-messages');
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble bubble-${tipo}`;
    bubble.innerText = texto;
    msgsArea.appendChild(bubble);
    msgsArea.scrollTop = msgsArea.scrollHeight;
}
// No final de script.js:
window.loginGoogleAluno = loginGoogleAluno;
window.logoutAluno = logoutAluno;
window.navTo = navTo;
window.switchTab = switchTab;
window.toggleTheme = toggleTheme;
