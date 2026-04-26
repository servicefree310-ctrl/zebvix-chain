import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

class SessionRequest {
  final String id;
  final String method;
  // Raw params from the dashboard. EVM JSON-RPC always uses a positional
  // List; we keep it as `dynamic` so we can also accept legacy Map payloads.
  final dynamic params;
  final int? chainId;
  final String? origin;
  final DateTime receivedAt;

  SessionRequest({
    required this.id,
    required this.method,
    required this.params,
    this.chainId,
    this.origin,
    required this.receivedAt,
  });

  /// Returns the params interpreted as a positional list (most EVM RPCs).
  List<dynamic> get paramsList {
    if (params is List) return params as List<dynamic>;
    if (params is Map) return [params];
    return const [];
  }

  /// First param as a Map if present (eg. eth_sendTransaction tx object).
  Map<String, dynamic>? get firstParamMap {
    final l = paramsList;
    if (l.isNotEmpty && l.first is Map) {
      return Map<String, dynamic>.from(l.first as Map);
    }
    if (params is Map) return Map<String, dynamic>.from(params as Map);
    return null;
  }
}

enum SessionStatus { idle, connecting, connected, error, closed }

class SessionRelay extends ChangeNotifier {
  WebSocketChannel? _ch;
  SessionStatus _status = SessionStatus.idle;
  String? _sessionId;
  String? _origin;
  String? _err;
  final List<SessionRequest> _pending = [];
  StreamSubscription? _sub;

  SessionStatus get status => _status;
  String? get sessionId => _sessionId;
  String? get origin => _origin;
  String? get error => _err;
  List<SessionRequest> get pending => List.unmodifiable(_pending);

  Future<void> connect(String uri) async {
    // uri format: zbx://wc?id=<sessionId>&relay=<wss-url>&origin=<dashboard-url>
    // also accepts zebvix:// scheme for the same payload (deep-link from dApp).
    final parsed = Uri.tryParse(uri);
    if (parsed == null ||
        (parsed.scheme != 'zbx' && parsed.scheme != 'zebvix')) {
      _err = 'Invalid session URI';
      _status = SessionStatus.error;
      notifyListeners();
      return;
    }
    final id = parsed.queryParameters['id'];
    final relay = parsed.queryParameters['relay'];
    final origin = parsed.queryParameters['origin'];
    if (id == null || relay == null) {
      _err = 'Missing id or relay';
      _status = SessionStatus.error;
      notifyListeners();
      return;
    }
    await disconnect();
    _sessionId = id;
    _origin = origin;
    _status = SessionStatus.connecting;
    _err = null;
    notifyListeners();
    try {
      _ch = WebSocketChannel.connect(Uri.parse('$relay/$id?role=mobile'));
      await _ch!.ready;
      _status = SessionStatus.connected;
      notifyListeners();
      _sub = _ch!.stream.listen(_onMessage, onError: (e) {
        _err = e.toString();
        _status = SessionStatus.error;
        notifyListeners();
      }, onDone: () {
        _status = SessionStatus.closed;
        notifyListeners();
      });
      // announce connection
      _ch!.sink.add(jsonEncode({'type': 'hello', 'role': 'mobile'}));
    } catch (e) {
      _err = e.toString();
      _status = SessionStatus.error;
      notifyListeners();
    }
  }

  void _onMessage(dynamic data) {
    try {
      final j = jsonDecode(data.toString()) as Map<String, dynamic>;
      final type = j['type'] as String?;
      if (type == 'request') {
        final req = SessionRequest(
          id: j['id'] as String,
          method: j['method'] as String,
          // Accept either positional list (EVM standard) or legacy map.
          params: j['params'] ?? const [],
          chainId: j['chainId'] is int
              ? j['chainId'] as int
              : (j['chainId'] is num
                  ? (j['chainId'] as num).toInt()
                  : null),
          origin: _origin,
          receivedAt: DateTime.now(),
        );
        _pending.add(req);
        notifyListeners();
      }
    } catch (_) {}
  }

  void approve(SessionRequest req, Map<String, dynamic> result) {
    _ch?.sink.add(jsonEncode({
      'type': 'response',
      'id': req.id,
      'result': result,
    }));
    _pending.removeWhere((r) => r.id == req.id);
    notifyListeners();
  }

  void reject(SessionRequest req, String reason) {
    _ch?.sink.add(jsonEncode({
      'type': 'response',
      'id': req.id,
      'error': reason,
    }));
    _pending.removeWhere((r) => r.id == req.id);
    notifyListeners();
  }

  Future<void> disconnect() async {
    await _sub?.cancel();
    _sub = null;
    await _ch?.sink.close();
    _ch = null;
    _status = SessionStatus.idle;
    _sessionId = null;
    _origin = null;
    _pending.clear();
    notifyListeners();
  }

  @override
  void dispose() {
    disconnect();
    super.dispose();
  }
}
