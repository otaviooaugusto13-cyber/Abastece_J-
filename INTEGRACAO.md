# Cursos por categoria · Perfil inteligente (Eneagrama) · Ofertas por localização (20 km)

## O que foi entregue
| Pedido | Onde | Como funciona |
|---|---|---|
| **Cursos** no menu, por categoria | `promotor.html` (Menu → Cursos), `cursos.js`, `script-personal.js` (`renderCursos`) | Modal interno com categorias recolhíveis e progresso por categoria. O vídeo abre no player interno (`sheet-video`). |
| Categorias e obrigatoriedade | `server/lib/treinamento.js`, `admin.html/js` | Cada módulo tem `categoria` e `obrigatorio`. **Obrigatórios** = habilitação PRATICAMENTE (sequencial, libera turnos, categoria forçada `habilitacao`). **Opcionais** ficam sempre abertos e **não** entram na habilitação. Módulos antigos (sem o campo) continuam obrigatórios. |
| Experiência + Eneagrama em **Meus dados** | `promotor.html`, `perfil-inteligente.js`, `PUT/GET /perfil/promotor/inteligente` | Lista de experiências (área + tempo), Eneagrama (tipo/asa/instinto ou código `PM-3w2-SO`), bio e palavras-chave geradas em tempo real; se o promotor editar a bio à mão, a atualização automática pausa (botão "Gerar de novo"). |
| **Ofertas da cidade** com contadores | `geo.js` (`contarPorCidade`), chips no topo de Ofertas | Contadores **reais** (vagas abertas por cidade, em tempo real via snapshot). Os números 43/105/50 do enunciado eram exemplos. |
| **GPS em tempo real + raio de 20 km** | `geo.js` (`observarPosicao`, `filtrarPorRaio`), `config.js` (`RAIO_KM_OFERTAS`) | Ao abrir Ofertas o app pede a posição e acompanha (`watchPosition`); para ao sair da aba ou ao ir para segundo plano. Só recalcula se andou > 200 m. Sem permissão: usa a cidade do perfil ou uma escolhida na lista. |
| **Ranking** posição + experiência + Eneagrama | `perfil-inteligente.js` (`pontuarOferta`) | Score 0–100 = proximidade 40% + experiência 35% + perfil 25%. Fator desconhecido não penaliza (pesos redistribuídos). Mostra anel de match, motivos e "Sugeridas para você". |
| Detalhe da vaga **sem sair do app** | `sheet-oferta` | Modal com radar SVG (distância), dados, barras de compatibilidade e "Aceitar turno". Sem link para mapas. |

## Mudanças obrigatórias de infraestrutura (sem elas o GPS não funciona)
1. **`server/lib/seguranca.js`**: `Permissions-Policy` estava `geolocation=()` (bloqueava o GPS). Agora `geolocation=(self)`.
2. **`firestore.rules`**: a loja pode gravar `cidade`, `uf`, `lat`, `lng` (números dentro da caixa do Brasil). Publique: `firebase deploy --only firestore:rules`.
3. **As vagas não tinham localização.** Agora `POST /criarPedido` copia `cidade/uf/lat/lng` do cadastro da loja (lido no servidor; o cliente não consegue forçar coordenadas). **A loja precisa preencher a cidade** em *Dados da empresa* (lista de cidades ou "Usar minha localização"). Vagas já abertas antes do deploy não têm localização e só aparecem em "Todas".
4. **HTTPS** é exigido pelo navegador para geolocalização (Render já é; em `localhost` também funciona).

## Eneagrama: como o resultado chega ao perfil
O teste (repo `teste-eneagrama`) guarda o resultado só no `sessionStorage` do domínio dele e envia por e-mail/Formspree — **não há onde o app ler direto**. Por isso há 4 caminhos, todos validados:
- **Seleção manual** (tipo/asa/instinto) em Meus dados.
- **Código** `PM-3w2-SO` (o teste agora mostra e copia esse código — patch em `teste-eneagrama.diff`).
- **Link** `promotor.html?eneagrama=PM-3w2-SO`.
- **Dentro do app** (opcional): defina `ENEAGRAMA_TESTE_URL` em `config.js`, `ENEAGRAMA_TESTE_ORIGEM` no Render (mesma origem; libera o `frame-src` do CSP) e `ABASTECE_ORIGEM` no `script.js` do teste. Ao concluir, o teste avisa por `postMessage` (só a origem configurada é aceita) e o perfil é salvo sozinho.

Privacidade: o Eneagrama fica em `profissionais_perfil` (só servidor) e **não** vai ao perfil público. Lojas veem apenas bio, palavras-chave e áreas de experiência.

## Limites e decisões que você deve conhecer
- **Bio/palavras-chave são geradas por regras** (determinístico, offline, sem custo, sem inventar fatos). Não usa IA generativa. Os textos por tipo vêm das "forças" do próprio teste.
- **Afinidade Eneagrama × setor é heurística de produto**, não ciência validada (tabelas em `perfil-inteligente.js`). Pesa 25% e é só sugestão — não aprova nem reprova ninguém. Revise com a equipe PRATICAMENTE.
- **Tabela de cidades** (`geo.js`): ~40 cidades com centro municipal aproximado (±1–2 km, digitado de referência, **confira antes de produção**). Adicione linhas conforme expandir. Loja com GPS grava coordenada exata.
- Distância é em **linha reta** (não por rota).
- Os links de WhatsApp já existentes (suporte, compartilhar convite, enviar cobrança) continuam abrindo fora do app — são ações explícitas de compartilhamento. Nada novo abre aba externa.
- Cursos: **nenhum vídeo foi inventado**. Cadastre-os em *Admin → Treinamento* (desmarque "obrigatório" e escolha a categoria).

## Testes
`npm test` → paridade financeira, **12 testes novos de front** (`test/perfil.test.js`: distância/raio/contadores, código do Eneagrama, bio ≤ 300, ranking, cursos, cabeçalhos) e **39 de backend** (8 novos: cursos opcionais, perfil inteligente, validação, vaga herdando localização, regras, cabeçalhos). Rodados em ambiente simulado; **não foram testados em navegador real nem em Firestore real**.
