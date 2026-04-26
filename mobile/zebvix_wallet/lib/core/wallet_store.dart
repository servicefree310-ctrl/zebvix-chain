import 'dart:convert';
import 'package:bip32/bip32.dart' as bip32;
import 'package:bip39/bip39.dart' as bip39;
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:hex/hex.dart';
import 'package:web3dart/credentials.dart';

class Account {
  final String name;
  final String address;
  final int index;

  Account({required this.name, required this.address, required this.index});

  Map<String, dynamic> toJson() =>
      {'name': name, 'address': address, 'index': index};

  factory Account.fromJson(Map<String, dynamic> j) => Account(
        name: j['name'] as String,
        address: j['address'] as String,
        index: j['index'] as int,
      );
}

class WalletStore extends ChangeNotifier {
  static const _kMnemonic = 'zbx_mnemonic_v1';
  static const _kAccounts = 'zbx_accounts_v1';
  static const _kActive = 'zbx_active_v1';

  final FlutterSecureStorage _storage;
  String? _mnemonic;
  List<Account> _accounts = [];
  int _activeIdx = 0;
  bool _initialized = false;

  WalletStore({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  bool get initialized => _initialized;
  bool get hasWallet => _mnemonic != null && _accounts.isNotEmpty;
  List<Account> get accounts => List.unmodifiable(_accounts);
  Account? get active => _accounts.isEmpty
      ? null
      : _accounts[_activeIdx.clamp(0, _accounts.length - 1)];
  String? get mnemonic => _mnemonic;

  Future<void> load() async {
    try {
      _mnemonic = await _storage.read(key: _kMnemonic);
      final raw = await _storage.read(key: _kAccounts);
      if (raw != null) {
        final list = jsonDecode(raw) as List<dynamic>;
        _accounts = list
            .map((e) => Account.fromJson(e as Map<String, dynamic>))
            .toList();
      }
      final activeRaw = await _storage.read(key: _kActive);
      _activeIdx = int.tryParse(activeRaw ?? '0') ?? 0;
    } catch (_) {
      _mnemonic = null;
      _accounts = [];
      _activeIdx = 0;
    }
    _initialized = true;
    notifyListeners();
  }

  String generateMnemonic() => bip39.generateMnemonic(strength: 128);

  bool isValidMnemonic(String m) => bip39.validateMnemonic(m.trim());

  Future<void> createWallet(String mnemonic,
      {String name = 'Account 1'}) async {
    final m = mnemonic.trim();
    if (!bip39.validateMnemonic(m)) {
      throw Exception('Invalid mnemonic phrase');
    }
    _mnemonic = m;
    _accounts = [_deriveAccount(0, name)];
    _activeIdx = 0;
    await _persist();
    notifyListeners();
  }

  Future<Account> addAccount(String name) async {
    if (_mnemonic == null) throw Exception('No wallet');
    final idx = _accounts.length;
    final acc = _deriveAccount(idx, name);
    _accounts.add(acc);
    await _persist();
    notifyListeners();
    return acc;
  }

  Future<void> setActive(int idx) async {
    if (idx < 0 || idx >= _accounts.length) return;
    _activeIdx = idx;
    await _storage.write(key: _kActive, value: idx.toString());
    notifyListeners();
  }

  Future<void> wipe() async {
    await _storage.delete(key: _kMnemonic);
    await _storage.delete(key: _kAccounts);
    await _storage.delete(key: _kActive);
    _mnemonic = null;
    _accounts = [];
    _activeIdx = 0;
    notifyListeners();
  }

  Account _deriveAccount(int index, String name) {
    final cred = credentialsFor(index);
    return Account(name: name, address: cred.address.hexEip55, index: index);
  }

  EthPrivateKey credentialsFor(int index) {
    if (_mnemonic == null) throw Exception('No mnemonic');
    final seed = bip39.mnemonicToSeed(_mnemonic!);
    final root = bip32.BIP32.fromSeed(seed);
    final child = root.derivePath("m/44'/60'/0'/0/$index");
    final pk = child.privateKey;
    if (pk == null) throw Exception('No private key');
    return EthPrivateKey.fromHex(HEX.encode(Uint8List.fromList(pk)));
  }

  EthPrivateKey activeCredentials() {
    final a = active;
    if (a == null) throw Exception('No active account');
    return credentialsFor(a.index);
  }

  Future<void> _persist() async {
    if (_mnemonic != null) {
      await _storage.write(key: _kMnemonic, value: _mnemonic);
    }
    await _storage.write(
      key: _kAccounts,
      value: jsonEncode(_accounts.map((a) => a.toJson()).toList()),
    );
    await _storage.write(key: _kActive, value: _activeIdx.toString());
  }
}
