import 'dart:convert';
import 'dart:typed_data';
import 'package:bip39/bip39.dart' as bip39;
import 'package:convert/convert.dart' show hex;
import 'package:crypto/crypto.dart' show sha256;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:pointycastle/api.dart';
import 'package:pointycastle/digests/keccak.dart';
import 'package:pointycastle/ecc/api.dart';
import 'package:pointycastle/ecc/curves/secp256k1.dart';
import 'package:pointycastle/random/fortuna_random.dart';
import 'package:pointycastle/signers/ecdsa_signer.dart';
import 'package:pointycastle/macs/hmac.dart';
import 'package:pointycastle/digests/sha256.dart';

/// In-memory representation (with secrets) of a single wallet.
class ZebvixWallet {
  final String name;
  final String mnemonic; // empty if imported via private key
  final Uint8List privateKey;
  final Uint8List publicKey;
  final String address;
  final String source; // 'mnemonic' | 'privkey'

  ZebvixWallet({
    required this.name,
    required this.mnemonic,
    required this.privateKey,
    required this.publicKey,
    required this.address,
    required this.source,
  });

  String get privateKeyHex => hex.encode(privateKey);

  Map<String, dynamic> toJson() => {
        'name': name,
        'address': address,
        'mnemonic': mnemonic,
        'privKey': hex.encode(privateKey),
        'source': source,
      };

  static ZebvixWallet fromJson(Map<String, dynamic> j) {
    final priv = Uint8List.fromList(hex.decode(j['privKey'] as String));
    final pub = WalletService._derivePublic(priv);
    return ZebvixWallet(
      name: (j['name'] as String?) ?? 'Wallet',
      mnemonic: (j['mnemonic'] as String?) ?? '',
      privateKey: priv,
      publicKey: pub,
      address: j['address'] as String,
      source: (j['source'] as String?) ?? 'mnemonic',
    );
  }
}

class WalletService {
  // v2 multi-wallet keys
  static const _kWallets = 'zbx.wallets.v2';
  static const _kActive = 'zbx.active';

  // legacy v1 single-wallet keys (for migration)
  static const _kLegacyMnemonic = 'zbx.mnemonic';
  static const _kLegacyPrivKey = 'zbx.privkey';
  static const _kLegacyAddress = 'zbx.address';

  final _secure = const FlutterSecureStorage();
  static final _curve = ECCurve_secp256k1();

  // ── Generation ──────────────────────────────────────────────────────────
  String generateMnemonic({int strength = 128}) =>
      bip39.generateMnemonic(strength: strength);

  bool isValidMnemonic(String m) => bip39.validateMnemonic(m.trim());

  ZebvixWallet fromMnemonic(String mnemonic, {String name = 'Wallet'}) {
    final seed = bip39.mnemonicToSeed(mnemonic.trim());
    final h = HMac(SHA256Digest(), 64)..init(KeyParameter(_utf8('zbx-seed')));
    final priv = Uint8List(32);
    h.update(seed, 0, seed.length);
    h.doFinal(priv, 0);

    final pub = _derivePublic(priv);
    final addr = _addressFromPublic(pub);
    return ZebvixWallet(
      name: name,
      mnemonic: mnemonic.trim(),
      privateKey: priv,
      publicKey: pub,
      address: addr,
      source: 'mnemonic',
    );
  }

  ZebvixWallet fromPrivateKeyHex(String pkHex, {String name = 'Wallet'}) {
    var clean = pkHex.trim();
    if (clean.startsWith('0x') || clean.startsWith('0X')) {
      clean = clean.substring(2);
    }
    if (clean.length != 64) {
      throw Exception('private key must be 32 bytes (64 hex chars)');
    }
    if (!RegExp(r'^[0-9a-fA-F]+$').hasMatch(clean)) {
      throw Exception('private key must be valid hex');
    }
    final priv = Uint8List.fromList(hex.decode(clean));
    // sanity range check 1 <= d < n
    final d = _bigIntFromBytes(priv);
    if (d <= BigInt.zero || d >= _curve.n) {
      throw Exception('private key out of curve range');
    }
    final pub = _derivePublic(priv);
    final addr = _addressFromPublic(pub);
    return ZebvixWallet(
      name: name,
      mnemonic: '',
      privateKey: priv,
      publicKey: pub,
      address: addr,
      source: 'privkey',
    );
  }

