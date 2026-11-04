// Cliente da API de suporte (escrita e ficha). A LEITURA em tempo real é direto no Firestore (hooks.js); toda ESCRITA passa por aqui,
// porque o servidor valida, limita, audita e dispara o push. Só depende de `fetch` e de uma função que devolve o ID token do Firebase.

/**
 * @param {{ getToken: (forcarRenovacao?: boolean) => Promise<string>, apiBase?: string, fetchImpl?: typeof fetch }} cfg
 *   getToken: ex.: (forcar) => auth.currentUser.getIdToken(forcar)
 */
export function criarApi({ getToken, apiBase = "", fetchImpl }) {
  const base = String(apiBase).replace(/\/+$/, "");
  const enc = encodeURIComponent;

  async function chamar(caminho, { metodo = "POST", corpo } = {}) {
    const f = fetchImpl || globalThis.fetch.bind(globalThis);
    let renovou = false;
    for (;;) {
      const token = await getToken(renovou);
      let r;
      try {
        r = await f(`${base}/${caminho}`, { method: metodo, headers: { Authorization: `Bearer ${token}`, ...(metodo === "GET" ? {} : { "Content-Type": "application/json" }) }, ...(metodo === "GET" ? {} : { body: JSON.stringify(corpo || {}) }) });
      } catch { throw Object.assign(new Error("Sem conexão com o servidor. Confira a internet e tente de novo."), { codigo: "rede" }); }
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 && !renovou && j.codigo === "sessao-invalida") { renovou = true; continue; }   // token velho: renova UMA vez
      if (!r.ok) throw Object.assign(new Error(j.erro || (r.status === 429 ? "Muitas ações seguidas. Aguarde um instante." : `Erro no servidor (${r.status}).`)), { status: r.status, codigo: j.codigo, detalhe: j.detalhe });
      return j;
    }
  }

  return {
    perfil: (uid, { leve = false } = {}) => chamar(`admin/suporte/${enc(uid)}/perfil${leve ? "?leve=1" : ""}`, { metodo: "GET" }),
    enviar: (uid, texto) => chamar(`admin/suporte/${enc(uid)}/mensagem`, { corpo: { texto } }),
    marcarLido: (uid) => chamar(`admin/suporte/${enc(uid)}/lido`),
    garantirTicket: (uid) => chamar(`admin/suporte/${enc(uid)}/ticket`),
    resolver: (uid) => chamar(`admin/suporte/${enc(uid)}/resolver`),
    escalar: (uid, pedido) => chamar(`admin/suporte/${enc(uid)}/escalar`, { corpo: pedido })
  };
}
