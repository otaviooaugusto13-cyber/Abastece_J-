# Roteador inteligente de chamados automáticos

Quando o app captura um erro, o **servidor** classifica e abre o chamado já na fila do departamento certo, gera o protocolo do setor, devolve o texto personalizado para a tela e avisa a equipe (push + chat).

```
app (erros-globais.js) ──POST /chamados/automatico { impressao, titulo, descricao, erro: {nome, mensagem, stack, rota, status, codigo…} }
   └─ servidor: roteador.classificarErro() → TI | ADM | Suporte
        ├─ chamados.abrirAutomatico()  grava o chamado (departamento, classificacao, logsTecnicos, mensagemAmigavel) + protocolo do setor
        ├─ resposta: { protocolo, departamento, setor, titulo, mensagem }  → painel na tela da pessoa
        └─ despacho.disparar() (segundo plano): push aos admins (ADM/Suporte) + webhook de chat do departamento + nota interna no chamado
```
O departamento é decidido **só no servidor** (o app não consegue forjar). Arquivos: `server/lib/ti/roteador.js`, `despacho.js`, `chamados.js`, `redigir.js`; UI: `admin-chamados.js` (aba Chamados do painel admin), `ti.js` (filtro/transferir), `erros-globais.js` (tela da pessoa).

## 1. Classificação (`classificarErro`)
Função pura e explicável; devolve `{ departamento, categoria, prioridade, confianca, motivo, sinais, pontos }`. Ordem de decisão:

1. **Código de erro do servidor** (`saldo-insuficiente`, `checkin-expirado`, `interno`…): tabela `POR_CODIGO`, confiança alta.
2. **Exceção nativa de JavaScript** (`TypeError`, `ReferenceError`…) → sempre **TI**, mesmo que a mensagem cite "valor" ou "pagamento" (nome de arquivo na stack nunca vota em ADM/Suporte).
3. **Pontuação** por sinais em mensagem/rota/status (tabela `SINAIS`); vence quem somar mais; empate: TI > ADM > Suporte.
4. **Sem sinal**: erro capturado → TI (triagem, confiança baixa); pedido de ajuda (`tipo: "duvida"`) → Suporte.

| Departamento | Recebe | Exemplos de sinais |
|---|---|---|
| **TI** (`TI-000123`) | exceções de código, API 5xx, banco, rede, integração sem credencial | `TypeError`, `FAILED_PRECONDITION`, `ECONNRESET`, 502/503, `mp-rede` |
| **ADM / Financeiro** (`ADM-000045`) | pagamento, comissão/repasse/saque, valores inconsistentes, permissão gerencial | `saldo-insuficiente`, `valor-divergente`, "comissão", "Mercado Pago recusou", 403 em `admin/*` |
| **Suporte** (`SUP-000012`) | operação em campo, cadastro/habilitação, dúvidas | `checkin-expirado`, `treinamento-pendente`, "como faço…" |

Prioridade sugerida: `alta` para dinheiro/infra, `media`/`baixa` nos demais. **Nunca "crítica"** (decisão humana). Para ajustar uma regra, edite `POR_CODIGO`/`SINAIS` e rode `node test/roteador.test.cjs`.
Classificou errado? **Transferir** (painel de TI ou aba Chamados): o protocolo não muda, o chamado volta à fila do novo setor e a decisão original do robô fica guardada em `classificacao`.

## 2. Estrutura do chamado (`chamados_ti/{id}`, Firestore)
Campos novos (os antigos seguem iguais; chamado sem `departamento` = TI):

| Campo | Conteúdo |
|---|---|
| `protocolo` | `TI-000123` / `ADM-000045` / `SUP-000012` (contador por departamento em `contadores/chamados_ti`, `chamados_adm`, `chamados_suporte`) |
| `departamento` | `ti`, `adm` ou `suporte` |
| `categoria`, `prioridade`, `status` | `pagamento`/`bug`/`infra`…; `baixa..alta`; `aberto → em_atendimento ⇄ aguardando_usuario → resolvido` |
| `classificacao` | `{ departamento, categoria, prioridade, confianca, motivo, sinais[], pontos, versao, automatica }` |
| `mensagemAmigavel` | texto que a pessoa viu na tela |
| `logsTecnicos` | `{ nome, mensagem, origem, rota, status, codigo, arquivo, stack, tela, perfil, impressao }` — já sem e-mail/CPF/telefone/tokens (LGPD, redigido também no servidor) |
| `transferencias` | quantas vezes mudou de setor |
| `solicitanteUid/Tipo/Nome`, `descricao`, `origem: "automatico"`, `criadoMs`, `slaAtendMs`… | como antes |

Índices novos em `firestore.indexes.json` (publique com `firebase deploy --only firestore:indexes`). Duplicidade: o mesmo erro do mesmo usuário em 1 h reaproveita o chamado (mesmo protocolo e departamento).

## 3. O que a pessoa vê
Resposta de `POST /chamados/automatico`:
```json
{ "protocolo": "ADM-000045", "departamento": "adm", "setor": "Administrativo / Financeiro", "prioridade": "alta", "repetido": false,
  "titulo": "Chamado aberto para o Administrativo/Financeiro",
  "mensagem": "Identificamos uma questão de pagamento, de valores ou de permissão. O chamado ADM-000045 foi aberto para o setor Administrativo/Financeiro, que vai conferir o seu caso. Guarde o número do protocolo. Previsão do primeiro retorno: em até 1 hora." }
```
O painel mostra título, mensagem, o protocolo (copiável), "Número do chamado · setor: …" e o botão **Falar com o setor …** (chat ou WhatsApp, com o relatório). Sem rede/sem login o relatório fica na fila local e é roteado quando enviado.

