import 'dart:convert';
import 'dart:typed_data';
import 'package:hex/hex.dart';
import 'package:http/http.dart' as http;
import 'package:web3dart/crypto.dart';
import 'package:web3dart/web3dart.dart';
import 'chains.dart';

class RpcClient {
  final ChainConfig chain;
  late final Web3Client _web3;
  final http.Client _http;
  int _id = 0;

  RpcClient(this.chain, {http.Client? httpClient})
      : _http = httpClient ?? http.Client() {
    _web3 = Web3Client(chain.rpcUrl, _http);
  }

  Web3Client get web3 => _web3;

  Future<dynamic> call(String method, [List<dynamic> params = const []]) async {
    _id++;
    final body = jsonEncode({
      'jsonrpc': '2.0',
      'id': _id,
      'method': method,
      'params': params,
    });
    final res = await _http.post(
      Uri.parse(chain.rpcUrl),
      headers: {'content-type': 'application/json'},
      body: body,
    );
    if (res.statusCode != 200) {
      throw Exception('RPC ${res.statusCode}: ${res.body}');
    }
    final j = jsonDecode(res.body) as Map<String, dynamic>;
    if (j['error'] != null) {
      final err = j['error'] as Map<String, dynamic>;
      throw Exception('RPC error: ${err['message']}');
    }
    return j['result'];
  }

  Future<int> blockNumber() async {
    final hex = (await call('eth_blockNumber')) as String;
    return int.parse(hex.replaceFirst('0x', ''), radix: 16);
  }

  /// Zebvix L1 only: H6 admin kill-switch state.
  /// Fail-open (returns false) on any RPC error so a temporary network blip
  /// doesn't block the bridge UI for the user. The actual chain-side enforcement
  /// will reject the tx if the bridge is paused, so this is just UX guidance.
  Future<bool> bridgePaused() async {
    try {
      final res = await call('zbx_bridgePaused');
      if (res is Map && res['paused'] == true) return true;
      return false;
    } catch (_) {
      return false;
    }
  }

  Future<BigInt> nativeBalance(String address) async {
    final hex = (await call('eth_getBalance', [address, 'latest'])) as String;
    return BigInt.parse(hex.replaceFirst('0x', ''), radix: 16);
  }

  Future<BigInt> erc20Balance(String token, String address) async {
    final selector = _selector('balanceOf(address)');
    final padded = address.replaceFirst('0x', '').padLeft(64, '0');
    final data = '0x$selector$padded';
    final res = await call('eth_call', [
      {'to': token, 'data': data},
      'latest',
    ]) as String;
    if (res.length <= 2) return BigInt.zero;
    return BigInt.parse(res.replaceFirst('0x', ''), radix: 16);
  }

  Future<BigInt> erc20Allowance(String token, String owner, String spender) async {
    final selector = _selector('allowance(address,address)');
    final o = owner.replaceFirst('0x', '').padLeft(64, '0');
    final s = spender.replaceFirst('0x', '').padLeft(64, '0');
    final data = '0x$selector$o$s';
    final res = await call('eth_call', [
      {'to': token, 'data': data},
      'latest',
    ]) as String;
    if (res.length <= 2) return BigInt.zero;
    return BigInt.parse(res.replaceFirst('0x', ''), radix: 16);
  }

  Future<int> getNonce(String address) async {
    final hex =
        (await call('eth_getTransactionCount', [address, 'pending'])) as String;
    return int.parse(hex.replaceFirst('0x', ''), radix: 16);
  }

  Future<BigInt> gasPrice() async {
    final hex = (await call('eth_gasPrice')) as String;
    return BigInt.parse(hex.replaceFirst('0x', ''), radix: 16);
  }

  Future<BigInt> estimateGas({
    required String from,
    required String to,
    String data = '0x',
    BigInt? value,
  }) async {
    final params = <String, dynamic>{'from': from, 'to': to, 'data': data};
    if (value != null) params['value'] = '0x${value.toRadixString(16)}';
    final hex = (await call('eth_estimateGas', [params])) as String;
    return BigInt.parse(hex.replaceFirst('0x', ''), radix: 16);
  }

  Future<String> sendNative({
    required EthPrivateKey credentials,
    required String to,
    required BigInt valueWei,
  }) async {
    final tx = Transaction(
      to: EthereumAddress.fromHex(to),
      value: EtherAmount.inWei(valueWei),
    );
    final hash = await _web3.sendTransaction(credentials, tx,
        chainId: chain.chainId);
    return hash;
  }

  Future<String> sendRawCall({
    required EthPrivateKey credentials,
    required String to,
    required String data,
    BigInt? value,
    int? gasLimit,
  }) async {
    final tx = Transaction(
      to: EthereumAddress.fromHex(to),
      data: Uint8List.fromList(HEX.decode(data.replaceFirst('0x', ''))),
      value: value != null ? EtherAmount.inWei(value) : null,
      maxGas: gasLimit,
    );
    return await _web3.sendTransaction(credentials, tx,
        chainId: chain.chainId);
  }

  String _selector(String signature) {
    final h = keccak256(Uint8List.fromList(utf8.encode(signature)));
    return HEX.encode(h.sublist(0, 4));
  }

  void close() {
    _web3.dispose();
    _http.close();
  }
}

class RpcRegistry {
  final Map<String, RpcClient> _clients = {};

  RpcClient get(ChainConfig chain) {
    return _clients.putIfAbsent(chain.id, () => RpcClient(chain));
  }

  void disposeAll() {
    for (final c in _clients.values) {
      c.close();
    }
    _clients.clear();
  }
}
