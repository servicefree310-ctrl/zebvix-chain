import 'dart:convert';
import 'dart:typed_data';
import 'package:bip39/bip39.dart' as bip39;
import 'package:convert/convert.dart' show hex;
import 'package:crypto/crypto.dart' show sha256;
import 'package:ed25519_edwards/ed25519_edwards.dart' as ed;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:pointycastle/api.dart';
import 'package:pointycastle/digests/keccak.dart';
import 'package:pointycastle/random/fortuna_random.dart';

/// Single wallet record (kept entirely in memory once unlocked).
///
/// Crypto: Ed25519 (matches the Zebvix chain `crypto.rs`):
///   secret  = 32-byte seed
///   pubkey  = ed25519_pub(seed)        (32 bytes)
///   address = keccak256(pubkey)[12..]  (last 20 bytes, EVM-style)
class ZebvixWallet {
  final String name;
  final String mnemonic;          // empty if imported via private key
  final Uint8List privateKey;     // 32-byte ed25519 seed
  final Uint8List publicKey;      // 32-byte ed25519 verifying key
  final String address;           // 0x-prefixed 20-byte hex
  final String source;            // 'mnemonic' | 'privkey'

  ZebvixWallet({
    required this.name,
    required this.mnemonic,
    required this.privateKey,
    required this.publicKey,
    required this.address,
    required this.source,
  });

  String get privateKeyHex => hex.encode(privateKey);
  String get publicKeyHex => hex.encode(publicKey);

  Map<String, dynamic> toJson() => {
        'name': name,
        'address': address,
        'mnemonic': mnemonic,
        'privKey': hex.encode(privateKey),
        'source': source,
      };

  static ZebvixWallet fromJson(Map<String, dynamic> j) {
    final priv = Uint8List.fromList(hex.decode(j['privKey'] as String));
    final pub = WalletService.derivePublic(priv);
    // Always re-derive address from the current crypto so wallets persisted
    // by older builds (which used secp256k1) get auto-corrected on load.
    final addr = WalletService.addressFromPublic(pub);
    return ZebvixWallet(
      name: (j['name'] as String?) ?? 'Wallet',
      mnemonic: (j['mnemonic'] as String?) ?? '',
      privateKey: priv,
      publicKey: pub,
      address: addr,
      source: (j['source'] as String?) ?? 'mnemonic',
    );
  }
}

class WalletService {
  // v2 multi-wallet keys
  static const _kWallets = 'zbx.wallets.v2';
  static const _kActive = 'zbx.active';

  // legacy v1 single-wallet keys
  static const _kLegacyMnemonic = 'zbx.mnemonic';
  static const _kLegacyPrivKey = 'zbx.privkey';
  static const _kLegacyAddress = 'zbx.address';

  final _secure = const FlutterSecureStorage();

  // ── Generation ──────────────────────────────────────────────────────────
  String generateMnemonic({int strength = 128}) =>
      bip39.generateMnemonic(strength: strength);

  bool isValidMnemonic(String m) => bip39.validateMnemonic(m.trim());

