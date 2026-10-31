// ============================================================
// CONFIGURAÇÃO ÚNICA DO ABASTECE JÁ
// Tudo que você pode querer ajustar sem mexer no resto do código.
// ============================================================

// ---- Regras de negócio (VALORES PADRÃO) ---------------------
// Estes números são só o PADRÃO: semente inicial e plano B offline do app. Quem manda de verdade é o painel admin
// (Configurações → Taxas da plataforma), que grava em configuracoes/taxas no Firestore; o app busca em GET /config/taxas
// (taxas.js) e o servidor lê do banco (server/lib/taxas.js). Mudar valores NÃO exige editar código nem reiniciar.
// Padrão atual (centavos): loja paga R$ 200,00 = comissão R$ 50,00 + repasse R$ 150,00 (150/200 = 75%, não 80%).
// `npm test` ainda confere que este padrão é idêntico ao de server/split.js.
export const VALOR_DIARIA_CENTAVOS = 20000;
export const COMISSAO_PLATAFORMA_CENTAVOS = 5000;
export const REPASSE_PROFISSIONAL_CENTAVOS = 15000;
export const TAXA_FIXA_CENTAVOS = 0;                 // sem taxa extra para a loja
export const HORAS_MIN_TURNO = 4;                    // suposição de negócio: ajuste aqui e em server/split.js
export const HORAS_MAX_TURNO = 6;                    // limite estrito por turno
export const MAX_VEZES_SEMANA_LOJA = 3;              // máx. de turnos do mesmo promotor na mesma loja por semana

// ---- Níveis de confiabilidade (espelho de server/split.js; `npm test` falha se divergirem) ----
// Bronze (início) 25% · Prata (30 chamados) 20% · Ouro (+60) 15% · Platina (+100) 10% de comissão da plataforma.
export const CHAMADOS_PARA_SUBIR = [30, 60, 100];
const NIVEIS_BASE = [
    { id: "bronze", nome: "Bronze", comissaoPct: 25 },
    { id: "prata", nome: "Prata", comissaoPct: 20 },
    { id: "ouro", nome: "Ouro", comissaoPct: 15 },
    { id: "platina", nome: "Platina", comissaoPct: 10 }
];
export const NIVEIS = NIVEIS_BASE.map((n, i) => ({ ...n, minConcluidos: CHAMADOS_PARA_SUBIR.slice(0, i).reduce((a, b) => a + b, 0) }));

// ---- Geofencing / reputação / ruptura (o servidor decide; aqui só para exibir) ----
export const GEO_RAIO_METROS = 100;
export const CANCELAMENTO_TARDIO_HORAS = 12;                // espelho de server/lib/config.js
export const VIDAS_MAX = 3;
export const BONUS_RUPTURA_CENTAVOS = [2000, 3000, 5000];   // espelho de server/lib/config.js → RUPTURA.BONUS_OPCOES_CENTAVOS
export const FCM_VAPID_KEY = "";                            // Firebase Console → Configurações → Cloud Messaging → Certificados push da Web. Vazio = sem push com o app fechado.

// ---- Compliance de idade (o servidor valida de novo) --------
export const IDADE_MINIMA = 16;                      // cadastro permitido a partir dos 16 anos
export const IDADE_MAIORIDADE = 18;                  // 16–17: exige autorização do responsável legal
export const MENOR_JANELA_INICIO = "05:00";          // menores de 18: só turnos diurnos (espelho de server/lib/config.js)
export const MENOR_JANELA_FIM = "22:00";
export const MENOR_SETORES_VEDADOS = ["Frios & Laticínios", "Padaria", "Depósito", "Bebidas", "Montagem de ilhas"];

// ---- Ofertas por localização -------------------------------
export const RAIO_KM_OFERTAS = 20;                   // "Perto de mim": só vagas até 20 km da posição do promotor
export const LOCAL_MAX_IDADE_MS = 120_000;           // posição em cache aceita por até 2 min (economiza bateria)
export const LOCAL_MOVIMENTO_MIN_KM = 0.2;           // só recalcula o ranking se o promotor andou mais que 200 m

// ---- Eneagrama (teste do PRATICAMENTE) ----------------------
// Se o teste estiver hospedado (ex.: GitHub Pages), informe a URL https para ele abrir DENTRO do app (modal com iframe).
// O servidor precisa liberar a origem: defina ENEAGRAMA_TESTE_ORIGEM no Render com a mesma origem. Vazio = só seleção manual/código.
export const ENEAGRAMA_TESTE_URL = "";
export const ENEAGRAMA_TESTE_ORIGEM = (() => { try { return ENEAGRAMA_TESTE_URL ? new URL(ENEAGRAMA_TESTE_URL).origin : ""; } catch (e) { return ""; } })();

