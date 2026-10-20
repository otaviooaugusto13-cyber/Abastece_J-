// ============================================================
// CONFIGURAÇÃO ÚNICA DO ABASTECE JÁ
// Tudo que você pode querer ajustar sem mexer no resto do código.
// ============================================================

// ---- Regras de pagamento -----------------------------------
// Modelo (valor = o que a loja combinou pagar pelo turno):
//   Promotor recebe  = 80% do valor do turno
//   Aplicativo recebe = 20% do valor do turno + taxa fixa por turno
//   Loja paga         = valor do turno + taxa fixa por turno
//
// IMPORTANTE: a mesma regra precisa existir em functions/split.js
// (o servidor é quem manda de verdade). Se mudar aqui, mude lá — o teste
// `node test/split.test.js` falha se os dois divergirem.
export const PLATAFORMA_PCT = 20;          // % do valor do turno que fica com o app
export const TAXA_FIXA_CENTAVOS = 500;     // taxa fixa por turno, em centavos (500 = R$ 5,00)
export const VALOR_MINIMO_CENTAVOS = 3000; // turno mínimo: R$ 30,00
export const VALOR_MAXIMO_CENTAVOS = 200000;
export const VALOR_HORA_SUGERIDO_CENTAVOS = 2500; // sugestão de R$ 25/h no formulário

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

// ---- Cloud Functions ----------------------------------------
// Depois do `firebase deploy --only functions`, a URL base é:
//   https://REGIAO-PROJETO.cloudfunctions.net
// Deixe vazio enquanto o backend não estiver no ar: o app avisa em vez de quebrar.
export const FUNCTIONS_BASE = "";
