// Validação do currículo em PDF. Não confiamos em Content-Type, extensão nem no que o navegador diz: o servidor confere o
// conteúdo real (assinatura %PDF-, fim de arquivo, tamanho) e recusa PDFs com conteúdo ATIVO (JavaScript, Launch, arquivos
// embutidos…), porque quem abre o arquivo é a equipe de uma empresa parceira.
// Limite honesto: é uma checagem por padrões (inclui nomes ofuscados com #xx). PDFs com objetos comprimidos podem esconder
// esses marcadores — para risco maior, passe o arquivo por antivírus/re-renderização antes de liberar (ver MODULO-VAGAS.md).
const crypto = require("crypto");
const { Falha } = require("./erros");

const MAX_BYTES = 5 * 1024 * 1024;           // 5 MB
const MIN_BYTES = 512;                        // um PDF real nunca é menor que isso
const PREFIXO = "data:application/pdf;base64,";
// /URI é permitido de propósito: currículos têm link de LinkedIn/portfólio.
const PROIBIDOS = [/\/JavaScript\b/, /\/JS\b/, /\/Launch\b/, /\/EmbeddedFile\b/, /\/RichMedia\b/, /\/XFA\b/, /\/Encrypt\b/, /\/SubmitForm\b/, /\/GoToR\b/];

const invalido = (msg, codigo = "pdf-invalido") => new Falha(400, msg, codigo);
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
/** Desfaz a ofuscação de nomes PDF (`/J#61vaScript` → `/JavaScript`) antes de procurar marcadores proibidos. */
const normalizarNomes = (txt) => txt.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

/** Valida o conteúdo (Buffer) de um PDF. Lança Falha(400) com mensagem amigável. */
function validarPdf(buf) {
  if (buf.length < MIN_BYTES) throw invalido("O arquivo é pequeno demais para ser um PDF válido.");
  if (buf.length > MAX_BYTES) throw new Falha(413, `O PDF passa de ${MAX_BYTES / 1024 / 1024} MB. Reduza o arquivo e tente de novo.`, "pdf-grande");
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw invalido("O arquivo não é um PDF. Envie o currículo em formato PDF.", "pdf-formato");
  if (!buf.subarray(Math.max(0, buf.length - 2048)).toString("latin1").includes("%%EOF")) throw invalido("O PDF parece incompleto ou corrompido. Gere o arquivo de novo.");
  const txt = normalizarNomes(buf.toString("latin1"));
  if (PROIBIDOS.some((re) => re.test(txt))) throw invalido("Este PDF tem conteúdo ativo (scripts, anexos ou proteção por senha) e não pode ser aceito. Exporte um PDF simples.", "pdf-conteudo-ativo");
  return buf;
}

/** data URL (`data:application/pdf;base64,…`) → { buf, sha256, bytes }. */
function decodificar(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(PREFIXO)) throw invalido("Envie o currículo em formato PDF.", "pdf-formato");
  const b64 = dataUrl.slice(PREFIXO.length);
  if (b64.length > Math.ceil((MAX_BYTES * 4) / 3) + 8) throw new Falha(413, `O PDF passa de ${MAX_BYTES / 1024 / 1024} MB. Reduza o arquivo e tente de novo.`, "pdf-grande");
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw invalido("Arquivo inválido. Escolha o PDF de novo.");
  const buf = validarPdf(Buffer.from(b64, "base64"));
  return { buf, sha256: sha256(buf), bytes: buf.length };
}

/** Caminho do objeto no bucket. Nome = hash do conteúdo: imutável, sem colisão e sem usar texto vindo do usuário. */
const caminhoDoCurriculo = (uid, hash) => `curriculos/${uid}/${hash}.pdf`;
const prefixoDoUsuario = (uid) => `curriculos/${uid}/`;

module.exports = { MAX_BYTES, MIN_BYTES, PREFIXO, validarPdf, decodificar, sha256, caminhoDoCurriculo, prefixoDoUsuario };