  ZebvixWallet generate({String name = 'Wallet'}) =>
      fromMnemonic(generateMnemonic(), name: name);

  // ── Persistence (multi-wallet) ──────────────────────────────────────────
  Future<List<ZebvixWallet>> loadAll() async {
    // migrate legacy if needed
    await _migrateLegacy();
    final raw = await _secure.read(key: _kWallets);
    if (raw == null || raw.isEmpty) return [];
    final List arr = jsonDecode(raw) as List;
    return arr
        .map((e) => ZebvixWallet.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<String?> activeAddress() async => _secure.read(key: _kActive);

  Future<void> setActive(String address) async {
    await _secure.write(key: _kActive, value: address.toLowerCase());
  }

  Future<void> _persist(List<ZebvixWallet> ws) async {
    final arr = ws.map((w) => w.toJson()).toList();
    await _secure.write(key: _kWallets, value: jsonEncode(arr));
  }

  /// Add a wallet and make it active. Throws if address already exists.
  Future<List<ZebvixWallet>> addWallet(ZebvixWallet w) async {
    final all = await loadAll();
    if (all.any((x) => x.address.toLowerCase() == w.address.toLowerCase())) {
      throw Exception('wallet with this address already exists');
    }
    all.add(w);
    await _persist(all);
    await setActive(w.address);
    return all;
  }

  Future<List<ZebvixWallet>> renameWallet(String address, String name) async {
    final all = await loadAll();
    final idx = all.indexWhere(
        (w) => w.address.toLowerCase() == address.toLowerCase());
    if (idx < 0) throw Exception('wallet not found');
    final old = all[idx];
    all[idx] = ZebvixWallet(
      name: name,
      mnemonic: old.mnemonic,
      privateKey: old.privateKey,
      publicKey: old.publicKey,
      address: old.address,
      source: old.source,
    );
    await _persist(all);
    return all;
  }

  Future<List<ZebvixWallet>> removeWallet(String address) async {
    final all = await loadAll();
    all.removeWhere(
        (w) => w.address.toLowerCase() == address.toLowerCase());
    await _persist(all);
    final cur = await activeAddress();
    if (cur != null && cur.toLowerCase() == address.toLowerCase()) {
      if (all.isNotEmpty) {
        await setActive(all.first.address);
      } else {
        await _secure.delete(key: _kActive);
      }
    }
    return all;
  }

  /// Returns the currently active wallet, if any.
  Future<ZebvixWallet?> load() async {
    final all = await loadAll();
    if (all.isEmpty) return null;
    final active = await activeAddress();
    if (active == null) return all.first;
    return all.firstWhere(
      (w) => w.address.toLowerCase() == active.toLowerCase(),
      orElse: () => all.first,
    );
  }

  /// Backwards-compatible save: replaces the single legacy slot. New code
  /// should use [addWallet] instead.
  Future<void> save(ZebvixWallet w) async {
    try {
      await addWallet(w);
    } catch (_) {
      // already exists — just make it active
      await setActive(w.address);
    }
  }

  Future<void> wipe() async {
    await _secure.delete(key: _kWallets);
    await _secure.delete(key: _kActive);
    await _secure.delete(key: _kLegacyMnemonic);
    await _secure.delete(key: _kLegacyPrivKey);
    await _secure.delete(key: _kLegacyAddress);
  }

  Future<void> _migrateLegacy() async {
    final raw = await _secure.read(key: _kWallets);
    if (raw != null && raw.isNotEmpty) return; // already on v2
    final addr = await _secure.read(key: _kLegacyAddress);
    final pkHex = await _secure.read(key: _kLegacyPrivKey);
    if (addr == null || pkHex == null) return;
    final mn = await _secure.read(key: _kLegacyMnemonic);
    final priv = Uint8List.fromList(hex.decode(pkHex));
    final pub = _derivePublic(priv);
    final w = ZebvixWallet(
      name: 'Wallet 1',
      mnemonic: mn ?? '',
      privateKey: priv,
      publicKey: pub,
      address: addr,
      source: (mn != null && mn.isNotEmpty) ? 'mnemonic' : 'privkey',
    );
    await _persist([w]);
    await setActive(addr);
    await _secure.delete(key: _kLegacyMnemonic);
    await _secure.delete(key: _kLegacyPrivKey);
    await _secure.delete(key: _kLegacyAddress);
  }

  // ── Signing ─────────────────────────────────────────────────────────────
  Map<String, String> sign(Uint8List data, Uint8List privateKey) {
    final hash = _keccak256(data);
    final pk = ECPrivateKey(_bigIntFromBytes(privateKey), _curve);

    final signer = ECDSASigner(null, HMac(SHA256Digest(), 64))
      ..init(true, PrivateKeyParameter<ECPrivateKey>(pk));
    final sig = signer.generateSignature(hash) as ECSignature;

    var s = sig.s;
    final n = _curve.n;
    final halfN = n >> 1;
    if (s.compareTo(halfN) > 0) s = n - s;

    return {
      'r': '0x${_bnToHex(sig.r, 32)}',
      's': '0x${_bnToHex(s, 32)}',
      'hash': '0x${hex.encode(hash)}',
    };
  }

  Map<String, dynamic> signTransaction(
    Map<String, dynamic> body,
    Uint8List privateKey,
  ) {
    final canonical = utf8.encode(_canonicalJson(body));
    final sig = sign(Uint8List.fromList(canonical), privateKey);
    return {'body': body, 'signature': sig};
  }

  // ── Crypto helpers ──────────────────────────────────────────────────────
  static Uint8List _derivePublic(Uint8List priv) {
    final d = _bigIntFromBytes(priv);
    final q = _curve.G * d;
    return Uint8List.fromList(q!.getEncoded(false));
  }

  static String _addressFromPublic(Uint8List pub) {
    final body = pub.length == 65 ? pub.sublist(1) : pub;
    final h = _keccak256(body);
    final last20 = h.sublist(h.length - 20);
    return '0x${hex.encode(last20)}';
  }

  static Uint8List _keccak256(Uint8List input) {
    final k = KeccakDigest(256);
    final out = Uint8List(32);
    k.update(input, 0, input.length);
    k.doFinal(out, 0);
    return out;
  }

  static BigInt _bigIntFromBytes(Uint8List b) =>
      BigInt.parse(hex.encode(b), radix: 16);

  static String _bnToHex(BigInt n, int padBytes) {
    var s = n.toRadixString(16);
    while (s.length < padBytes * 2) {
      s = '0$s';
    }
    return s;
  }

  static Uint8List _utf8(String s) => Uint8List.fromList(utf8.encode(s));

  static String _canonicalJson(dynamic v) {
    if (v is Map) {
      final keys = v.keys.map((k) => k.toString()).toList()..sort();
      final entries =
          keys.map((k) => '${jsonEncode(k)}:${_canonicalJson(v[k])}').join(',');
      return '{$entries}';
    }
    if (v is List) {
      return '[${v.map(_canonicalJson).join(',')}]';
    }
    return jsonEncode(v);
  }

  String sha256Hex(String s) => sha256.convert(utf8.encode(s)).toString();

  String secureHex(int bytes) {
    final rng = FortunaRandom();
    final seed = Uint8List(32);
    final base = DateTime.now().microsecondsSinceEpoch;
    for (var i = 0; i < 32; i++) {
      seed[i] = (base >> (i % 8)) & 0xff;
    }
    rng.seed(KeyParameter(seed));
    final out = rng.nextBytes(bytes);
    return hex.encode(out);
  }
}
