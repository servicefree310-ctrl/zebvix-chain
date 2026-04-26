import 'package:flutter/foundation.dart';
import 'chains.dart';
import 'rpc_client.dart';
import 'token_store.dart';
import 'wallet_store.dart';

class TokenBalance {
  final ChainConfig chain;
  final String symbol;
  final BigInt amountWei;
  final int decimals;
  final bool isNative;
  final String? tokenAddress;
  final DateTime fetchedAt;

  TokenBalance({
    required this.chain,
    required this.symbol,
    required this.amountWei,
    required this.decimals,
    required this.isNative,
    this.tokenAddress,
    required this.fetchedAt,
  });

  double get amount {
    if (amountWei == BigInt.zero) return 0.0;
    final divisor = BigInt.from(10).pow(decimals);
    final whole = amountWei ~/ divisor;
    final frac = amountWei - (whole * divisor);
    return whole.toDouble() + (frac.toDouble() / divisor.toDouble());
  }

  String formatted([int dp = 4]) {
    final v = amount;
    if (v == 0) return '0';
    if (v < 0.0001) return '<0.0001';
    return v.toStringAsFixed(dp).replaceAll(RegExp(r'0+$'), '').replaceAll(RegExp(r'\.$'), '');
  }
}

class BalanceService extends ChangeNotifier {
  final RpcRegistry _rpc;
  final WalletStore _wallet;
  final TokenStore _tokens;
  final Map<String, List<TokenBalance>> _byChain = {};
  bool _loading = false;
  DateTime? _lastFetch;

  BalanceService(this._rpc, this._wallet, this._tokens) {
    _wallet.addListener(_onWalletChange);
    _tokens.addListener(_onTokensChange);
  }

  void _onTokensChange() {
    // Refresh on token list mutation if we already have a wallet loaded.
    if (_wallet.active != null) refreshAll();
  }

  bool get loading => _loading;
  DateTime? get lastFetch => _lastFetch;

  List<TokenBalance> forChain(String chainId) => _byChain[chainId] ?? [];

  List<TokenBalance> all() {
    final out = <TokenBalance>[];
    for (final list in _byChain.values) {
      out.addAll(list);
    }
    return out;
  }

  void _onWalletChange() {
    _byChain.clear();
    _lastFetch = null;
    notifyListeners();
  }

  Future<void> refreshAll() async {
    final addr = _wallet.active?.address;
    if (addr == null) return;
    _loading = true;
    notifyListeners();
    try {
      await Future.wait(Chains.all.map((c) => _refreshChain(c, addr)));
      _lastFetch = DateTime.now();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> _refreshChain(ChainConfig chain, String addr) async {
    final client = _rpc.get(chain);
    final list = <TokenBalance>[];
    try {
      final native = await client.nativeBalance(addr);
      list.add(TokenBalance(
        chain: chain,
        symbol: chain.nativeSymbol,
        amountWei: native,
        decimals: chain.nativeDecimals,
        isNative: true,
        fetchedAt: DateTime.now(),
      ));
      // wZBX on BSC
      if (chain.id == 'bsc' && chain.wrappedToken != null) {
        try {
          final w = await client.erc20Balance(chain.wrappedToken!, addr);
          list.add(TokenBalance(
            chain: chain,
            symbol: 'wZBX',
            amountWei: w,
            decimals: 18,
            isNative: false,
            tokenAddress: chain.wrappedToken,
            fetchedAt: DateTime.now(),
          ));
        } catch (_) {}
      }
      // User-added custom tokens for this chain.
      for (final ct in _tokens.forChain(chain.id)) {
        try {
          final bal = await client.erc20Balance(ct.contract, addr);
          list.add(TokenBalance(
            chain: chain,
            symbol: ct.symbol,
            amountWei: bal,
            decimals: ct.decimals,
            isNative: false,
            tokenAddress: ct.contract,
            fetchedAt: DateTime.now(),
          ));
        } catch (_) {}
      }
    } catch (_) {
      // RPC unreachable; show zero placeholders
      list.add(TokenBalance(
        chain: chain,
        symbol: chain.nativeSymbol,
        amountWei: BigInt.zero,
        decimals: chain.nativeDecimals,
        isNative: true,
        fetchedAt: DateTime.now(),
      ));
    }
    _byChain[chain.id] = list;
  }

  @override
  void dispose() {
    _wallet.removeListener(_onWalletChange);
    _tokens.removeListener(_onTokensChange);
    super.dispose();
  }
}
