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

class ZebvixWallet {
  final String mnemonic;
  final Uint8List privateKey;
  final Uint8List publicKey;
  final String address;

  ZebvixWallet({
    required this.mnemonic,
    required this.privateKey,
    required this.publicKey,
    required this.address,
  });
}

class WalletService {
  static const _kMnemonic = 'zbx.mnemonic';
  static const _kPrivKey = 'zbx.privkey';
  static const _kAddress = 'zbx.address';

  final _secure = const FlutterSecureStorage();
  static final _curve = ECCurve_secp256k1();

  // ── Generation ──────────────────────────────────────────────────────────
  String generateMnemonic({int strength = 128}) =>
      bip39.generateMnemonic(strength: strength);

  bool isValidMnemonic(String m) => bip39.validateMnemonic(m.trim());

  ZebvixWallet fromMnemonic(String mnemonic) {
    final seed = bip39.mnemonicToSeed(mnemonic.trim());
    // simple deterministic priv key: HMAC-SHA512("zbx-seed", seed) → first 32 bytes
    final h = HMac(SHA256Digest(), 64)..init(KeyParameter(_utf8('zbx-seed')));
    final priv = Uint8List(32);
    h.update(seed, 0, seed.length);
    h.doFinal(priv, 0);

    final pub = _derivePublic(priv);
    final addr = _addressFromPublic(pub);
    return ZebvixWallet(
      mnemonic: mnemonic,
      privateKey: priv,
      publicKey: pub,
      address: addr,
    );
  }

  ZebvixWallet generate() => fromMnemonic(generateMnemonic());

  // ── Persistence ─────────────────────────────────────────────────────────
  Future<void> save(ZebvixWallet w) async {
    await _secure.write(key: _kMnemonic, value: w.mnemonic);
    await _secure.write(key: _kPrivKey, value: hex.encode(w.privateKey));
    await _secure.write(key: _kAddress, value: w.address);
  }

  Future<ZebvixWallet?> load() async {
    final addr = await _secure.read(key: _kAddress);
    final pkHex = await _secure.read(key: _kPrivKey);
    final mn = await _secure.read(key: _kMnemonic);
    if (addr == null || pkHex == null) return null;
    final priv = Uint8List.fromList(hex.decode(pkHex));
    final pub = _derivePublic(priv);
    return ZebvixWallet(
      mnemonic: mn ?? '',
      privateKey: priv,
      publicKey: pub,
      address: addr,
    );
  }

  Future<void> wipe() async {
    await _secure.delete(key: _kMnemonic);
    await _secure.delete(key: _kPrivKey);
    await _secure.delete(key: _kAddress);
  }

  // ── Signing ─────────────────────────────────────────────────────────────
  /// Signs `data` (raw bytes) with secp256k1 ECDSA over keccak256.
  /// Returns 65-byte signature: r(32) || s(32) || v(1).
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
    return {
      'body': body,
      'signature': sig,
    };
  }

  // ── Crypto helpers ──────────────────────────────────────────────────────
  static Uint8List _derivePublic(Uint8List priv) {
    final d = _bigIntFromBytes(priv);
    final q = _curve.G * d;
    return Uint8List.fromList(q!.getEncoded(false)); // 0x04 || X(32) || Y(32)
  }

  static String _addressFromPublic(Uint8List pub) {
    // strip leading 0x04 prefix
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

  /// Canonical JSON: sorted keys, no spaces.
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

  /// SHA-256 helper for misc uses.
  String sha256Hex(String s) =>
      sha256.convert(utf8.encode(s)).toString();

  /// Secure RNG hex (used for nonces / IDs).
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
