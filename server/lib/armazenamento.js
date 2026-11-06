// Armazenamento de arquivos privados (currículos em PDF) no Cloud Storage do Firebase.
// O bucket é NEGADO a qualquer cliente (storage.rules: deny all). Só o servidor (Admin SDK) lê e grava, e cada leitura passa por
// uma rota que confere papel, consentimento e auditoria — o equivalente às políticas de bucket/RLS de um banco relacional.
// Variável de ambiente: FIREBASE_STORAGE_BUCKET (ex.: "meu-projeto.firebasestorage.app"; veja Console › Storage).
const { Falha } = require("./erros");

function criarArmazenamento({ admin, nomeBucket = "" }) {
  const bucket = () => {
    if (!nomeBucket) throw new Falha(503, "O armazenamento de arquivos ainda não foi configurado no servidor (FIREBASE_STORAGE_BUCKET).", "armazenamento-indisponivel");
    return admin.storage().bucket(nomeBucket);
  };
  return {
    disponivel: !!nomeBucket,
    async salvar(caminho, buf, { contentType = "application/pdf" } = {}) {
      await bucket().file(caminho).save(buf, { resumable: false, contentType, metadata: { cacheControl: "private, no-store" } });
    },
    async ler(caminho) {
      try { return (await bucket().file(caminho).download())[0]; }
      catch (e) { if (e instanceof Falha) throw e; if (e?.code === 404) throw new Falha(404, "Arquivo não encontrado.", "nao-encontrado"); throw e; }
    },
    async apagar(caminho) { await bucket().file(caminho).delete({ ignoreNotFound: true }); },
    async apagarPrefixo(prefixo) { await bucket().deleteFiles({ prefix: prefixo, force: true }); }
  };
}

/** Implementação em memória (testes e desenvolvimento sem bucket). Mesma interface. */
function criarArmazenamentoMemoria() {
  const arquivos = new Map();
  return {
    disponivel: true, _arquivos: arquivos,
    async salvar(caminho, buf) { arquivos.set(caminho, Buffer.from(buf)); },
    async ler(caminho) { const b = arquivos.get(caminho); if (!b) throw new Falha(404, "Arquivo não encontrado.", "nao-encontrado"); return Buffer.from(b); },
    async apagar(caminho) { arquivos.delete(caminho); },
    async apagarPrefixo(prefixo) { for (const k of [...arquivos.keys()]) if (k.startsWith(prefixo)) arquivos.delete(k); }
  };
}

module.exports = { criarArmazenamento, criarArmazenamentoMemoria };
