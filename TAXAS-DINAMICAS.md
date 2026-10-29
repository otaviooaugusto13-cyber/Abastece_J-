# Taxas da plataforma dinâmicas

Admin → **Configurações → Taxas da plataforma**: diária, comissão, repasse, taxa fixa, duração mínima/máxima do turno e máx. de turnos/semana por loja.
Salvar grava em `configuracoes/taxas` (Firestore) e vale **imediatamente** para os próximos pedidos — sem editar `split.js`/`config.js`, sem deploy, sem reiniciar.

## Fluxo
```
Admin (admin.html/admin.js) ──PUT /admin/taxas──▶ server/rotas/taxas.js
   valida (split.validarTaxas) · exige admin + login recente · controle de versão · auditoria antes/depois
        │ grava
        ▼
Firestore  configuracoes/taxas  ──onSnapshot──▶ server/lib/taxas.js (cache; TTL 30 s de garantia)
        │                                             │
        │                                             ├─▶ criarPedido (preço, horas)         pedidos.js
        │                                             ├─▶ aceitarTurno (máx. por semana)     pedidos.js
        │                                             ├─▶ checkout/webhook (split congelado)  pagamentos.js
        ▼
GET /config/taxas (público) ──▶ taxas.js (navegador) ──▶ core.js TAXAS ──▶ telas, Termos, validação do turno
```

## Regras de segurança do dinheiro
- Só `role=admin` altera; `PUT` exige login recente (reautentica com o Google se preciso) e é limitado a 30/h por admin.
- Servidor valida de novo: centavos **inteiros** (números, não strings), comissão + repasse **=** diária, diária R$ 10–5.000, taxa fixa R$ 0–500, turno 0,5–12 h (múltiplos de 0,5), 1–7 turnos/semana. Campos extras são descartados.
- Dois admins ao mesmo tempo: o `PUT` leva a `versao` que o admin viu; se mudou, **409** e a tela recarrega.
- **Preço congelado por pedido**: o split é gravado em `pagamentos_internos/{id}` na criação do pedido e é ele que o checkout/webhook usam. Assim, o que a loja viu e o líquido que o profissional viu ao aceitar nunca divergem do que é cobrado/creditado. Mudar as taxas afeta os pedidos **criados depois**.
- Falha de leitura do banco: usa a última versão boa em cache; sem cache (ou com documento corrompido) responde 503 — não nasce pedido com preço incerto. Documento inexistente = padrão de `split.js` (primeira execução).
- `configuracoes` continua fechada no `firestore.rules` (deny-by-default): o app só enxerga via API.

## Arquivos
Novos: `server/lib/taxas.js`, `server/rotas/taxas.js`, `taxas.js`.
Alterados: `server/split.js` (funções recebem `cfg`; `validarTaxas`), `server/server.js`, `server/rotas/{pedidos,pagamentos,carteira}.js`, `core.js` (`TAXAS`, `aplicarTaxas`), `script.js`, `script-personal.js`, `admin.html`, `admin.js`, `admin.css`, `sw.js` (v8), `config.js` (só comentário), testes.
