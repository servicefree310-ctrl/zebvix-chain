import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/rpc.dart';
import '../services/wallet_service.dart';
import '../services/pairing_service.dart';
import '../utils/format.dart';

class BalanceSnapshot {
  final double liquidZbx;
  final double stakedZbx;
  final double lockedZbx;
  final double zusd;
  final int nonce;
  final String? payIdName;
  final double priceUsd;

  BalanceSnapshot({
    required this.liquidZbx,
    required this.stakedZbx,
    required this.lockedZbx,
    required this.zusd,
    required this.nonce,
    required this.priceUsd,
    this.payIdName,
  });

  double get totalZbx => liquidZbx + stakedZbx + lockedZbx;
  double get totalUsd => totalZbx * priceUsd + zusd;

  static BalanceSnapshot empty() => BalanceSnapshot(
        liquidZbx: 0,
        stakedZbx: 0,
        lockedZbx: 0,
        zusd: 0,
        nonce: 0,
        priceUsd: 1.0,
      );
}

class AppState extends ChangeNotifier {
  static const _kRpc = 'cfg.rpc';
  static const _kRelay = 'cfg.relay';
  static const _kBio = 'cfg.bio';

  String rpcEndpoint = 'http://93.127.213.192:8545';
  String relayBase =
      'https://7f6c353a-ec2a-4fe7-81e1-631c9fb77a3e-00-1a0ca41r86kcx.worf.replit.dev/api';
  bool biometricEnabled = false;

  late ZbxRpc rpc;
  final wallet = WalletService();
  PairingService? pairing;

  /// All known wallets (multi-wallet support).
  List<ZebvixWallet> wallets = [];
  String? address; // active address
  bool bootstrapped = false;
  bool loading = false;

  BalanceSnapshot balance = BalanceSnapshot.empty();
  int blockHeight = 0;

  ZebvixWallet? get activeWallet {
    if (address == null) return null;
    for (final w in wallets) {
      if (w.address.toLowerCase() == address!.toLowerCase()) return w;
    }
    return null;
  }

  String? get mnemonic => activeWallet?.mnemonic;

  Future<void> init() async {
    final p = await SharedPreferences.getInstance();
    rpcEndpoint = p.getString(_kRpc) ?? rpcEndpoint;
    // auto-correct: an older build defaulted to https:// for the bare-IP RPC
    // which this server doesn't actually speak. Force HTTP for the dev VPS.
    if (rpcEndpoint == 'https://93.127.213.192:8545') {
      rpcEndpoint = 'http://93.127.213.192:8545';
      await p.setString(_kRpc, rpcEndpoint);
    }
    relayBase = p.getString(_kRelay) ?? relayBase;
    biometricEnabled = p.getBool(_kBio) ?? false;
    rpc = ZbxRpc(rpcEndpoint);
    pairing = PairingService(relayBase);

    wallets = await wallet.loadAll();
    final active = await wallet.activeAddress();
    if (wallets.isNotEmpty) {
      address = active ?? wallets.first.address;
    }
    bootstrapped = true;
    notifyListeners();
    if (address != null) refresh();
  }

  Future<void> setRpcEndpoint(String url) async {
    rpcEndpoint = url;
    rpc = ZbxRpc(url);
    final p = await SharedPreferences.getInstance();
    await p.setString(_kRpc, url);
    notifyListeners();
    refresh();
  }

  Future<void> setRelayBase(String url) async {
    relayBase = url;
    pairing?.disconnect();
    pairing = PairingService(url);
    final p = await SharedPreferences.getInstance();
    await p.setString(_kRelay, url);
    notifyListeners();
  }

  Future<void> setBiometric(bool v) async {
    biometricEnabled = v;
    final p = await SharedPreferences.getInstance();
    await p.setBool(_kBio, v);
    notifyListeners();
  }

  // ── Multi-wallet management ────────────────────────────────────────────
  String _autoName() {
    final n = wallets.length + 1;
    return 'Wallet $n';
  }

