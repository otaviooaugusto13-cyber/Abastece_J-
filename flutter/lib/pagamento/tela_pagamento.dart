import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter_custom_tabs/flutter_custom_tabs.dart';

import 'pagamento_service.dart';

enum _Fase { resumo, abrindo, aguardando, aprovado, pendente, falhou }

/// Tela de pagamento (Checkout Pro). Fluxo:
/// 1) POST /criarCobranca → init_point  2) abre em Custom Tab  3) Mercado Pago redireciona para
/// https://<render>/pagamento/retorno/<status>, que abre abastecejapay://pagamento?...  4) o app fecha a aba
/// e confirma no servidor (webhook também confirma; o app consulta até o pedido ficar "paga").
class TelaPagamento extends StatefulWidget {
  const TelaPagamento({
    super.key,
    required this.solicitacaoId,
    required this.titulo,
    this.detalhe,
    this.totalCentavos,
    this.aoAprovar,
  });

  final String solicitacaoId;
  final String titulo;
  final String? detalhe;
  final int? totalCentavos;

  /// Chamado quando o pedido passa para "paga" (ex.: recarregar a lista de pedidos / abrir a nota).
  final void Function(String? notaId)? aoAprovar;

  @override
  State<TelaPagamento> createState() => _TelaPagamentoState();
}

