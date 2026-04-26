import 'dart:convert';
import 'dart:typed_data';
import 'package:hex/hex.dart';
import 'package:web3dart/credentials.dart';
import 'package:web3dart/crypto.dart';
import '../core/chains.dart';
import '../core/rpc_client.dart';

/// PancakeSwap V2 router on BSC Mainnet.
const pancakeRouter = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const wbnb = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

class SwapToken {
  final ChainConfig chain;
  final String symbol;
  final int decimals;
  // null contract == native (ZBX/BNB/ETH/POL/native).
  final String? contract;

  const SwapToken({
    required this.chain,
    required this.symbol,
    required this.decimals,
    this.contract,
  });

  bool get isNative => contract == null;
  String get id =>
      '${chain.id}:${(contract ?? 'native').toLowerCase()}';
}

class SwapQuote {
  final BigInt amountInWei;
  final BigInt amountOutWei;
  final List<String> route; // ERC20 path used (symbol or 0xabc..)
  final BigInt minOutWei;
  final double priceImpactPct;
  final SwapToken tokenIn;
  final SwapToken tokenOut;

  const SwapQuote({
    required this.amountInWei,
    required this.amountOutWei,
    required this.route,
    required this.minOutWei,
    required this.priceImpactPct,
    required this.tokenIn,
    required this.tokenOut,
  });
}

class SwapService {
  final RpcRegistry _rpc;
  SwapService(this._rpc);

  String _selector(String sig) {
    final h = keccak256(Uint8List.fromList(utf8.encode(sig)));
    return HEX.encode(h.sublist(0, 4));
  }

  String _padAddr(String a) => a.replaceFirst('0x', '').padLeft(64, '0');
  String _padUint(BigInt n) => n.toRadixString(16).padLeft(64, '0');

  /// Pure-BigInt slippage-adjusted minimum out using basis points so that
  /// no precision is lost on large wei values (this is a tx-critical guard).
  BigInt _applySlippageDown(BigInt amount, double slippagePct) {
    final clamped = slippagePct.clamp(0.0, 50.0);
    final bps = BigInt.from((clamped * 100).round()); // 1% = 100 bps
    final tenK = BigInt.from(10000);
    if (bps <= BigInt.zero) return amount;
    if (bps >= tenK) return BigInt.zero;
    return amount * (tenK - bps) ~/ tenK;
  }

  // Encodes getAmountsOut(uint256, address[]).
  String _encodeGetAmountsOut(BigInt amountIn, List<String> path) {
    final selector = _selector('getAmountsOut(uint256,address[])');
    // Layout: amountIn(32) | offset(32, =0x40) | length(32) | addresses
    final amt = _padUint(amountIn);
    final offset = (64).toRadixString(16).padLeft(64, '0');
    final lenHex = path.length.toRadixString(16).padLeft(64, '0');
    final addrs = path.map((a) => _padAddr(a)).join();
    return '0x$selector$amt$offset$lenHex$addrs';
  }

  List<BigInt> _decodeUintArray(String hex) {
    if (hex.length <= 2) return [];
    final s = hex.replaceFirst('0x', '');
    // offset(32) + length(32) + items
    if (s.length < 128) return [];
    final lenHex = s.substring(64, 128);
    final len = int.parse(lenHex, radix: 16);
    final out = <BigInt>[];
    for (var i = 0; i < len; i++) {
      final chunk = s.substring(128 + i * 64, 128 + (i + 1) * 64);
      out.add(BigInt.parse(chunk, radix: 16));
    }
    return out;
  }

  /// Build a path on BSC. If both ERC20 — route via WBNB.
  List<String> _bscPath(SwapToken inT, SwapToken outT) {
    final a = inT.isNative ? wbnb : inT.contract!;
    final b = outT.isNative ? wbnb : outT.contract!;
    if (a.toLowerCase() == b.toLowerCase()) return [a];
    if (inT.isNative || outT.isNative) return [a, b];
    return [a, wbnb, b];
  }

  Future<SwapQuote> quoteBsc({
    required SwapToken tokenIn,
    required SwapToken tokenOut,
    required BigInt amountInWei,
    required double slippagePct,
  }) async {
    if (tokenIn.chain.id != 'bsc' || tokenOut.chain.id != 'bsc') {
      throw Exception('quoteBsc requires both tokens on BSC');
    }
    if (tokenIn.id == tokenOut.id) {
      throw Exception('Same token in/out');
    }
    final client = _rpc.get(Chains.bsc);
    final path = _bscPath(tokenIn, tokenOut);
    final data = _encodeGetAmountsOut(amountInWei, path);
    final res = await client.call('eth_call', [
      {'to': pancakeRouter, 'data': data},
      'latest',
    ]) as String;
    final amounts = _decodeUintArray(res);
    if (amounts.length < 2) {
      throw Exception('No liquidity / quote unavailable');
    }
    final out = amounts.last;
    final minOut = _applySlippageDown(out, slippagePct);
    return SwapQuote(
      amountInWei: amountInWei,
      amountOutWei: out,
      route: path,
      minOutWei: minOut,
      priceImpactPct: 0.0, // placeholder; real impact requires reserves read
      tokenIn: tokenIn,
      tokenOut: tokenOut,
    );
  }

