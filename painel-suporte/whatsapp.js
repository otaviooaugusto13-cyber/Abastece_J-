// Link de migração do atendimento para o WhatsApp (equipe → usuário), com o protocolo do suporte na mensagem.
// Parte PURA (sem DOM): testada em test/painel-suporte.test.js. Todo texto passa por encodeURIComponent.

/** Apps e navegadores cortam URLs enormes: o texto é limitado ANTES de codificar. */
export const LIMITE_TEXTO_WHATSAPP = 1500;
const PROTOCOLO_VALIDO = /^[A-Z]{2,4}-\d{4,}$/;

/**
 * Normaliza um telefone brasileiro para o formato do wa.me (só dígitos, com 55): aceita "(19) 99535-0637", "+55 19 99535-0637",
 * "019995350637"… Devolve null se não parecer um celular válido (DDD 11–99; com 11 dígitos o nono dígito deve ser 9).
 */
export function normalizarTelefoneBR(entrada) {
  let d = String(entrada ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);                       // prefixo internacional "00"
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);     // já veio com o país
  else if (d.length === 12 && d.startsWith("0")) d = d.slice(1);   // zero de tronco + DDD + 9 dígitos. Com 11 dígitos começando em 0 NÃO tira o zero: "(09) 99535-0637" viraria o DDD 99 (outra pessoa)
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = Number(d.slice(0, 2)), numero = d.slice(2);
  if (ddd < 11 || ddd > 99) return null;
  if (numero.length === 9 && numero[0] !== "9") return null;    // celular com nono dígito
  if (numero.length === 8 && !/^[6-9]/.test(numero)) return null;   // celular antigo (8 dígitos); fixo não recebe WhatsApp
  return `55${d}`;
}

const limpar = (t, max) => String(t ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const primeiroNome = (n) => limpar(n, 60).split(" ")[0] || "";

/** Texto padrão enviado ao usuário. Formatação do WhatsApp: *negrito*. */
export function montarMensagemWhatsApp({ nome = "", protocolo, atendente = "", resumo = "" }) {
  const quem = primeiroNome(nome), eu = limpar(atendente, 60), assunto = limpar(resumo, 200);
  return [
    `Olá${quem ? `, ${quem}` : ""}! Aqui é ${eu ? `${eu}, ` : ""}do suporte do Abastece Já.`,
    "Estou continuando o seu atendimento por aqui, para ficar mais rápido.",
    `*Protocolo:* ${protocolo}`,
    ...(assunto ? [`*Assunto:* ${assunto}`] : []),
    "Pode responder esta mensagem que eu sigo com você."
  ].join("\n");
}

/**
 * Gera o link https://wa.me/<número>?text=<mensagem codificada>.
 *   { telefone, protocolo, nome?, atendente?, resumo?, mensagem? }  — `mensagem` (opcional) substitui o texto padrão, mas o protocolo
 *   SEMPRE aparece: se faltar no texto personalizado, é acrescentado ao final.
 * Devolve { url, numero, mensagem } ou null (telefone inválido ou protocolo ausente/malformado — a tela explica o motivo).
 * Abra com target="_blank" rel="noopener noreferrer".
 */
export function gerarLinkWhatsApp({ telefone, protocolo, nome, atendente, resumo, mensagem } = {}) {
  const numero = normalizarTelefoneBR(telefone), proto = String(protocolo ?? "").trim().toUpperCase();
  if (!numero || !PROTOCOLO_VALIDO.test(proto)) return null;
  let texto = mensagem ? String(mensagem).replace(/\r\n?/g, "\n").trim() : montarMensagemWhatsApp({ nome, protocolo: proto, atendente, resumo });
  if (!texto.includes(proto)) texto += `\n*Protocolo:* ${proto}`;
  const final = texto.length > LIMITE_TEXTO_WHATSAPP ? `${texto.slice(0, LIMITE_TEXTO_WHATSAPP - 1)}…` : texto;
  return { url: `https://wa.me/${numero}?text=${encodeURIComponent(final)}`, numero, mensagem: final };
}

/** Por que o botão está indisponível (texto para o tooltip), ou null se está tudo certo. */
export function motivoWhatsAppIndisponivel({ telefone, protocolo }) {
  if (!String(protocolo ?? "").trim()) return "Gerando o protocolo do atendimento…";
  if (!String(telefone ?? "").trim()) return "Telefone não disponível na ficha deste usuário.";
  if (!normalizarTelefoneBR(telefone)) return "O telefone cadastrado não parece um celular válido.";
  return null;
}
