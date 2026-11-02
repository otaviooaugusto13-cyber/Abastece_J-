// Contrato do Admin Root (espelha server/lib/operacao.js, server/split.js e server/lib/ti/auditoria.js).
// Dinheiro SEMPRE em centavos inteiros; percentuais são derivados na tela (comissão + repasse = diária).

/** configuracoes/operacao (fechado no firestore.rules; só o servidor lê/escreve) */
export interface Operacao {
  raioKm: number;                       // 1–50, inteiro. Padrão 20
  master: MasterSwitch;                 // true = funcionando · false = PAUSADO
  motivoPausa: string;                  // preenchido ao pausar; vazio quando tudo está ligado
  versao: number;                       // controle otimista: PUT leva a versão vista; divergiu → 409
  atualizadoEm: string | null;          // ISO
  atualizadoPor: string;                // uid do Root (vem do token, nunca do corpo)
  origem: "padrao" | "banco";
}
export interface MasterSwitch { cadastros: boolean; missoes: boolean; pagamentos: boolean }

/** config_publica/operacao — espelho que os apps assinam por onSnapshot (leitura: qualquer logado; escrita: ninguém) */
export interface OperacaoPublica extends MasterSwitch { raioKm: number; versao: number }

/** configuracoes/taxas (já existia) */
export interface Taxas {
  diariaCentavos: number;               // paga pela loja (R$ 10 a R$ 5.000)
  comissaoCentavos: number;             // retida pela plataforma
  repasseCentavos: number;              // vai ao profissional. Regra: comissão + repasse === diária
  taxaFixaCentavos: number;             // por loja (R$ 0 a R$ 500)
  horasMin: number; horasMax: number; maxSemana: number;
  versao: number; atualizadoEm: string | null; atualizadoPor: string; origem: "padrao" | "banco";
}
export interface TaxasPainel extends Taxas { limites: Record<string, number[]>; padrao: Partial<Taxas> }

/** root_auditoria/{seq:10 dígitos} — append-only, encadeada por hash (cada registro inclui o hash do anterior) */
export interface RegistroAuditoria {
  seq: number; ord: string; em: string;                      // em = ISO do servidor
  acao: "root.raio.alterar" | "root.master.alterar" | "root.taxas.alterar" | "root.conceder" | "root.acesso.negado";
  resultado: "solicitado" | "aplicado" | "falhou" | "negado"; // "solicitado" é gravado ANTES de mexer; sem ele nada muda
  operadorUid: string; operadorNome: string; operadorEmail: string; nivel: "root";
  alvoTipo: string; alvoId: string; resumo: string;
  antes: unknown; depois: unknown; meta: unknown;
  ip: string; ua: string; rota: string; reqId: string;
  hash: string;                                              // sha256(prevHash | conteúdo canônico)
}

/** Custom claims no token do Firebase (só o servidor escreve) */
export interface ClaimsRoot { role: "admin"; admin: true; is_root: true }

/** Respostas */
export interface PainelRoot { eu: { uid: string; email: string }; operacao: Operacao; limitesOperacao: { raioKm: [number, number] }; taxas: TaxasPainel }
export interface ListaAuditoria { itens: RegistroAuditoria[]; proximo: string | null }
export interface VerificacaoCadeia { ok: boolean; verificados: number; primeiroSeq: number; ultimoSeq: number; problemas: { seq: number; problema: string }[] }
