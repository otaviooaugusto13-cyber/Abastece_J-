// ============================================================
// CONFIGURAÇÃO ÚNICA DO ABASTECE JÁ
// Tudo que você pode querer ajustar sem mexer no resto do código.
// ============================================================

// ---- Regras de negócio -------------------------------------
// Modelo "diária" (valores em CENTAVOS; o servidor é quem manda — server/split.js; `npm test` falha se divergirem):
//   Loja paga               = R$ 200,00
//   Comissão da plataforma  = R$  50,00 (retida automaticamente)
//   Repasse ao profissional = R$ 150,00 (carteira digital)
// Atenção: 150/200 = 75% (não 80%). Os valores em reais são a fonte da verdade.
export const VALOR_DIARIA_CENTAVOS = 20000;
export const COMISSAO_PLATAFORMA_CENTAVOS = 5000;
export const REPASSE_PROFISSIONAL_CENTAVOS = 15000;
export const TAXA_FIXA_CENTAVOS = 0;                 // sem taxa extra para a loja
export const HORAS_MIN_TURNO = 4;                    // suposição de negócio: ajuste aqui e em server/split.js
export const HORAS_MAX_TURNO = 6;                    // limite estrito por turno
export const MAX_VEZES_SEMANA_LOJA = 3;              // máx. de turnos do mesmo promotor na mesma loja por semana

// ---- Compliance de idade (o servidor valida de novo) --------
export const IDADE_MINIMA = 16;                      // cadastro permitido a partir dos 16 anos
export const IDADE_MAIORIDADE = 18;                  // 16–17: exige autorização do responsável legal
export const MENOR_JANELA_INICIO = "05:00";          // menores de 18: só turnos diurnos (espelho de server/lib/config.js)
export const MENOR_JANELA_FIM = "22:00";
export const MENOR_SETORES_VEDADOS = ["Frios & Laticínios", "Bebidas", "Montagem de ilhas"];

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
const URL_RENDER = "https://abastece-ja.onrender.com";
const mesmaOrigem = typeof location !== "undefined" && /^(abastece-ja\.onrender\.com|localhost|127\.0\.0\.1)$/.test(location.hostname);
export const FUNCTIONS_BASE = mesmaOrigem ? location.origin : URL_RENDER;

// ---- Cadastro de cartão (produção) ---------------------------
// Chave PÚBLICA da aplicação no Mercado Pago (Credenciais de produção → Public Key). Pode ficar no código.
// Sem ela, só o cartão de teste (modo sandbox) funciona. No servidor também é preciso MP_ACCESS_TOKEN.
export const MP_PUBLIC_KEY = "";

// ---- Emuladores locais do Firebase (só para testes; ver DEPLOY-RENDER.md) ----
// Abra o app com ?emulador=1 em localhost para usar Auth/Firestore locais.
export const USAR_EMULADOR = typeof location !== "undefined" && location.hostname === "localhost" && new URLSearchParams(location.search).has("emulador");
