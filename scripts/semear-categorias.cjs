#!/usr/bin/env node
// Cria (sem sobrescrever) as 6 categorias de habilitação com perguntas-modelo. Elas nascem INATIVAS e sem vídeo:
// abra Admin → Habilitações, informe o vídeo e a duração REAL, revise as perguntas com seu responsável técnico e marque "ativa".
//   Uso:  FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/semear-categorias.js
const admin = require("firebase-admin");
const C = require("../server/lib/config");
const bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!bruto) { console.error("Defina FIREBASE_SERVICE_ACCOUNT (JSON ou base64)."); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(bruto.trim().startsWith("{") ? bruto : Buffer.from(bruto, "base64").toString("utf8"))) });

const q = (texto, opcoes, correta) => ({ texto, opcoes, correta });
const MODELO = {
  mercearia: [
    q("Ao repor produtos com validade, qual é a regra correta?", ["Os mais novos na frente, para a prateleira ficar bonita", "Os de vencimento mais próximo na frente e os mais novos atrás (PEPS)", "Tanto faz: o cliente escolhe", "Os mais caros na frente"], 1),
    q("Você encontra uma lata estufada ou com a embalagem violada. O que fazer?", ["Colocar no fundo da prateleira", "Retirar da área de venda e avisar o responsável da loja", "Endireitar a embalagem e manter à venda", "Misturar com os produtos bons"], 1),
    q("Antes de abastecer, o que é essencial conferir?", ["Se o produto está sob a etiqueta de preço correta", "Se cabe o máximo de unidades, mesmo sem etiqueta", "Se a embalagem combina com a cor da prateleira", "Nada: a etiqueta não importa"], 0)
  ],
  frios: [
    q("Qual é o cuidado ao repor produtos refrigerados?", ["Tirar todo o estoque da refrigeração de uma vez", "Retirar só o que dá para repor logo, mantendo o restante refrigerado", "Deixar os produtos fora da geladeira até terminar a conversa com o cliente", "Repor primeiro os que já estão quentes"], 1),
    q("Você encontra um produto refrigerado fora da refrigeração e não sabe há quanto tempo. O que fazer?", ["Repor mesmo assim", "Não repor e avisar o responsável", "Colocar no fundo do balcão", "Descartar escondido"], 1),
    q("Antes de manusear frios e laticínios, o que é obrigatório?", ["Lavar bem as mãos e usar o uniforme/EPI exigido pela loja", "Apenas passar álcool nos celulares", "Nada, se as mãos parecerem limpas", "Usar anéis e pulseiras para identificação"], 0)
  ],
  padaria: [
    q("Antes de começar na padaria, qual cuidado de higiene é essencial?", ["Lavar as mãos, prender o cabelo/usar touca e retirar adornos", "Usar perfume forte", "Manter o celular no bolso do avental", "Só lavar as mãos no fim do turno"], 0),
    q("Um pão cai no chão. O que fazer?", ["Soprar e devolver ao balcão", "Descartar e higienizar as mãos", "Passar um pano e vender", "Esconder embaixo da bancada"], 1),
    q("Na reposição de produtos de padaria, qual é a regra?", ["O que foi produzido antes sai primeiro (PEPS)", "O mais novo fica sempre na frente", "Misturar lotes de dias diferentes", "Ignorar a data de produção"], 0)
  ],
  flv: [
    q("Você vê frutas com mofo ou podridão misturadas às boas. O que fazer?", ["Deixar: o cliente escolhe", "Separar e retirar as deterioradas para não estragar as demais", "Cobrir com as frutas novas", "Lavar e recolocar no mesmo lugar"], 1),
    q("Como empilhar produtos delicados (tomate, uva, folhas)?", ["Em camadas baixas, sem amassar e sem excesso de peso", "O mais alto possível para aproveitar espaço", "Jogando de qualquer jeito", "Sempre sob caixas pesadas"], 0),
    q("Na reposição de hortifruti, qual é a regra?", ["Os mais antigos à frente e os novos atrás (PEPS)", "Os mais novos sempre à frente", "Misturar tudo no mesmo cesto", "Esconder os mais maduros no fundo"], 0)
  ],
  deposito: [
    q("Qual é a forma correta de levantar uma caixa pesada?", ["Curvar a coluna e puxar com os braços", "Dobrar os joelhos, manter a coluna reta e a carga junto ao corpo (ou pedir ajuda/usar carrinho)", "Levantar rápido, com impulso", "Carregar sempre sozinho, qualquer peso"], 1),
    q("Como empilhar caixas no depósito?", ["As mais pesadas embaixo, respeitando o limite de empilhamento da embalagem", "As mais pesadas em cima", "Sem limite de altura", "Bloqueando a saída para ganhar espaço"], 0),
    q("Sobre corredores e saídas de emergência:", ["Podem ser usados como estoque temporário", "Devem ficar sempre livres", "Só precisam estar livres à noite", "Não importa, se houver pouco movimento"], 1)
  ],
  degustacao: [
    q("Antes de oferecer degustação, qual cuidado de higiene é obrigatório?", ["Lavar bem as mãos e usar os itens exigidos (touca, luvas, avental) conforme a loja", "Usar o mesmo avental o dia todo sem trocar nunca", "Provar do mesmo recipiente que o cliente", "Nada, se o produto for industrializado"], 0),
    q("O produto da degustação está com a embalagem violada ou vencido. O que fazer?", ["Servir assim mesmo", "Não servir e avisar o responsável", "Servir só para quem pedir", "Misturar com um produto novo"], 1),
    q("Um cliente pergunta se o produto contém alérgenos e você não tem certeza. O que fazer?", ["Garantir que não tem, para não perder a venda", "Não afirmar nada: mostrar a embalagem/rótulo ou chamar o responsável", "Dizer que provavelmente não tem", "Ignorar a pergunta"], 1)
  ]
};

(async () => {
  const db = admin.firestore();
  for (const id of Object.keys(C.CATEGORIAS)) {
    const ref = db.collection("habilitacao_categorias").doc(id);
    if ((await ref.get()).exists) { console.log(`= ${id}: já existe (mantido)`); continue; }
    await ref.set({ categoria: id, titulo: C.CATEGORIAS[id].titulo, descricao: "", provedor: "youtube", videoRef: "", duracaoSeg: 0, perguntas: MODELO[id].map((p, i) => ({ id: `q${i + 1}`, ...p })), ativo: false, versao: 1, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() });
    console.log(`+ ${id}: criada (inativa, sem vídeo)`);
  }
  console.log("Pronto. Agora: Admin → Habilitações → informe vídeo + duração e marque 'ativa'.");
})().catch((e) => { console.error(e.message); process.exit(1); });
