import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

class RpcException implements Exception {
  final int? code;
  final String message;
  RpcException(this.message, {this.code});
  @override
  String toString() => 'RpcException(code=$code, $message)';
}

class ZbxRpc {
  String endpoint;
  ZbxRpc(this.endpoint);

  int _id = 1;

  Future<dynamic> call(String method, [List<dynamic>? params]) async {
    final body = jsonEncode({
      'jsonrpc': '2.0',
      'id': _id++,
      'method': method,
      'params': params ?? const [],
    });
    final r = await http
        .post(Uri.parse(endpoint),
            headers: {'Content-Type': 'application/json'}, body: body)
        .timeout(const Duration(seconds: 15));
    if (r.statusCode != 200) {
      throw RpcException('HTTP ${r.statusCode}: ${r.body}');
    }
    final j = jsonDecode(r.body) as Map<String, dynamic>;
    if (j['error'] != null) {
      final e = j['error'] as Map<String, dynamic>;
      throw RpcException(e['message']?.toString() ?? 'rpc error',
          code: e['code'] as int?);
    }
    return j['result'];
  }

  // Convenience helpers
  Future<int> blockNumber() async {
    final r = await call('zbx_blockNumber');
    if (r is Map && r['height'] != null) return (r['height'] as num).toInt();
    if (r is num) return r.toInt();
    if (r is String) return int.parse(r.replaceFirst('0x', ''), radix: 16);
    return 0;
  }

  Future<String> getBalance(String addr) async {
    final r = await call('zbx_getBalance', [addr]);
    return r?.toString() ?? '0x0';
  }

  Future<String> getZusdBalance(String addr) async {
    try {
      final r = await call('zbx_getZusdBalance', [addr]);
      return r?.toString() ?? '0x0';
    } catch (_) {
      return '0x0';
    }
  }

  Future<String> getNonce(String addr) async {
    final r = await call('zbx_getNonce', [addr]);
    return r?.toString() ?? '0x0';
  }

  Future<Map<String, dynamic>?> getDelegations(String addr) async {
    try {
      final r = await call('zbx_getDelegationsByDelegator', [addr]);
      return r as Map<String, dynamic>?;
    } catch (_) {
      return null;
    }
  }

  Future<Map<String, dynamic>?> getLockedRewards(String addr) async {
    try {
      final r = await call('zbx_getLockedRewards', [addr]);
      return r as Map<String, dynamic>?;
    } catch (_) {
      return null;
    }
  }

  Future<Map<String, dynamic>?> getPayIdOf(String addr) async {
    try {
      final r = await call('zbx_getPayIdOf', [addr]);
      return r as Map<String, dynamic>?;
    } catch (_) {
      return null;
    }
  }

  Future<Map<String, dynamic>?> getMultisig(String addr) async {
    try {
      final r = await call('zbx_getMultisig', [addr]);
      return r as Map<String, dynamic>?;
    } catch (_) {
      return null;
    }
  }

  Future<Map<String, dynamic>?> getBlock(int height) async {
    try {
      final r = await call('zbx_getBlockByNumber', [height]);
      return r as Map<String, dynamic>?;
    } catch (_) {
      return null;
    }
  }

  Future<Map<String, dynamic>?> getSupply() async {
    try {
      final r = await call('zbx_supply');
      return r as Map<String, dynamic>?;
    } catch (_) {
      return null;
    }
  }

  /// Submit a hex-encoded bincode SignedTx (wire format expected by chain).
  Future<dynamic> sendRawHex(String hexTx) async {
    return call('zbx_sendRawTransaction', [hexTx]);
  }

  /// Legacy JSON path — kept for callers that haven't migrated to bincode hex.
  Future<dynamic> sendRaw(Map<String, dynamic> signedTx) async {
    return call('zbx_sendTransaction', [signedTx]);
  }
}
