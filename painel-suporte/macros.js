// Respostas rápidas (macros) do atendimento: texto com variáveis {nome}, {protocolo}, {atendente}.
// Atalhos: Alt+1…9 insere a macro correspondente; "/" no início do campo abre a busca. O conteúdo descreve só o que a plataforma
// já faz (check-out com foto da gôndola, habilitação por categoria, treinamento, Pix no perfil) — ajuste a redação à operação.
import { primeiroNome } from "./logica.js";

export const CATEGORIAS_MACRO = [
  { id: "cadastro", rotulo: "Cadastro" }, { id: "turnos", rotulo: "Turnos" }, { id: "pagamentos", rotulo: "Pagamentos" }
];

export const MACROS = [
  { id: "cad-pendente", categoria: "cadastro", titulo: "Cadastro pendente", texto: "Oi, {nome}! Seu cadastro ainda está pendente. Confira no seu perfil quais dados ou etapas faltam e complete por lá. Assim que terminar, me avise aqui que eu analiso. (protocolo {protocolo})" },
  { id: "cad-dados", categoria: "cadastro", titulo: "Dados não conferem", texto: "Olá, {nome}! O CPF ou a data de nascimento do seu cadastro não confere com o documento. Pode me enviar o dado correto por aqui? Assim corrijo e libero o seu acesso." },
  { id: "cad-treino", categoria: "cadastro", titulo: "Treinamento pendente", texto: "Oi, {nome}! Para liberar os turnos falta concluir o treinamento. Quando terminar, é só avisar aqui que eu confiro a sua habilitação." },
  { id: "trn-liberar", categoria: "turnos", titulo: "Turno não libera", texto: "Oi, {nome}! Vou verificar por que o turno não está liberado para você. Pode me dizer qual é a loja e o dia e horário do turno? (protocolo {protocolo})" },
  { id: "trn-habil", categoria: "turnos", titulo: "Habilitação da categoria", texto: "Olá, {nome}! Alguns turnos exigem a habilitação da categoria. Veja em Treinamentos se falta algum módulo: ao concluir, o selo aparece no seu perfil e os turnos dessa categoria são liberados." },
  { id: "trn-checkout", categoria: "turnos", titulo: "Check-in e check-out", texto: "Oi, {nome}! Para finalizar o serviço, faça o check-out no local do turno com a foto da gôndola. Se o app não deixar concluir, me conte o que aparece na tela que eu verifico." },
  { id: "pag-analise", categoria: "pagamentos", titulo: "Pagamento em análise", texto: "Oi, {nome}! O pagamento é liberado depois que o promotor finaliza o serviço com a foto da gôndola (check-out). Vou conferir o status do seu pedido agora. (protocolo {protocolo})" },
  { id: "pag-pix", categoria: "pagamentos", titulo: "Saque e chave Pix", texto: "Olá, {nome}! Para o saque, confira se a chave Pix do seu perfil está correta. Se você a alterou recentemente, me avise por aqui que eu verifico o status." },
  { id: "pag-dados", categoria: "pagamentos", titulo: "Pedir dados do pagamento", texto: "Oi, {nome}! Para analisar o pagamento, me diga o valor, a data e o horário aproximado e a qual turno ele se refere. Com isso eu localizo aqui. (protocolo {protocolo})" }
];

/** Substitui as variáveis. Sem nome ou sem protocolo, remove o trecho em vez de deixar "{nome}" no texto enviado. */
export function renderizarMacro(texto, { nome = "", protocolo = "", atendente = "" } = {}) {
  const quem = primeiroNome(nome);
  let t = String(texto);
  t = quem ? t.replaceAll("{nome}", quem) : t.replace(/,\s*\{nome\}/g, "").replace(/\{nome\}\s*/g, "");
  t = protocolo ? t.replaceAll("{protocolo}", protocolo) : t.replace(/\s*\(protocolo \{protocolo\}\)/g, "").replaceAll("{protocolo}", "");
  return t.replaceAll("{atendente}", atendente || "equipe de suporte").trim();
}

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** Busca por título/categoria/texto (sem acento). Consulta vazia devolve todas, na ordem dos atalhos. */
export function buscarMacros(consulta = "", macros = MACROS) {
  const q = norm(consulta).trim(); if (!q) return macros;
  return macros.filter((m) => norm(`${m.titulo} ${m.categoria} ${m.texto}`).includes(q));
}
/** Alt+1…9 → macro da posição n (1-based) na lista padrão. */
export const macroPorAtalho = (n, macros = MACROS) => (Number.isInteger(n) && n >= 1 && n <= 9 ? macros[n - 1] || null : null);
export const atalhoDa = (macro, macros = MACROS) => { const i = macros.indexOf(macro); return i >= 0 && i < 9 ? i + 1 : null; };
