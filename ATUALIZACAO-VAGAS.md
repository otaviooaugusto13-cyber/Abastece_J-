# Atualização — Mural de Vagas / Banco de Talentos (sobre o Abastece Já 3)

Aplicada sobre `Abastece_J--main__3_`. **A aparência do app não mudou**: nenhum CSS existente foi alterado.
O único estilo novo é `style-vagas.css`, que só afeta as telas novas e usa as variáveis do tema (claro/escuro).

## O que entrou
- **Mural de Vagas** no app do promotor (menu Conta): vagas por cidade/tipo/rede, candidatura em 1 clique, "Minhas candidaturas".
- **Divulgação e currículo (LGPD)**: aceite explícito (desligado por padrão, com versão do termo) e currículo em PDF guardado em bucket privado.
- **Admin › Vagas**: criar/publicar/moderar vagas, ver candidatos (CPF mascarado, abrir PDF), empresas e chave de cobrança (gratuito → pago).
- **API da empresa/loja** (`/loja/vagas…`) já pronta; a tela da loja ainda não existe.
- 48 testes novos (`test/vagas.test.cjs` 39 + `test/vagas-ui.test.js` 9).
- Detalhes completos: `MODULO-VAGAS.md`.

## Como aplicar
1. Descompacte este zip **por cima** da pasta do projeto (mesmos caminhos; 24 arquivos: 11 novos e 13 alterados, incluindo o `sw.js`).
2. Firebase Console › **Storage** › criar o bucket (privado).
3. Render › variável **`FIREBASE_STORAGE_BUCKET`** (ex.: `meu-projeto.firebasestorage.app`). Sem ela só o upload do PDF responde 503; o resto funciona.
4. `firebase deploy --only firestore:rules,storage`
5. Deploy do servidor/site. O service worker foi para **`abastece-v22`** (`vagas.js` e `style-vagas.css` no cache; `/vagas` fora do cache).
6. Admin › Vagas › Empresas: cadastrar as redes (ex.: Rede São Vicente) e publicar as primeiras vagas.

## Ajuste feito no merge
O patch original do Vagas foi feito sobre o service worker v20/v21 antigo. Só o `sw.js` conflitava; foi reescrito à mão sobre o `sw.js` do 3 (mantendo `dark-map.js`, `style-dock.css` etc.), subindo para v22.

## Verificação
- Todos os testes do 3 continuam passando + os 48 novos; sintaxe de todos os `.js/.cjs` OK; `package.json`, `firebase.json` e `render.yaml` válidos.
- Não verificado aqui (sem rede/credenciais): upload real de PDF no Storage, telas no navegador, deploy.
- **Atenção (já existia no 3):** o `npm test` termina com erro porque `package.json` chama `test/documento.test.cjs`, que não existe em nenhum dos zips. Os demais testes rodam antes e passam.

## O que foi analisado e descartado
| Pasta | Decisão | Motivo |
|---|---|---|
| `Abastece_J--main-ajustado` e `…ajustado_1` | Descartadas | Trocam o mapa escuro (`dark-map.js`) por Leaflet/CARTO direto e voltam o sw para v20: são **mais antigas** que o 3, que já corrige o problema dos blocos do mapa (OpenStreetMap). Aplicar seria regressão. |
| `Abastece_Ja_UNIFICADO_atualizacao` | Descartada | Retrato anterior do próprio 3 (sw v18, antes do dock, do mapa novo e do envio de RG/CNH). Nada exclusivo. |
| `files.zip` (CS B2B alternativo: `painel-cs`, `lib/cs/*`, NPS) | Descartada | Segunda implementação dos mesmos 15 recursos de CS que o 3 já tem, de forma mais completa (TypeScript, exportador PPTX, recorrência que gera pedido real, 26 testes). As duas ocupam `/painel-cs` e não convivem. |
| `abastece-vagas` | **Incluída** | Funcionalidade nova, bem testada, com LGPD e currículo em bucket privado. |

Ideia opcional do CS descartado, não incluída: webhooks de alerta para Slack/Teams (`CS_ALERTA_WEBHOOK_URL`).