  /// Returns true if approval needed (only for ERC20→anything; not native).
  Future<bool> bscNeedsApproval({
    required String owner,
    required SwapToken tokenIn,
    required BigInt amount,
  }) async {
    if (tokenIn.isNative) return false;
    final client = _rpc.get(Chains.bsc);
    try {
      final allow = await client.erc20Allowance(
        tokenIn.contract!,
        owner,
        pancakeRouter,
      );
      return allow < amount;
    } catch (_) {
      return true;
    }
  }

  Future<String> bscApprove({
    required EthPrivateKey credentials,
    required SwapToken tokenIn,
    required BigInt amount,
  }) async {
    if (tokenIn.isNative) {
      throw Exception('Native token does not need approval');
    }
    final client = _rpc.get(Chains.bsc);
    final selector = _selector('approve(address,uint256)');
    final spender = _padAddr(pancakeRouter);
    final amt = _padUint(amount);
    final data = '0x$selector$spender$amt';
    return client.sendRawCall(
      credentials: credentials,
      to: tokenIn.contract!,
      data: data,
    );
  }

  Future<String> bscSwap({
    required EthPrivateKey credentials,
    required String recipient,
    required SwapQuote quote,
  }) async {
    final client = _rpc.get(Chains.bsc);
    final path = quote.route;
    final deadline = BigInt.from(
      (DateTime.now().millisecondsSinceEpoch ~/ 1000) + 600,
    );
    String fnSig;
    BigInt? value;
    if (quote.tokenIn.isNative && !quote.tokenOut.isNative) {
      fnSig = 'swapExactETHForTokens(uint256,address[],address,uint256)';
      value = quote.amountInWei;
    } else if (!quote.tokenIn.isNative && quote.tokenOut.isNative) {
      fnSig = 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)';
    } else {
      fnSig = 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)';
    }
    final selector = _selector(fnSig);

    // Build calldata. The dynamic address[] sits at the end with offset.
    // Layouts:
    //  swapExactETHForTokens(amountOutMin, path, to, deadline)   => 4 head slots
    //  swapExactTokensForETH(amountIn, amountOutMin, path, to, deadline) => 5 head slots
    //  swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline) => 5 head slots
    final headSlots = quote.tokenIn.isNative ? 4 : 5;
    final pathOffset = BigInt.from(headSlots * 32);

    String head = '';
    if (quote.tokenIn.isNative) {
      head += _padUint(quote.minOutWei);
      head += pathOffset.toRadixString(16).padLeft(64, '0');
      head += _padAddr(recipient);
      head += _padUint(deadline);
    } else {
      head += _padUint(quote.amountInWei);
      head += _padUint(quote.minOutWei);
      head += pathOffset.toRadixString(16).padLeft(64, '0');
      head += _padAddr(recipient);
      head += _padUint(deadline);
    }
    final lenHex = path.length.toRadixString(16).padLeft(64, '0');
    final addrs = path.map((a) => _padAddr(a)).join();
    final data = '0x$selector$head$lenHex$addrs';

    return client.sendRawCall(
      credentials: credentials,
      to: pancakeRouter,
      data: data,
      value: value,
    );
  }

  /// Zebvix native ZBX ↔ ZUSD via existing native pool RPC (best-effort).
  /// Returns null if RPC reports no pool / not initialized.
  Future<SwapQuote?> quoteZebvix({
    required SwapToken tokenIn,
    required SwapToken tokenOut,
    required BigInt amountInWei,
    required double slippagePct,
  }) async {
    if (tokenIn.chain.id != 'zebvix' || tokenOut.chain.id != 'zebvix') {
      throw Exception('quoteZebvix requires both tokens on Zebvix');
    }
    final client = _rpc.get(Chains.zebvix);
    final dir = tokenIn.symbol.toUpperCase() == 'ZBX' ? 'zbx_to_zusd' : 'zusd_to_zbx';
    try {
      final res = await client.call('zbx_swapQuote', [
        '0x${amountInWei.toRadixString(16)}',
        dir,
      ]);
      if (res is! Map) return null;
      final outHex = (res['amount_out'] ?? res['amountOut'] ?? '0x0') as String;
      final out = BigInt.parse(outHex.replaceFirst('0x', ''), radix: 16);
      final minOut = _applySlippageDown(out, slippagePct);
      return SwapQuote(
        amountInWei: amountInWei,
        amountOutWei: out,
        route: [tokenIn.symbol, tokenOut.symbol],
        minOutWei: minOut,
        priceImpactPct: 0.0,
        tokenIn: tokenIn,
        tokenOut: tokenOut,
      );
    } catch (_) {
      return null;
    }
  }
}
