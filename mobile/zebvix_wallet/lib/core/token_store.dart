import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class CustomToken {
  final String chainId; // 'zebvix', 'bsc', 'ethereum', 'polygon', 'arbitrum'
  final String symbol;
  final String contract;
  final int decimals;
  final String? name;

  const CustomToken({
    required this.chainId,
    required this.symbol,
    required this.contract,
    required this.decimals,
    this.name,
  });

  Map<String, dynamic> toJson() => {
        'chainId': chainId,
        'symbol': symbol,
        'contract': contract,
        'decimals': decimals,
        'name': name,
      };

  factory CustomToken.fromJson(Map<String, dynamic> j) => CustomToken(
        chainId: j['chainId'] as String,
        symbol: j['symbol'] as String,
        contract: j['contract'] as String,
        decimals: j['decimals'] as int,
        name: j['name'] as String?,
      );

  String get key => '${chainId.toLowerCase()}:${contract.toLowerCase()}';
}

/// Persists user-added ERC20-like tokens. Zebvix enforces unique-symbol; for
/// other chains we dedupe by (chain, contract).
class TokenStore extends ChangeNotifier {
  static const _kKey = 'zbx_custom_tokens_v1';

  final List<CustomToken> _tokens = [];
  bool _loaded = false;
  bool get loaded => _loaded;

  List<CustomToken> get all => List.unmodifiable(_tokens);

  List<CustomToken> forChain(String chainId) =>
      _tokens.where((t) => t.chainId.toLowerCase() == chainId.toLowerCase()).toList();

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_kKey);
    _tokens.clear();
    if (raw != null && raw.isNotEmpty) {
      try {
        final list = jsonDecode(raw) as List<dynamic>;
        for (final j in list) {
          _tokens.add(CustomToken.fromJson(j as Map<String, dynamic>));
        }
      } catch (_) {}
    }
    _loaded = true;
    notifyListeners();
  }

  Future<void> _persist() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _kKey,
      jsonEncode(_tokens.map((t) => t.toJson()).toList()),
    );
  }

  /// Returns null on success, or an error string on rejection.
  Future<String?> add(CustomToken token) async {
    if (token.chainId.toLowerCase() == 'zebvix') {
      // Unique-symbol policy on Zebvix.
      final dupSym = _tokens.any((t) =>
          t.chainId.toLowerCase() == 'zebvix' &&
          t.symbol.toUpperCase() == token.symbol.toUpperCase() &&
          t.contract.toLowerCase() != token.contract.toLowerCase());
      if (dupSym) {
        return "Symbol '${token.symbol.toUpperCase()}' already added on Zebvix.";
      }
    }
    final exists = _tokens.indexWhere((t) => t.key == token.key);
    if (exists >= 0) {
      _tokens[exists] = token;
    } else {
      _tokens.add(token);
    }
    await _persist();
    notifyListeners();
    return null;
  }

  Future<void> remove(CustomToken token) async {
    _tokens.removeWhere((t) => t.key == token.key);
    await _persist();
    notifyListeners();
  }
}
