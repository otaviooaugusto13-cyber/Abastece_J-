/** Cliente da API /cs/*: token no cabeçalho Authorization (nunca na URL), erros legíveis, download de arquivos e imagens protegidas. */
export class ApiErro extends Error { constructor(msg: string, public status: number, public codigo?: string) { super(msg); } }
export interface Api {
  get<T>(caminho: string): Promise<T>; post<T>(caminho: string, corpo?: unknown): Promise<T>; put<T>(caminho: string, corpo?: unknown): Promise<T>; del<T>(caminho: string): Promise<T>;
  baixar(caminho: string, nomePadrao: string): Promise<void>; imagem(caminho: string): Promise<string>;
}
export function criarApi(getToken: () => Promise<string>, apiBase = "", onReautenticar?: () => void): Api {
  async function bruto(caminho: string, metodo = "GET", corpo?: unknown): Promise<Response> {
    const r = await fetch(apiBase + caminho, { method: metodo, headers: { Authorization: `Bearer ${await getToken()}`, ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}) }, body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
    if (!r.ok) {
      const j = await r.json().catch(() => ({} as any));
      if (j.codigo === "reautenticar") onReautenticar?.();
      throw new ApiErro(j.erro || (r.status === 429 ? "Muitas tentativas. Aguarde um instante." : "Falha na requisição."), r.status, j.codigo);
    }
    return r;
  }
  const json = async <T,>(c: string, m: string, b?: unknown): Promise<T> => (await bruto(c, m, b)).json();
  return {
    get: (c) => json(c, "GET"), post: (c, b = {}) => json(c, "POST", b), put: (c, b = {}) => json(c, "PUT", b), del: (c) => json(c, "DELETE", undefined),
    async baixar(c, nomePadrao) {
      const r = await bruto(c), blob = await r.blob(), nome = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "")?.[1] || nomePadrao, url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    async imagem(c) { return URL.createObjectURL(await (await bruto(c)).blob()); }   // <img> não envia Authorization: busca como blob (CSP permite blob:)
  };
}