class _TelaPagamentoState extends State<TelaPagamento> with WidgetsBindingObserver {
  final _service = PagamentoService();
  final _links = AppLinks();
  StreamSubscription<Uri>? _sub;
  Timer? _poll;
  _Fase _fase = _Fase.resumo;
  String? _erro;
  String? _notaId;
  bool _abriuAba = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Cobre o deep link com o app já aberto (uriLinkStream) — o link inicial é tratado em main.dart se o app estava fechado.
    _sub = _links.uriLinkStream.listen(_aoReceberLink);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _sub?.cancel();
    _poll?.cancel();
    super.dispose();
  }

  /// Se o usuário fechar a aba manualmente (sem passar pelo deep link), conferimos o status ao voltar ao app.
  @override
  void didChangeAppLifecycleState(AppLifecycleState estado) {
    if (estado == AppLifecycleState.resumed && _abriuAba && _fase == _Fase.abrindo) {
      setState(() => _fase = _Fase.aguardando);
      _acompanhar();
    }
  }

  Future<void> _pagar() async {
    setState(() {
      _fase = _Fase.abrindo;
      _erro = null;
    });
    try {
      final cobranca = await _service.criarCobranca(widget.solicitacaoId);
      final cor = Theme.of(context).colorScheme;
      _abriuAba = true;
      await launchUrl(
        cobranca.initPoint,
        customTabsOptions: CustomTabsOptions(
          colorSchemes: CustomTabsColorSchemes.defaults(toolbarColor: cor.surface),
          shareState: CustomTabsShareState.off,
          urlBarHidingEnabled: true,
          showTitle: true,
        ),
        safariVCOptions: SafariViewControllerOptions(
          preferredBarTintColor: cor.surface,
          preferredControlTintColor: cor.primary,
          barCollapsingEnabled: true,
          dismissButtonStyle: SafariViewControllerDismissButtonStyle.close,
        ),
      );
    } on PagamentoException catch (e) {
      _falhar(e.mensagem);
    } catch (_) {
      _falhar('Não foi possível abrir o pagamento. Verifique sua conexão e tente de novo.');
    }
  }

  void _falhar(String msg) {
    if (!mounted) return;
    setState(() {
      _fase = _Fase.resumo;
      _erro = msg;
    });
  }

  /// abastecejapay://pagamento?status=success|pending|failure&id=<pedido>&payment_id=<mp>
  Future<void> _aoReceberLink(Uri uri) async {
    if (uri.scheme != 'abastecejapay' || uri.host != 'pagamento') return;
    final id = uri.queryParameters['id'];
    if (id != null && id != widget.solicitacaoId) return; // link de outro pedido
    await closeCustomTabs(); // fecha a aba (no iOS fecha o SFSafariViewController)
    final status = uri.queryParameters['status'];
    final paymentId = uri.queryParameters['payment_id'];
    if (!mounted) return;

    if (status == 'failure') {
      setState(() {
        _fase = _Fase.falhou;
        _erro = 'O pagamento não foi concluído. Você pode tentar de novo.';
      });
      return;
    }
    setState(() => _fase = _Fase.aguardando);
    // O deep link NÃO prova pagamento: o servidor consulta o Mercado Pago.
    if (paymentId != null) {
      try {
        if (await _service.confirmar(widget.solicitacaoId, paymentId)) return _concluir();
      } on PagamentoException catch (_) {/* o polling abaixo e o webhook resolvem */}
    }
    _acompanhar(pendente: status == 'pending');
  }

  /// Consulta o status do pedido até ficar "paga" (webhook pode chegar depois do retorno; Pix pode demorar).
  void _acompanhar({bool pendente = false}) {
    _poll?.cancel();
    var tentativas = 0;
    _poll = Timer.periodic(const Duration(seconds: 3), (t) async {
      tentativas++;
      try {
        final s = await _service.status(widget.solicitacaoId);
        if (s.paga) {
          _notaId = s.notaId;
          t.cancel();
          return _concluir();
        }
      } catch (_) {/* tenta de novo */}
      if (tentativas >= 20 && mounted) {
        t.cancel();
        setState(() => _fase = _Fase.pendente);
      }
    });
  }

  Future<void> _concluir() async {
    _poll?.cancel();
    if (_notaId == null) {
      try {
        _notaId = (await _service.status(widget.solicitacaoId)).notaId;
      } catch (_) {}
    }
    if (!mounted) return;
    setState(() => _fase = _Fase.aprovado);
    widget.aoAprovar?.call(_notaId);
  }

  String _brl(int c) => 'R\$ ${(c / 100).toStringAsFixed(2).replaceAll('.', ',')}';

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Pagamento')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: switch (_fase) {
            _Fase.aprovado => _estado(Icons.check_circle, Colors.green, 'Pagamento confirmado!', 'Sua nota já está disponível.',
                acao: FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Concluir'))),
            _Fase.pendente => _estado(Icons.hourglass_top, Colors.orange, 'Pagamento em análise',
                'Se você pagou com Pix, a confirmação é automática assim que o banco liberar. Você pode fechar esta tela.',
                acao: OutlinedButton(onPressed: () {
                  setState(() => _fase = _Fase.aguardando);
                  _acompanhar();
                }, child: const Text('Verificar novamente'))),
            _Fase.aguardando => _estado(null, null, 'Confirmando pagamento…', 'Pode levar alguns segundos.'),
            _ => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(widget.titulo, style: tema.textTheme.titleLarge),
                if (widget.detalhe != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(widget.detalhe!)),
                const SizedBox(height: 20),
                if (widget.totalCentavos != null)
                  Card(child: ListTile(title: const Text('Total a pagar'), trailing: Text(_brl(widget.totalCentavos!), style: tema.textTheme.titleMedium))),
                if (_erro != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_erro!, style: TextStyle(color: tema.colorScheme.error))),
                const Spacer(),
                FilledButton.icon(
                  onPressed: _fase == _Fase.abrindo ? null : _pagar,
                  icon: _fase == _Fase.abrindo
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.lock),
                  label: Text(_fase == _Fase.falhou ? 'Tentar novamente' : 'Pagar com Pix ou cartão'),
                ),
                const SizedBox(height: 8),
                const Text('🔒 Pagamento processado com segurança pelo Mercado Pago.', textAlign: TextAlign.center, style: TextStyle(fontSize: 12)),
              ]),
          },
        ),
      ),
    );
  }

  Widget _estado(IconData? icone, Color? cor, String titulo, String texto, {Widget? acao}) => Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          icone != null ? Icon(icone, size: 64, color: cor) : const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(titulo, style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text(texto, textAlign: TextAlign.center),
          if (acao != null) ...[const SizedBox(height: 20), acao],
        ]),
      );
}
