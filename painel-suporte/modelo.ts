// ============================================================================================================
// MODELO DE DADOS DO SUPORTE — Abastece Já
// Espelha o que já existe no Firestore/API (suporte_conversas, suporte_mensagens, chamados_ti) e o que este
// painel acrescentou (suporte_tickets). O navegador só LÊ o Firestore (regras); TODA escrita passa pela API.
// ============================================================================================================

/** Qualquer coisa que o SDK do Firestore devolva como data. Use `ms()` de logica.js para normalizar. */
export type Data = { toMillis(): number; toDate(): Date } | number | null;

export type Segmento = "promotor" | "loja";
export type AutorMensagem = "usuario" | "suporte";

/** suporte_mensagens/{id} — o id começa com o relógio (13 dígitos): ordenar por id = ordem cronológica. */
export interface Mensagem {
  id: string;               // "1730556000123_a1b2c3d4"
  uid: string;              // dono da conversa (loja ou promotor)
  de: AutorMensagem;
  texto: string;            // 1..1000 caracteres, sempre texto puro (a tela nunca interpreta HTML)
  autorUid: string;         // quem escreveu (o próprio usuário ou o atendente)
  criadoEm: Data;
}

/** suporte_conversas/{uid} — resumo da conversa; o dono também lê, então NADA interno entra aqui. */
export interface Conversa {
  uid: string;
  tipo: Segmento;
  nome: string;
  ultimaMsg: string;        // até 120 caracteres
  ultimaDe: AutorMensagem;
  ultimaEm: Data;
  naoLidasSuporte: number;  // o que a equipe ainda não leu
  naoLidasUsuario: number;
  criadoEm: Data;
}

export type StatusTicket = "aberto" | "escalado" | "resolvido";
export type DestinoEscalada = "ti" | "gestao";

/** Resultado do escalamento, guardado no ticket (e só visível à equipe). */
export interface Escalonamento {
  chamadoId: string;        // chamados_ti/{id}
  protocoloTI: string;      // "TI-000123"
  destino: DestinoEscalada;
  motivo: string;
  porNome: string;
  emMs: number;
}

/** suporte_tickets/{uid} — o ticket VIGENTE da conversa. Só a equipe lê (regras do Firestore). */
export interface Ticket {
  uid: string;
  protocolo: string;        // "SP-000123" (sequencial, contadores/suporte)
  tipo: Segmento;
  nome: string;
  status: StatusTicket;
  reaberturas: number;      // ao resolver, a próxima necessidade abre NOVO protocolo
  criadoMs: number;
  atualizadoMs: number;
  resolvidoMs: number | null;
  escalonamento: Escalonamento | null;
}

/** Campos acrescentados a chamados_ti/{id} quando o chamado nasce de uma escalada. */
export interface ChamadoEscalado {
  origem: "suporte";
  filaDestino: DestinoEscalada;   // "ti" (desenvolvimento) ou "gestao" (ADM)
  suporteProtocolo: string;       // "SP-000123"
  conversaUid: string;            // volta para a conversa de origem
  // + todos os campos normais do chamado (protocolo TI-…, prioridade, SLA, eventos[] com a transcrição em notas internas)
}

/** GET /admin/suporte/:uid/perfil — ficha do atendente (CPF já mascarado; consulta auditada). */
export interface PerfilSuporte {
  uid: string;
  tipo: Segmento;
  email: string;
  parcial: boolean;               // true = pré-carga leve (sem telefone/CPF); a versão completa chega logo depois
  cadastro: CadastroPromotor | CadastroLoja;
  historico: { total: number; porStatus: Record<string, number>; ultimos: TurnoResumo[] };
  acoes: { acao: string; em: string | null }[];
  conversa: { desde: string | null; mensagens: number; naoLidas: number; ultimaEm: string | null };
  carregadoEm: string;
}
export interface CadastroPromotor {
  foto: string; nome: string; status: string; statusMotivo: string; cidade: string; especialidade: string;
  telefone: string; cpfMascarado: string; nascimento: string | null; idade: number | null; menor: boolean;
  ratingMedia: number | null; criadoEm: string | null;
  treinamento: { concluidos: number; total: number };
  pendencias: string[]; habilitacoes: string[];
}
export interface CadastroLoja {
  foto: string; nome: string; status: string; documento: string; ramo: string; telefone: string; endereco: string;
  criadoEm: string | null; cartao: string;
}
export interface TurnoResumo { id: string; data: string | null; entrada: string | null; saida: string | null; foco: string; status: string; contraparte: string }

/** Abas da fila. "pendentes" = a última fala foi do usuário e o ticket não foi resolvido depois dela. */
export type AbaFila = "todos" | "promotores" | "lojas" | "pendentes";

/** Corpo de POST /admin/suporte/:uid/escalar */
export interface PedidoEscalada {
  destino: DestinoEscalada;
  motivo: string;                 // 5..300
  categoria: "acesso" | "pagamento" | "app" | "bug" | "dados" | "infra" | "outro";
  prioridade: "baixa" | "media" | "alta" | "critica";
  avisarUsuario: boolean;         // posta no chat o protocolo e o encaminhamento
}