  Future<ZebvixWallet> createNewWallet({String? name}) async {
    final w = wallet.generate(name: name ?? _autoName());
    wallets = await wallet.addWallet(w);
    address = w.address;
    balance = BalanceSnapshot.empty();
    notifyListeners();
    refresh();
    return w;
  }

  Future<ZebvixWallet> importMnemonic(String m, {String? name}) async {
    if (!wallet.isValidMnemonic(m)) {
      throw Exception('invalid mnemonic phrase');
    }
    final w = wallet.fromMnemonic(m, name: name ?? _autoName());
    wallets = await wallet.addWallet(w);
    address = w.address;
    balance = BalanceSnapshot.empty();
    notifyListeners();
    refresh();
    return w;
  }

  Future<ZebvixWallet> importPrivateKey(String hex, {String? name}) async {
    final w =
        wallet.fromPrivateKeyHex(hex, name: name ?? _autoName());
    wallets = await wallet.addWallet(w);
    address = w.address;
    balance = BalanceSnapshot.empty();
    notifyListeners();
    refresh();
    return w;
  }

  Future<void> switchWallet(String addr) async {
    if (address?.toLowerCase() == addr.toLowerCase()) return;
    await wallet.setActive(addr);
    address = addr;
    balance = BalanceSnapshot.empty();
    notifyListeners();
    refresh();
  }

  Future<void> renameWallet(String addr, String newName) async {
    wallets = await wallet.renameWallet(addr, newName);
    notifyListeners();
  }

  Future<void> removeWallet(String addr) async {
    wallets = await wallet.removeWallet(addr);
    final newActive = await wallet.activeAddress();
    address = newActive;
    balance = BalanceSnapshot.empty();
    notifyListeners();
    if (address != null) refresh();
  }

  Future<void> signOut() async {
    await wallet.wipe();
    await pairing?.disconnect();
    wallets = [];
    address = null;
    balance = BalanceSnapshot.empty();
    notifyListeners();
  }

  Future<ZebvixWallet?> currentWallet() => wallet.load();

