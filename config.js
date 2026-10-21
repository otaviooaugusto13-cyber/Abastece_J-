// ============================================================
// CONFIGURAÇÃO ÚNICA DO ABASTECE JÁ
// Tudo que você pode querer ajustar sem mexer no resto do código.
// ============================================================

// ---- Regras de negócio -------------------------------------
// Modelo (por turno):
//   Promotor recebe (líquido) = horas × VALOR_HORA_PROMOTOR_CENTAVOS (R$ 35,00/h)
//   Valor bruto do serviço    = valor que fecha com o líquido do promotor depois do royalty
//   Royalty da plataforma     = ROYALTY_PCT (3%) do valor bruto
//   Loja paga                 = valor bruto + taxa de serviço fixa (R$ 5,00)
//
// IMPORTANTE: a mesma regra precisa existir em server/split.js (o servidor é quem manda
// de verdade; functions/split.js e split.js são cópias). `node test/split.test.js` falha se divergirem.
export const ROYALTY_PCT = 3;                        // % do valor bruto que fica com a plataforma
export const TAXA_FIXA_CENTAVOS = 500;               // taxa de serviço fixa por turno (R$ 5,00)
export const VALOR_HORA_PROMOTOR_CENTAVOS = 3500;    // R$ 35,00/h líquido para o promotor (antes: R$ 25,00)
export const HORAS_MAX_TURNO = 6;                    // limite estrito por turno
export const MAX_VEZES_SEMANA_LOJA = 3;              // máx. de turnos do mesmo promotor na mesma loja por semana
export const VALOR_MINIMO_CENTAVOS = 3000;           // turno mínimo: R$ 30,00 (valor bruto)
export const VALOR_MAXIMO_CENTAVOS = 200000;

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

// ---- Firebase (chave pública por natureza; segurança vem das regras) ----
export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyA0Z1SEkqrtXuAjtFntv1WRvkKIuY1zilY",
    authDomain: "abastece-ja-240d5.firebaseapp.com",
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
const URL_RENDER = "https://abastece-j.onrender.com";
const mesmaOrigem = typeof location !== "undefined" && /(^|\.)onrender\.com$|^(localhost|127\.0\.0\.1)$/.test(location.hostname);
export const FUNCTIONS_BASE = mesmaOrigem ? location.origin : URL_RENDER;

// ---- Cadastro de cartão (produção) ---------------------------
// Chave PÚBLICA da aplicação no Mercado Pago (Credenciais de produção → Public Key). Pode ficar no código.
// Sem ela, só o cartão de teste (modo sandbox) funciona. No servidor também é preciso MP_ACCESS_TOKEN.
export const MP_PUBLIC_KEY = "";

// ---- Emuladores locais do Firebase (só para testes; ver DEPLOY-RENDER.md) ----
// Abra o app com ?emulador=1 em localhost para usar Auth/Firestore locais.
export const USAR_EMULADOR = typeof location !== "undefined" && location.hostname === "localhost" && new URLSearchParams(location.search).has("emulador");
