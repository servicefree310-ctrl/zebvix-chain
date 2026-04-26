import 'dart:convert';
import 'dart:typed_data';
import 'package:hex/hex.dart';
import 'package:web3dart/credentials.dart';
import 'package:web3dart/crypto.dart';
import '../core/chains.dart';
import '../core/rpc_client.dart';

enum BridgeDirection { zebvixToBsc, bscToZebvix }

class BridgeQuote {
  final BridgeDirection direction;
  final BigInt amountWei;
  final String recipient;
  final String estimatedArrival;
  final String sourceFee;
  final bool needsApproval;

  BridgeQuote({
    required this.direction,
    required this.amountWei,
    required this.recipient,
    required this.estimatedArrival,
    required this.sourceFee,
    required this.needsApproval,
  });
}

class BridgeService {
  final RpcRegistry _rpc;

  BridgeService(this._rpc);

  String _selector(String sig) {
    final h = keccak256(Uint8List.fromList(utf8.encode(sig)));
    return HEX.encode(h.sublist(0, 4));
  }

  String _padAddr(String a) => a.replaceFirst('0x', '').padLeft(64, '0');
  String _padUint(BigInt n) => n.toRadixString(16).padLeft(64, '0');

  Future<bool> needsApproval({
    required String owner,
    required BigInt amount,
  }) async {
    final bsc = _rpc.get(Chains.bsc);
    if (Chains.bsc.wrappedToken == null || Chains.bsc.bridgeContract == null) {
      return true;
    }
    try {
      final allow = await bsc.erc20Allowance(
        Chains.bsc.wrappedToken!,
        owner,
        Chains.bsc.bridgeContract!,
      );
      return allow < amount;
    } catch (_) {
      return true;
    }
  }

  Future<String> approveWZbx({
    required EthPrivateKey credentials,
    required BigInt amount,
  }) async {
    final bsc = _rpc.get(Chains.bsc);
    final selector = _selector('approve(address,uint256)');
    final spender = _padAddr(Chains.bsc.bridgeContract!);
    final amt = _padUint(amount);
    final data = '0x$selector$spender$amt';
    return await bsc.sendRawCall(
      credentials: credentials,
      to: Chains.bsc.wrappedToken!,
      data: data,
    );
  }

  Future<String> burnToZebvix({
    required EthPrivateKey credentials,
    required String zebvixDest,
    required BigInt amount,
  }) async {
    final bsc = _rpc.get(Chains.bsc);
    final selector = _selector('burnToZebvix(string,uint256)');
    // ABI encode (string, uint256)
    final destBytes = utf8.encode(zebvixDest);
    final destLen = destBytes.length;
    final destPadded = ((destLen + 31) ~/ 32) * 32;
    final body = Uint8List(destPadded);
    body.setRange(0, destLen, destBytes);
    final offsetHex = (64).toRadixString(16).padLeft(64, '0');
    final amtHex = _padUint(amount);
    final lenHex = destLen.toRadixString(16).padLeft(64, '0');
    final bodyHex = HEX.encode(body);
    final data = '0x$selector$offsetHex$amtHex$lenHex$bodyHex';
    return await bsc.sendRawCall(
      credentials: credentials,
      to: Chains.bsc.bridgeContract!,
      data: data,
    );
  }

  Future<String> bridgeOutFromZebvix({
    required EthPrivateKey credentials,
    required String bscRecipient,
    required BigInt amountWei,
  }) async {
    // Zebvix-side bridge out: a native send to the bridge with destination encoded in data
    final z = _rpc.get(Chains.zebvix);
    final to = bscRecipient.replaceFirst('0x', '').padLeft(40, '0');
    final data = '0x6272696467655f6f7574$to';
    return await z.sendRawCall(
      credentials: credentials,
      to: '0x0000000000000000000000000000000000001011',
      data: data,
      value: amountWei,
    );
  }
}