  // ── Balance refresh ────────────────────────────────────────────────────
  Future<void> refresh() async {
    if (address == null) return;
    loading = true;
    notifyListeners();
    try {
      final liquidF = rpc.getBalance(address!);
      final stakedF = rpc.getDelegations(address!);
      final lockedF = rpc.getLockedRewards(address!);
      final nonceF = rpc.getNonce(address!);
      final payF = rpc.getPayIdOf(address!);
      final zusdF = rpc.getZusdBalance(address!);
      final blockF = rpc.blockNumber();

      final liquid = await liquidF.catchError((_) => '0x0');
      final Map<String, dynamic>? stakedRes =
          await stakedF.catchError((_) => null);
      final Map<String, dynamic>? lockedRes =
          await lockedF.catchError((_) => null);
      final nonceHex = await nonceF.catchError((_) => '0x0');
      final Map<String, dynamic>? payRes = await payF.catchError((_) => null);
      final zusd = await zusdF.catchError((_) => '0x0');
      blockHeight = await blockF.catchError((_) => 0);

      double sumStake = 0;
      if (stakedRes != null) {
        final ds = (stakedRes['delegations'] as List?) ?? [];
        for (final d in ds) {
          final amt = (d as Map)['amount']?.toString() ?? '0x0';
          sumStake += weiHexToZbx(amt);
        }
      }
      double sumLocked = 0;
      if (lockedRes != null) {
        final entries = (lockedRes['entries'] as List?) ?? [];
        for (final e in entries) {
          final amt = (e as Map)['amount']?.toString() ?? '0x0';
          sumLocked += weiHexToZbx(amt);
        }
      }
      String? payName;
      if (payRes != null) payName = payRes['name']?.toString();

      balance = BalanceSnapshot(
        liquidZbx: weiHexToZbx(liquid),
        stakedZbx: sumStake,
        lockedZbx: sumLocked,
        zusd: weiHexToZbx(zusd),
        nonce: int.parse(nonceHex.replaceFirst('0x', ''), radix: 16),
        priceUsd: 1.0,
        payIdName: payName,
      );
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  // ── Tx helpers (sign with active wallet) ───────────────────────────────
  Future<String> sendTransfer({
    required String to,
    required double amountZbx,
    double feeZbx = 0.002,
  }) async {
    final w = activeWallet ?? await wallet.load();
    if (w == null) throw Exception('no wallet');
    final hexTx = wallet.signTransferRaw(
      from: w.address,
      to: to,
      amountWei: zbxToWei(amountZbx),
      nonce: balance.nonce,
      feeWei: zbxToWei(feeZbx),
      chainId: 7878,
      seed: w.privateKey,
    );
    final res = await rpc.sendRawHex(hexTx);
    refresh();
    return res?.toString() ?? '';
  }

  Future<String> swapZbxToZusd({required double amountZbx}) async {
    final w = activeWallet ?? await wallet.load();
    if (w == null) throw Exception('no wallet');
    final body = {
      'from': w.address,
      'to': w.address,
      'amount': '0x${zbxToWei(amountZbx).toRadixString(16)}',
      'fee': '0x${zbxToWei(0.002).toRadixString(16)}',
      'nonce': balance.nonce,
      'chain_id': 7878,
      'kind': {
        'Swap': {'side': 'zbx_to_zusd'}
      },
    };
    final signed = wallet.signTransaction(body, w.privateKey);
    final res = await rpc.sendRaw(signed);
    refresh();
    return res?.toString() ?? '';
  }

  Future<String> swapZusdToZbx({required double amountZusd}) async {
    final w = activeWallet ?? await wallet.load();
    if (w == null) throw Exception('no wallet');
    final body = {
      'from': w.address,
      'to': w.address,
      'amount': '0x${zbxToWei(amountZusd).toRadixString(16)}',
      'fee': '0x${zbxToWei(0.002).toRadixString(16)}',
      'nonce': balance.nonce,
      'chain_id': 7878,
      'kind': {
        'Swap': {'side': 'zusd_to_zbx'}
      },
    };
    final signed = wallet.signTransaction(body, w.privateKey);
    final res = await rpc.sendRaw(signed);
    refresh();
    return res?.toString() ?? '';
  }

  Future<String> createMultisig({
    required List<String> signers,
    required int threshold,
  }) async {
    final w = activeWallet ?? await wallet.load();
    if (w == null) throw Exception('no wallet');
    final body = {
      'from': w.address,
      'to': '0x0000000000000000000000000000000000000000',
      'amount': '0x0',
      'fee': '0x${zbxToWei(0.002).toRadixString(16)}',
      'nonce': balance.nonce,
      'chain_id': 7878,
      'kind': {
        'Multisig': {
          'Create': {
            'signers': signers.map((s) => s.toLowerCase()).toList(),
            'threshold': threshold,
          }
        }
      },
    };
    final signed = wallet.signTransaction(body, w.privateKey);
    final res = await rpc.sendRaw(signed);
    refresh();
    return res?.toString() ?? '';
  }

  Future<String> approveMultisig({
    required String multisig,
    required int proposalId,
  }) async {
    final w = activeWallet ?? await wallet.load();
    if (w == null) throw Exception('no wallet');
    final body = {
      'from': w.address,
      'to': multisig.toLowerCase(),
      'amount': '0x0',
      'fee': '0x${zbxToWei(0.002).toRadixString(16)}',
      'nonce': balance.nonce,
      'chain_id': 7878,
      'kind': {
        'Multisig': {
          'Approve': {'proposal_id': proposalId}
        }
      },
    };
    final signed = wallet.signTransaction(body, w.privateKey);
    final res = await rpc.sendRaw(signed);
    refresh();
    return res?.toString() ?? '';
  }
}
