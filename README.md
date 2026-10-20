[README.md](https://github.com/user-attachments/files/33716638/README.md)
# Abastece Já

App web (PWA) que liga **lojas** a **promotores/repositores** freelancers, com **pagamento dividido automaticamente** e **nota** a cada serviço.

## Como o dinheiro é dividido

Valor do turno = o que a loja combinou pagar (ex.: R$ 100,00).

| Quem | Recebe | Exemplo |
|---|---|---|
| Promotor | 80% do valor do turno | R$ 80,00 |
| Plataforma | 20% do valor do turno **+ taxa fixa** | R$ 20,00 + R$ 5,00 = R$ 25,00 |
| **Loja paga** | valor do turno + taxa fixa | **R$ 105,00** |

- Tudo em **centavos inteiros** (sem erro de ponto flutuante). O promotor fica com o "resto" do arredondamento, nunca perde centavo.
- Os números ficam em **dois lugares que precisam ser iguais**: `config.js` (o que a tela mostra) e `functions/split.js` (o que o servidor cobra de verdade). `node test/split.test.js` falha se divergirem.
- O Mercado Pago divide **no ato do pagamento** (`marketplace_fee`): o promotor recebe direto na conta dele; a plataforma recebe a parte dela. Nada de repasse manual.
- ⚠️ A taxa de processamento do Mercado Pago (Pix/cartão) é cobrada **do promotor** pelo próprio MP. Se quiser que a plataforma absorva, é só aumentar a taxa fixa.

## Fluxo

1. Loja cria pedido (valor + resumo ao vivo do split).
2. Promotor aprovado **e com Mercado Pago conectado** aceita.
3. Serviço feito → promotor toca em **Cobrar (QR)**; a loja abre `pagar.html`, paga com Pix/cartão.
4. Mercado Pago confirma (webhook + retorno da página) → servidor valida o valor **ao centavo** na API do MP → marca `paga` → **emite a nota** (`notas/{id}`, numeração sequencial) → loja vê em Carteira → *Ver nota* (imprime/PDF).

> **A nota gerada é um comprovante/nota de serviço da plataforma — não é NFS-e.** Para emitir NFS-e de verdade, contrate um emissor (eNotas, Focus NFe, PlugNotas…) e chame a API dele em `processarPagamento()` (`functions/index.js`, onde está o campo `fiscal.nfse`). Isso depende da prefeitura e do regime tributário da empresa — fale com seu contador.

## Colocar no ar (checklist)

1. **Firebase** (plano Blaze, necessário p/ Functions): `npm i -g firebase-tools && firebase login && firebase use abastece-ja-240d5`
2. **Regras:** `firebase deploy --only firestore:rules` ← **faça isto antes de abrir para o público**. Sem regras, qualquer um altera pedidos e lê dados dos promotores.
3. **Mercado Pago:** crie uma aplicação em mercadopago.com.br/developers (tipo *Marketplace / Checkout Pro*). Em *Redirect URL* coloque a URL da função `mpCallback` (aparece depois do deploy):
   `https://southamerica-east1-abastece-ja-240d5.cloudfunctions.net/mpCallback`
4. **Functions:**
   ```
   cd functions && npm install && cd ..
   firebase functions:secrets:set MP_CLIENT_SECRET
   firebase functions:secrets:set MP_WEBHOOK_SECRET      # opcional (assinatura do webhook)
   # crie functions/.env com:
   #   MP_CLIENT_ID=seu_client_id
   #   APP_URL=https://seu-site.com   (onde o app está hospedado, sem barra no fim)
   firebase deploy --only functions
   ```
5. **Front:** em `config.js` preencha `FUNCTIONS_BASE` (`https://southamerica-east1-abastece-ja-240d5.cloudfunctions.net`), `EMPRESA` (razão social/CNPJ que saem na nota) e `WHATSAPP_SUPORTE`.
6. **Hospedagem:** `firebase deploy --only hosting` ou GitHub Pages (agora funciona: o `Pagar.html` com P maiúsculo foi renomeado para `pagar.html`).
7. **Aprovar promotores:** no Console do Firebase → Firestore → `profissionais/{uid}` → `status: "ativo"`.
8. **Firebase Auth:** adicione o domínio do site em *Authentication → Settings → Authorized domains*.

### Quem já estava cadastrado
Os dados sensíveis (CPF, Pix, telefone) saíram de `profissionais` e foram para `profissionais_privado` (só o dono lê); o documento do promotor agora é sempre `profissionais/{uid do Google}`. Promotores antigos precisam entrar de novo, completar os dados e ser aprovados de novo. Pedidos antigos continuam aparecendo (o app entende `valor` em reais).


## Correção: loja não conseguia entrar com o Google

**Causa:** o `index.html` (painel da loja) estava na versão nova, mas o `script.js` era o antigo. Os IDs não batiam (`btn-login-aluno` x `btn-login`, `check-termos-aluno` x `check-termos`, mais ~45 outros), então nada ligava o clique do botão ao login, e o botão ficava desabilitado para sempre. Além disso, `functions/`, `icons/`, `test/` e `nota.html` não tinham subido para o repositório.

**O que foi feito:**
- `script.js` reescrito para casar com o `index.html` novo (login, pedidos, agenda, carteira, chat, avaliação, dados da empresa).
- `nota.html` criado (nota de serviço imprimível / salvar em PDF).
- Estrutura restaurada: `functions/` (com `package.json`), `icons/`, `test/`.
- `sw.js`: um arquivo faltando não derruba mais a instalação do cache offline.
- Removidos os arquivos legados (`comum.js`, `financeiro.js`, `chat.js`, `polish.css`, `style-personal.css`). A taxa fixa agora existe em um só lugar (`config.js`, espelhado em `functions/split.js`); antes havia R$ 3,00 e R$ 5,00 em arquivos diferentes.

**Ao subir para o GitHub:** arraste as **pastas** inteiras (não só os arquivos), senão `functions/` e `icons/` se perdem de novo.

## Estrutura

```
index.html / script.js           app da loja
promotor.html / script-personal.js  app do promotor
pagar.html                       checkout (split à vista, retorno do MP, confirmação)
nota.html                        nota imprimível
config.js                        taxas, empresa, Firebase, URL do backend  ← edite aqui
core.js                          dinheiro/validação (puro, testado)
ui.js, firebase.js               toast, tema, máscaras, modais / init do Firebase
style.css                        design system único
sw.js, manifest.json, icons/     PWA
functions/                       Cloud Functions (OAuth MP, cobrança, webhook, nota, avaliação)
firestore.rules                  segurança
test/split.test.js               testes (node test/split.test.js)
```

## O que mudou (resumo)

**Pagamento e nota** — split 80/20 + taxa fixa em centavos; cálculo e validação no servidor; OAuth do Mercado Pago para o promotor; webhook idempotente conferindo o valor na API do MP; nota numerada automática com tomador/prestador/distribuição; retorno do checkout com confirmação em tempo real; bônus de indicação gravado a pagar.
**Segurança** — regras do Firestore (cliente nunca escreve dinheiro/nota/token); dados sensíveis e tokens em coleções separadas; fim do "login só com CPF" (qualquer um podia se passar por outro promotor e receber); XSS corrigido (nome da loja entrava sem escape); promotor só aceita se tiver MP conectado.
**Produto** — tempo real (onSnapshot) com avisos de pedido aceito/pago/oferta nova; chat de verdade por pedido; cancelar, repetir pedido, desistir de turno; avaliação com nota média; checklist de onboarding; filtros/ordenação nas ofertas; sugestão de valor por hora; calendário com marcação de dias; carteira com gráfico mensal, extrato e exportação CSV.
**Interface** — design system novo, modo claro/escuro seguindo o sistema, skeletons, estados vazios, toasts, folhas (bottom sheets), máscaras e validação de CPF/CNPJ/telefone, acessibilidade (foco, aria, teclado, reduced-motion).
**Base** — PWA instalável com cache offline, manifest e ícones corrigidos (apontavam para uma pasta inexistente), config única, testes.
