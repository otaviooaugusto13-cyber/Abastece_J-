import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

/// URL do backend no Render (HTTPS, nunca localhost).
/// Sobrescreva no build: flutter run --dart-define=API_BASE_URL=https://seu-servico.onrender.com
const String kApiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'https://abastece-ja.onrender.com',
);

class PagamentoException implements Exception {
  PagamentoException(this.mensagem, {this.codigo});
  final String mensagem;
  final String? codigo;
  @override
  String toString() => mensagem;
}

class StatusPagamento {
  StatusPagamento({required this.status, required this.paga, this.notaId});
  final String status;
  final bool paga;
  final String? notaId;
}

class Cobranca {
  Cobranca({required this.initPoint, required this.total});
  final Uri initPoint;
  final int total; // centavos
}

class PagamentoService {
  PagamentoService({http.Client? cliente}) : _http = cliente ?? http.Client();
  final http.Client _http;

  Future<Map<String, String>> _headers() async {
    final token = await FirebaseAuth.instance.currentUser?.getIdToken();
    if (token == null) throw PagamentoException('Sessão expirada. Entre novamente.', codigo: 'sem-sessao');
    return {'Authorization': 'Bearer $token', 'Content-Type': 'application/json'};
  }

  Map<String, dynamic> _corpo(http.Response r) {
    Map<String, dynamic> j;
    try {
      j = jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
    } catch (_) {
      j = {};
    }
    if (r.statusCode >= 400) {
      throw PagamentoException(
        (j['erro'] as String?) ?? 'Falha de comunicação com o servidor (${r.statusCode}).',
        codigo: j['codigo'] as String?,
      );
    }
    return j;
  }

  /// Pede ao backend a preferência do Mercado Pago e devolve o init_point.
  /// `origem: 'app'` faz o servidor usar back_urls que voltam ao app por deep link.
  Future<Cobranca> criarCobranca(String solicitacaoId) async {
    final r = await _http
        .post(
          Uri.parse('$kApiBaseUrl/criarCobranca'),
          headers: await _headers(),
          body: jsonEncode({'solicitacaoId': solicitacaoId, 'origem': 'app'}),
        )
        .timeout(const Duration(seconds: 30));
    final j = _corpo(r);
    final link = j['init_point'] as String?;
    if (link == null || !link.startsWith('https://')) {
      throw PagamentoException('Link de pagamento inválido.');
    }
    return Cobranca(initPoint: Uri.parse(link), total: (j['total'] as num?)?.toInt() ?? 0);
  }

  Future<StatusPagamento> status(String solicitacaoId) async {
    final r = await _http
        .get(
          Uri.parse('$kApiBaseUrl/statusPagamento?solicitacaoId=${Uri.encodeQueryComponent(solicitacaoId)}'),
          headers: await _headers(),
        )
        .timeout(const Duration(seconds: 20));
    final j = _corpo(r);
    return StatusPagamento(
      status: (j['status'] as String?) ?? '',
      paga: j['paga'] == true,
      notaId: j['notaId'] as String?,
    );
  }

  /// O servidor consulta o pagamento no Mercado Pago (não confia no que veio no deep link).
  /// Retorna true se aprovado e já registrado.
  Future<bool> confirmar(String solicitacaoId, String paymentId) async {
    final r = await _http
        .post(
          Uri.parse('$kApiBaseUrl/confirmarPagamento'),
          headers: await _headers(),
          body: jsonEncode({'solicitacaoId': solicitacaoId, 'paymentId': paymentId}),
        )
        .timeout(const Duration(seconds: 30));
    final j = _corpo(r);
    return j['aprovado'] == true || j['jaPago'] == true;
  }
}
