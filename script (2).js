// Variáveis Globais
let userNameLogado = 'Aluno';
let mapRadar;
let userMarker;

// Dados dos Personais Cadastrados (com coordenadas base na região)
const personaisDB = [
    {
        nome: "Prof. Roberto",
        especialidade: "Hipertrofia & Definição",
        lat: -22.4350,
        lng: -46.8220,
        elementId: "dist-roberto"
    },
    {
        nome: "Lívia",
        especialidade: "Emagrecimento & Funcional",
        lat: -22.4430,
        lng: -46.8310,
        elementId: "dist-livia"
    }
];

// ==========================================
// INTEGRAÇÃO GOOGLE MAPS & CÁLCULO DE DISTÂNCIA
// ==========================================

function initMap() {
    const mapaElemento = document.getElementById("mapa-quadrado");
    if (!mapaElemento) return;

    const pontoInicial = { lat: -22.4389, lng: -46.8258 }; // Coordenadas base (Itapira)

    // Inicializa o Google Maps em Dark Mode
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

    // Pega a geolocalização REAL do dispositivo do Aluno
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (posicao) => {
                const localAluno = {
                    lat: posicao.coords.latitude,
                    lng: posicao.coords.longitude
                };

                mapRadar.setCenter(localAluno);

                // Marcador do Aluno
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

                // Calcula a distância real para cada personal usando google.maps.geometry
                personaisDB.forEach(personal => {
                    const localPersonal = new google.maps.LatLng(personal.lat, personal.lng);
                    const posAluno = new google.maps.LatLng(localAluno.lat, localAluno.lng);

                    // Cálculo matemático feito diretamente pela API do Google
                    const metros = google.maps.geometry.spherical.computeDistanceBetween(posAluno, localPersonal);
                    
                    let textoFormatado = "";
                    if (metros < 1000) {
                        textoFormatado = `${Math.round(metros)}m de você`;
                    } else {
                        textoFormatado = `${(metros / 1000).toFixed(1)}km de você`;
                    }

                    // Adiciona pino do Personal no mapa
                    const pMarker = new google.maps.Marker({
                        position: { lat: personal.lat, lng: personal.lng },
                        map: mapRadar,
                        title: personal.nome
                    });

                    const infoWindow = new google.maps.InfoWindow({
                        content: `<div style="color:#000; font-weight:bold; padding:2px;">${personal.nome}<br><span style="font-weight:normal; font-size:11px;">📍 ${textoFormatado}</span></div>`
                    });

                    pMarker.addListener("click", () => {
                        infoWindow.open(mapRadar, pMarker);
                    });

                    // Atualiza o texto dinamicamente no card do HTML
                    const elem = document.getElementById(personal.elementId);
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
    personaisDB.forEach(p => {
        new google.maps.Marker({
            position: { lat: p.lat, lng: p.lng },
            map: mapRadar,
            title: p.nome
        });
        const elem = document.getElementById(p.elementId);
        if (elem) elem.innerText = "Aprox. 1.2km de você";
    });
}

// ==========================================
// LOGICA DE LOGIN E NAVEGACÃO
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

    // Efeito de Skeleton Loading ao entrar
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
// AVALIAÇÕES DO PROFISSIONAL
// ==========================================

let dbAvaliacoes = {
    "Prof. Roberto": [
        { autor: "Carlos A.", data: "2 dias atrás", texto: "Treino excelente! Foco em hipertrofia total." }
    ],
    "Lívia": [
        { autor: "Mariana S.", data: "Semana passada", texto: "Super atenciosa, montou meu plano de emagrecimento perfeitamente." }
    ]
};

let currentViewingTrainer = "";

function openTrainerProfile(nomeProfessor) {
    currentViewingTrainer = nomeProfessor;
    
    document.getElementById('tp-name').innerText = nomeProfessor;
    document.getElementById('tp-avatar').innerText = nomeProfessor.charAt(0);
    document.getElementById('tp-spec').innerText = nomeProfessor === "Lívia" ? "Emagrecimento & Funcional" : "Hipertrofia & Definição";
    
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
// CHAT EM TEMPO REAL (SIMULADO)
// ==========================================

function openActiveChat(nomeProfessor) {
    document.getElementById('active-chat-name').innerText = nomeProfessor;
    document.getElementById('active-chat-avatar').innerText = nomeProfessor.charAt(0);
    document.getElementById('active-chat-screen').classList.add('active');
    
    const msgsArea = document.getElementById('chat-messages');
    msgsArea.innerHTML = ''; 
    
    setTimeout(() => {
        const mensagemInicial = nomeProfessor === 'Lívia' 
            ? "Oi! Que ótimo te ver por aqui. Bora agendar seu treino?" 
            : "Fala campeão! Preparado para o treino de hoje?";
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
            "Fechado! Vou organizar aqui na minha agenda.",
            "Perfeito, te aguardo no horário combinado!",
            "Show! Qualquer dúvida é só me chamar aqui."
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