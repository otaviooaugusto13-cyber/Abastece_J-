// Como chamar a tela a partir da lista de pedidos (pedido já ACEITO pelo promotor e com check-out feito):
//
//   final pago = await Navigator.of(context).push<bool>(MaterialPageRoute(
//     builder: (_) => TelaPagamento(
//       solicitacaoId: pedido.id,
//       titulo: 'Reposição — ${pedido.loja}',
//       detalhe: '${pedido.data} · ${pedido.horario}',
//       totalCentavos: 20000,               // só exibição: quem cobra é o servidor (o preço nunca vem do app)
//       aoAprovar: (notaId) { /* recarregar pedidos / abrir nota */ },
//     ),
//   ));
//
// Deep link com o app FECHADO (ex.: o Android matou o app durante o pagamento): em main.dart, ao iniciar,
//   final inicial = await AppLinks().getInitialLink();
//   if (inicial?.scheme == 'abastecejapay' && inicial?.host == 'pagamento') {
//     final id = inicial!.queryParameters['id'];   // abra TelaPagamento(solicitacaoId: id!) — ela consulta o status sozinha ao tocar em verificar
//   }