## 4. Como o chamado chega à equipe
* **Painel**: sempre. TI → `/painel-ti` (filtro por departamento); ADM e Suporte → `/painel-admin` → **Chamados** (selo com a contagem de abertos; assumir, responder, resolver, transferir; tudo auditado). O admin **não** vê chamados do TI (404) e **não** vê a stack trace.
* **Push** (ADM/Suporte): aviso nos aparelhos dos administradores, abre o chamado direto.
* **Chat** (webhook de entrada por departamento; Slack, Discord, Google Chat, Teams ou JSON genérico — formato escolhido pelo endereço):

| Variável de ambiente | Uso |
|---|---|
| `CHAMADOS_WEBHOOK_TI`, `CHAMADOS_WEBHOOK_ADM`, `CHAMADOS_WEBHOOK_SUPORTE` | URL `https://…` do canal de cada equipe |
| `CHAMADOS_WEBHOOK_URL` | um canal só para todos (usado quando não há o específico) |
| `CHAMADOS_WEBHOOK_SEGREDO` | opcional: assina o corpo (`X-Abastece-Assinatura: sha256=<hmac>`) em receptores genéricos |

O envio é em segundo plano (5 s de limite, máx. 20 avisos/min por departamento); se o chat cair, a pessoa recebe o protocolo do mesmo jeito e o chamado fica na fila. O resultado fica numa nota interna do chamado. Só o canal do **TI** recebe as primeiras linhas da stack.

Payload entregue (formato genérico; Slack/Teams/Google Chat recebem só `text`, Discord só `content`):
```json
{
  "evento": "chamado.aberto",
  "versao": 1,
  "em": "2026-11-03T11:36:02.000Z",
  "departamento": "adm",
  "setor": "Administrativo / Financeiro",
  "prioridade": "alta",
  "prazoPrimeiroRetornoEm": "2026-11-03T12:36:00.000Z",
  "chamado": {
    "id": "Zk3p9Qw1",
    "protocolo": "ADM-000045",
    "titulo": "Erro automático: ApiError — POST pagamentos/confirmar: valor divergente",
    "categoria": "pagamento",
    "status": "aberto",
    "origem": "automatico",
    "criadoEm": "2026-11-03T11:36:00.000Z"
  },
  "roteamento": {
    "motivo": "código de pagamento/financeiro (valor-divergente)",
    "confianca": "alta",
    "sinais": [
      "codigo:valor-divergente"
    ]
  },
  "solicitante": {
    "tipo": "loja",
    "nome": "Mercado Sol Nascente"
  },
  "erro": {
    "nome": "ApiError",
    "mensagem": "valor divergente",
    "rota": "POST pagamentos/confirmar",
    "status": 409,
    "codigo": "valor-divergente",
    "tela": "screen-pagar",
    "perfil": "loja"
  },
  "links": {
    "painel": "https://app.abastecejatech.com.br/painel-admin?chamado=Zk3p9Qw1#chamados"
  },
  "texto": "🟠 Novo chamado ADM-000045 → Administrativo / Financeiro\nPrioridade: alta · Roteamento: alta (código de pagamento/financeiro (valor-divergente))\nSolicitante: Mercado Sol Nascente (loja)\nErro: ApiError — valor divergente\nRota: POST pagamentos/confirmar · status 409 · código valor-divergente\nAbrir: https://app.abastecejatech.com.br/painel-admin?chamado=Zk3p9Qw1#chamados"
}
```
A mensagem no chat fica assim:
```
🟠 Novo chamado ADM-000045 → Administrativo / Financeiro
Prioridade: alta · Roteamento: alta (código de pagamento/financeiro (valor-divergente))
Solicitante: Mercado Sol Nascente (loja)
Erro: ApiError — valor divergente
Rota: POST pagamentos/confirmar · status 409 · código valor-divergente
Abrir: https://app.abastecejatech.com.br/painel-admin?chamado=Zk3p9Qw1#chamados
```

## 5. API
| Rota | Quem | O que faz |
|---|---|---|
| `POST /chamados/automatico` | loja/promotor/admin | classifica, abre, devolve protocolo + mensagem do setor |
| `GET /ti/chamados?departamento=ti`, `adm` ou `suporte` | operador de TI | fila filtrada |
| `POST /ti/chamados/:id/transferir` `{departamento, motivo}` | operador de TI (técnico: só o que é seu) | corrige o roteamento |
| `GET /admin/chamados` (`?departamento=adm` ou `suporte`, `&visao=abertos`, `resolvidos` ou `todos`), `GET /admin/chamados/resumo`, `GET /admin/chamados/:id` | admin | fila de ADM e Suporte |
| `POST /admin/chamados/:id/assumir`, `/status`, `/comentarios`, `/transferir` | admin | atendimento |

## Limites conhecidos
* O TMA/TMR/ranking do painel de TI contam só chamados do TI; não há métricas por departamento ainda.
* Chamados **manuais** (`POST /chamados`) continuam indo para o TI (`TI-…`); só os automáticos são roteados.
* O servidor só enxerga a mensagem do 500 que o app reporta. Capturar a exceção direto no `tratadorErros` (com a stack do servidor) classificaria melhor — próximo passo natural.
* Todos os administradores recebem o push de ADM e de Suporte (hoje não há papel separado por setor no `admin`); o chat por webhook já é separado por equipe.
* A classificação é por regras: erros com texto inédito caem em TI com confiança baixa. Veja `classificacao.confianca` e use **Transferir** para achar onde ajustar as regras.
