import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

class PairPayload {
  final int v;
  final String sessionId;
  final String secret;
  final String chain;
  final int chainId;
  PairPayload({
    required this.v,
    required this.sessionId,
    required this.secret,
    required this.chain,
    required this.chainId,
  });

  static PairPayload? tryDecode(String raw) {
    try {
      var s = raw.trim();
      if (s.startsWith('zbxconnect:')) s = s.substring('zbxconnect:'.length);
      // base64url -> bytes -> json
      var padded = s.replaceAll('-', '+').replaceAll('_', '/');
      while (padded.length % 4 != 0) {
        padded += '=';
      }
      final bytes = base64.decode(padded);
      final j = jsonDecode(utf8.decode(bytes)) as Map<String, dynamic>;
      return PairPayload(
        v: (j['v'] as num?)?.toInt() ?? 1,
        sessionId: j['sid']?.toString() ?? '',
        secret: j['sec']?.toString() ?? '',
        chain: j['chain']?.toString() ?? 'zebvix',
        chainId: (j['cid'] as num?)?.toInt() ?? 7878,
      );
    } catch (_) {
      return null;
    }
  }
}

class SignRequest {
  final String id;
  final String type;
  final Map<String, dynamic> payload;
  final int createdAt;
  SignRequest({
    required this.id,
    required this.type,
    required this.payload,
    required this.createdAt,
  });

  static SignRequest fromJson(Map<String, dynamic> j) => SignRequest(
        id: j['id'].toString(),
        type: j['type'].toString(),
        payload: (j['payload'] as Map?)?.cast<String, dynamic>() ?? {},
        createdAt:
            (j['createdAt'] as num?)?.toInt() ?? DateTime.now().millisecondsSinceEpoch,
      );
}

class PairingService {
  String relayBase; // e.g. https://your-replit-url/api
  PairingService(this.relayBase);

  String? sessionId;
  String? secret;
  bool active = false;
  int _since = 0;
  Timer? _pollTimer;
  final _events = StreamController<SignRequest>.broadcast();
  Stream<SignRequest> get incoming => _events.stream;

  Future<void> connect({
    required PairPayload payload,
    required String address,
    String? payIdName,
  }) async {
    sessionId = payload.sessionId;
    secret = payload.secret;
    final r = await http.post(
      Uri.parse('$relayBase/pair/connect/$sessionId'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'secret': secret,
        'address': address,
        'payIdName': payIdName,
        'meta': {'app': 'zebvix-wallet', 'platform': 'flutter'},
      }),
    );
    if (r.statusCode != 200) {
      throw Exception('connect failed: ${r.statusCode} ${r.body}');
    }
    active = true;
    _startPolling();
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 1), (_) => _poll());
  }

  Future<void> _poll() async {
    if (!active || sessionId == null) return;
    try {
      final r = await http
          .get(Uri.parse('$relayBase/pair/poll/$sessionId?since=$_since&wait=4000'))
          .timeout(const Duration(seconds: 10));
      if (r.statusCode != 200) return;
      final j = jsonDecode(r.body) as Map<String, dynamic>;
      final reqs = (j['requests'] as List?) ?? [];
      for (final raw in reqs) {
        final m = (raw as Map).cast<String, dynamic>();
        final ev = SignRequest.fromJson(m);
        if (ev.createdAt > _since) _since = ev.createdAt;
        _events.add(ev);
      }
    } catch (_) {
      /* ignore */
    }
  }

  Future<void> respond({
    required String requestId,
    required String status, // approved | rejected | error
    Map<String, dynamic>? result,
    String? error,
  }) async {
    await http.post(
      Uri.parse('$relayBase/pair/respond/$sessionId'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'requestId': requestId,
        'status': status,
        'result': result,
        'error': error,
      }),
    );
  }

  Future<void> disconnect() async {
    if (sessionId != null) {
      await http
          .post(Uri.parse('$relayBase/pair/disconnect/$sessionId'))
          .catchError((_) => http.Response('', 0));
    }
    active = false;
    sessionId = null;
    secret = null;
    _pollTimer?.cancel();
  }

  void dispose() {
    _pollTimer?.cancel();
    _events.close();
  }
}