  /// Derive a deterministic 32-byte ed25519 seed from a BIP-39 mnemonic.
  /// We use SHA-256("zbx-seed" || bip39_seed) → 32 bytes.
  ZebvixWallet fromMnemonic(String mnemonic, {String name = 'Wallet'}) {
    final seed = bip39.mnemonicToSeed(mnemonic.trim());
    final mixed = <int>[]
      ..addAll(utf8.encode('zbx-seed'))
      ..addAll(seed);
    final priv = Uint8List.fromList(sha256.convert(mixed).bytes);
    final pub = derivePublic(priv);
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
    final pub = derivePublic(priv);
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

  Future<List<ZebvixWallet>> renameWallet(
      String address, String name) async {
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

  Future<void> save(ZebvixWallet w) async {
    try {
      await addWallet(w);
    } catch (_) {
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
    if (raw != null && raw.isNotEmpty) return;
    final addr = await _secure.read(key: _kLegacyAddress);
    final pkHex = await _secure.read(key: _kLegacyPrivKey);
    if (addr == null || pkHex == null) return;
    final mn = await _secure.read(key: _kLegacyMnemonic);
    final priv = Uint8List.fromList(hex.decode(pkHex));
    final pub = derivePublic(priv);
    final newAddr = _addressFromPublic(pub);
    final w = ZebvixWallet(
      name: 'Wallet 1',
      mnemonic: mn ?? '',
      privateKey: priv,
      publicKey: pub,
      // re-derive address (legacy used wrong curve)
      address: newAddr,
      source: (mn != null && mn.isNotEmpty) ? 'mnemonic' : 'privkey',
    );
    await _persist([w]);
    await setActive(newAddr);
    await _secure.delete(key: _kLegacyMnemonic);
    await _secure.delete(key: _kLegacyPrivKey);
    await _secure.delete(key: _kLegacyAddress);
  }

  // ── Signing (Ed25519) ───────────────────────────────────────────────────
  /// Raw Ed25519 sign. Returns 64-byte signature.
  Uint8List signRaw(Uint8List data, Uint8List seed) {
    final priv = ed.newKeyFromSeed(seed);
    return Uint8List.fromList(ed.sign(priv, data));
  }

  /// JSON-friendly transaction signature wrapper.
  /// NOTE: the Zebvix node uses bincode for the canonical signing payload.
  /// Until we add a full bincode encoder for [TxBody], this method signs the
  /// canonical-JSON form so it's at least structurally usable for relays /
  /// debugging. Broadcast endpoints that accept a raw-bytes payload should
  /// use [signRaw] directly with the exact bincode bytes.
  Map<String, dynamic> signTransaction(
    Map<String, dynamic> body,
    Uint8List seed,
  ) {
    final pub = derivePublic(seed);
    final canonical = utf8.encode(_canonicalJson(body));
    final sig = signRaw(Uint8List.fromList(canonical), seed);
    return {
      'body': body,
      'pubkey': '0x${hex.encode(pub)}',
      'signature': '0x${hex.encode(sig)}',
    };
  }

  // ── Bincode encoding (matches `bincode = "1.3"` default config on chain) ──
  // Default config = little-endian, fixint, enum tag = u32 LE.

  static Uint8List _addrBytes(String hex0x) {
    final s = hex0x.startsWith('0x') ? hex0x.substring(2) : hex0x;
    final b = hex.decode(s);
    if (b.length != 20) throw Exception('address must be 20 bytes');
    return Uint8List.fromList(b);
  }

  static Uint8List _u64Le(int v) {
    final b = ByteData(8)..setUint64(0, v, Endian.little);
    return b.buffer.asUint8List();
  }

  static Uint8List _u32Le(int v) {
    final b = ByteData(4)..setUint32(0, v, Endian.little);
    return b.buffer.asUint8List();
  }

  /// 16-byte little-endian encoding of an unsigned 128-bit BigInt.
  static Uint8List _u128Le(BigInt v) {
    if (v.isNegative) throw Exception('u128 cannot be negative');
    final out = Uint8List(16);
    var x = v;
    final mask = BigInt.from(0xff);
    for (var i = 0; i < 16; i++) {
      out[i] = (x & mask).toInt();
      x = x >> 8;
    }
    if (x != BigInt.zero) throw Exception('u128 overflow');
    return out;
  }

  /// Encode a Transfer-kind TxBody to bincode bytes (matches chain wire format).
  static Uint8List encodeTransferBody({
    required String from,
    required String to,
    required BigInt amountWei,
    required int nonce,
    required BigInt feeWei,
    required int chainId,
  }) {
    final bb = BytesBuilder();
    bb.add(_addrBytes(from));        // 20
    bb.add(_addrBytes(to));          // 20
    bb.add(_u128Le(amountWei));      // 16
    bb.add(_u64Le(nonce));           //  8
    bb.add(_u128Le(feeWei));         // 16
    bb.add(_u64Le(chainId));         //  8
    bb.add(_u32Le(0));               //  4  (TxKind::Transfer = variant 0)
    return bb.toBytes();             // 92 bytes total
  }

  /// Sign a Transfer and return a hex string suitable for `zbx_sendRawTransaction`.
  String signTransferRaw({
    required String from,
    required String to,
    required BigInt amountWei,
    required int nonce,
    required BigInt feeWei,
    required int chainId,
    required Uint8List seed,
  }) {
    final body = encodeTransferBody(
      from: from, to: to, amountWei: amountWei,
      nonce: nonce, feeWei: feeWei, chainId: chainId,
    );
    final sig = signRaw(body, seed);
    final pub = derivePublic(seed);
    final bb = BytesBuilder()
      ..add(body)   // 92
      ..add(pub)    // 32
      ..add(sig);   // 64
    return '0x${hex.encode(bb.toBytes())}';  // 188 bytes / 376 hex chars
  }

  // ── Crypto helpers ──────────────────────────────────────────────────────
  /// Ed25519 verifying key (32 bytes) from a 32-byte seed.
  static Uint8List derivePublic(Uint8List seed) {
    if (seed.length != 32) {
      throw Exception('ed25519 seed must be 32 bytes');
    }
    final priv = ed.newKeyFromSeed(seed);
    final pub = ed.public(priv);
    return Uint8List.fromList(pub.bytes);
  }

  /// EVM-style 20-byte address: last 20 bytes of keccak256(pubkey).
  static String addressFromPublic(Uint8List pub) {
    final h = _keccak256(pub);
    final last20 = h.sublist(h.length - 20);
    return '0x${hex.encode(last20)}';
  }

  // legacy alias
  static String _addressFromPublic(Uint8List pub) => addressFromPublic(pub);

  static Uint8List _keccak256(Uint8List input) {
    final k = KeccakDigest(256);
    final out = Uint8List(32);
    k.update(input, 0, input.length);
    k.doFinal(out, 0);
    return out;
  }

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