// ---- Empresa emissora da nota ------------------------------
// Aparece no cabeçalho da Nota de Serviço. Preencha com os dados reais.
export const EMPRESA = {
    razaoSocial: "ABASTECE JÁ INTERMEDIAÇÃO DE SERVIÇOS LTDA",
    cnpj: "00.000.000/0001-00",
    cidade: "Itapira / SP",
    email: "otaviooaugusto13@gmail.com"
};

// ---- Contato / suporte -------------------------------------
export const WHATSAPP_SUPORTE = "551995350637"; // só dígitos, com 55 + DDD
export const NOME_SUPORTE = "Suporte TI";        // nome que o usuário vê nas mensagens da equipe

// ---- Firebase (chave pública por natureza; segurança vem das regras) ----
const AUTH_DOMAIN_FIREBASE = "abastece-ja-240d5.firebaseapp.com";
const _hostApp = typeof location !== "undefined" && /^([\w-]+\.)*onrender\.com$/.test(location.hostname) ? location.host : null;
export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyA0Z1SEkqrtXuAjtFntv1WRvkKIuY1zilY",
    // signInWithRedirect: o domínio de autenticação precisa ser o MESMO do site (senão Chrome/Safari bloqueiam o armazenamento entre sites e o login "volta vazio").
    // No Render o servidor repassa /__/auth/* ao Firebase (server/lib/auth-proxy.js), então usamos o próprio host do site.
    authDomain: _hostApp || AUTH_DOMAIN_FIREBASE,
    projectId: "abastece-ja-240d5",
    storageBucket: "abastece-ja-240d5.firebasestorage.app",
    messagingSenderId: "1061248119348",
    appId: "1:1061248119348:web:90d82ea266683086a39061",
    measurementId: "G-8XFZ5ZGK4L"
};

// ---- Servidor de pagamentos (Render) ------------------------
// O servidor (server/server.js) também serve o site. Se o app está aberto em *.onrender.com
// ou em localhost, a API é a MESMA origem — assim nunca dá "Not Found" por URL digitada errada.
// Em qualquer outro domínio (GitHub Pages etc.), usa a URL fixa abaixo: confira no painel do
// Render o endereço EXATO do serviço (render.yaml cria "abastece-j", sem o "a" no final).
const URL_RENDER = "https://abastece-ja.onrender.com";
// Qualquer *.onrender.com serve o site E a API (é o mesmo Web Service): antes só "abastece-ja.onrender.com" era reconhecido, e quem abria
// o app pelo endereço real do serviço (ex.: "abastece-j", como no render.yaml) caía numa API de outro host (CORS/404 e sessão "perdida").
const mesmaOrigem = typeof location !== "undefined" && /^(([\w-]+\.)*onrender\.com|localhost|127\.0\.0\.1)$/.test(location.hostname);
export const FUNCTIONS_BASE = mesmaOrigem ? location.origin : URL_RENDER;

// ---- Cadastro de cartão (produção) ---------------------------
// Chave PÚBLICA da aplicação no Mercado Pago (Credenciais de produção → Public Key). Pode ficar no código.
// Sem ela, só o cartão de teste (modo sandbox) funciona. No servidor também é preciso MP_ACCESS_TOKEN.
export const MP_PUBLIC_KEY = "";

// ---- Emuladores locais do Firebase (só para testes; ver DEPLOY-RENDER.md) ----
// Abra o app com ?emulador=1 em localhost para usar Auth/Firestore locais.
export const USAR_EMULADOR = typeof location !== "undefined" && location.hostname === "localhost" && new URLSearchParams(location.search).has("emulador");

// ---- Rotas dos painéis ---------------------------------------
// URLs públicas: /painel-loja e /painel-promotor (o servidor Render e o Firebase Hosting as mapeiam para index.html / promotor.html).
// Hospedou o front SEM servidor/rewrites (GitHub Pages etc.)? Troque para false: usa os arquivos .html diretamente.
export const ROTAS_LIMPAS = true;
export const ROTAS = ROTAS_LIMPAS
    ? { loja: "/painel-loja", promotor: "/painel-promotor", admin: "/admin.html", ti: "/painel-ti" }
    : { loja: "index.html", promotor: "promotor.html", admin: "admin.html", ti: "ti.html" };
