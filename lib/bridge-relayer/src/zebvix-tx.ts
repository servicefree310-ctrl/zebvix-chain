// ─────────────────────────────────────────────────────────────────────────────
// Zebvix tx encoder + signer for the relayer's BSC→Zebvix unlock leg.
//
// Mirrors `artifacts/sui-fork-dashboard/src/lib/bridge.ts` but for the
// `BridgeOp::BridgeIn` variant (admin-attested release of locked ZBX).
//
// Body shape (variable length):
//   from(50) + to=ZERO_ADDR(50) + amount=0(16) + nonce(8) + fee(16) + chain_id(8)
//   + tx_kind_tag(4 = 9)        <-- TxKind::Bridge
//   + bridge_op_tag(4 = 5)      <-- BridgeOp::BridgeIn
//   + asset_id(8)
//   + source_tx_hash(32 raw)    <-- bincode fixed-size [u8; 32]
//   + recipient: bincode-string (8-byte LE length + UTF-8 bytes — 50 bytes)
//   + amount: u128 LE (16)
//
// Then: signed = body || pubkey-bincode(76) || secp256k1-sig(64).
// ─────────────────────────────────────────────────────────────────────────────

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

// ── tiny binary helpers ───────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const s = hex.replace(/^0x/i, "");
  if (s.length % 2 !== 0) throw new Error("odd-length hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(bs: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bs.length; i++) {
    s += bs[i].toString(16).padStart(2, "0");
  }
  return s;
}

function u32Le(n: number): Uint8Array {
  const v = new DataView(new ArrayBuffer(4));
  v.setUint32(0, n >>> 0, true);
  return new Uint8Array(v.buffer);
}

function u64Le(n: number | bigint): Uint8Array {
  const big = typeof n === "bigint" ? n : BigInt(n);
  const v = new DataView(new ArrayBuffer(8));
  v.setBigUint64(0, big, true);
  return new Uint8Array(v.buffer);
}

const U128_MAX = (1n << 128n) - 1n;

function u128Le(n: bigint): Uint8Array {
  if (n < 0n) throw new Error(`u128Le: value ${n} is negative`);
  if (n > U128_MAX) throw new Error(`u128Le: value ${n} overflows u128`);
  const out = new Uint8Array(16);
  let x = n;
  for (let i = 0; i < 16; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function addrBincode(addr0x: string): Uint8Array {
  const a = addr0x.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) {
    throw new Error(`bad address: ${addr0x}`);
  }
  const utf = new TextEncoder().encode(a); // 42 bytes
  const out = new Uint8Array(8 + utf.length);
  out.set(u64Le(utf.length), 0);
  out.set(utf, 8);
  return out;
}

function pubkeyBincode(pub: Uint8Array): Uint8Array {
  const hex = "0x" + bytesToHex(pub);
  const utf = new TextEncoder().encode(hex); // 68 bytes
  const out = new Uint8Array(8 + utf.length);
  out.set(u64Le(utf.length), 0);
  out.set(utf, 8);
  return out;
}

// ── ETH-style address derivation from a compressed secp256k1 pubkey ────────

function addressFromPubkey(pub: Uint8Array): string {
  // Need uncompressed (65-byte 04||X||Y). @noble exposes Point for this.
  const uncompressed = secp256k1.Point.fromBytes(pub).toBytes(false);
  // keccak256 of X||Y (drop the 0x04 prefix), take last 20 bytes.
  const hash = keccak_256(uncompressed.slice(1));
  return "0x" + bytesToHex(hash.slice(-20));
}

// ── Tag constants ──────────────────────────────────────────────────────────

const TX_KIND_BRIDGE = 9;
/** BridgeOp::BridgeIn discriminator. Mirrors the enum order in
 *  `zebvix-chain/src/bridge.rs`. */
const BRIDGE_OP_BRIDGE_IN = 5;
const ZERO_ADDR = "0x" + "0".repeat(40);

// ── Body encoder ───────────────────────────────────────────────────────────

export interface EncodeBridgeInOpts {
  from: string;
  feeWei: bigint;
  nonce: number | bigint;
  chainId: number | bigint;
  assetId: bigint;
  /** 0x-prefixed 64-hex-char source tx hash on the BSC side. */
  sourceTxHash: string;
  /** 0x-prefixed 40-hex-char Zebvix recipient address. */
  recipient: string;
  /** Amount in the asset's smallest native unit (ZBX = wei, 18 dec). */
  amount: bigint;
}

export function encodeBridgeInBody(opts: EncodeBridgeInOpts): Uint8Array {
  const srcHashHex = opts.sourceTxHash.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(srcHashHex)) {
    throw new Error(`bad source_tx_hash: ${opts.sourceTxHash}`);
  }
  return concat(
    addrBincode(opts.from),                  // 50  from (admin)
    addrBincode(ZERO_ADDR),                  // 50  to = zero (BridgeIn ignores `to`)
    u128Le(0n),                              // 16  body.amount = 0 (BridgeIn carries its own)
    u64Le(opts.nonce),                       //  8
    u128Le(opts.feeWei),                     // 16
    u64Le(opts.chainId),                     //  8
    u32Le(TX_KIND_BRIDGE),                   //  4  TxKind::Bridge
    u32Le(BRIDGE_OP_BRIDGE_IN),              //  4  BridgeOp::BridgeIn
    u64Le(opts.assetId),                     //  8  asset_id
    hexToBytes(srcHashHex),                  // 32  source_tx_hash (raw bincode [u8;32])
    addrBincode(opts.recipient),             // 50  recipient (Address as bincode-string)
    u128Le(opts.amount),                     // 16  amount
  );
}

export interface SignedBridgeInTx {
  /** 0x-prefixed hex of the signed bincode envelope, ready for `zbx_sendRawTransaction`. */
  rawHex: string;
  /** Address (0x..40) derived from the admin signing key. */
  from: string;
}

/**
 * Sign a `TxKind::Bridge(BridgeOp::BridgeIn)` tx with the admin key.
 *
 * The Zebvix node verifies the secp256k1 signature AND that `from` is the
 * current registered admin (chain enforces this in `apply_tx`). Replay
 * protection on `source_tx_hash` is enforced by the Bridge module itself.
 */
export function signBridgeInTx(opts: {
  privateKeyHex: string;
  feeWei: bigint;
  nonce: number | bigint;
  chainId: number | bigint;
  assetId: bigint;
  sourceTxHash: string;
  recipient: string;
  amount: bigint;
}): SignedBridgeInTx {
  const seedHex = opts.privateKeyHex.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    throw new Error("admin private key must be 64 hex chars");
  }
  const seed = hexToBytes(seedHex);
  const pub = secp256k1.getPublicKey(seed, true); // 33-byte compressed
  const from = addressFromPubkey(pub);

  const body = encodeBridgeInBody({
    from,
    feeWei: opts.feeWei,
    nonce: opts.nonce,
    chainId: opts.chainId,
    assetId: opts.assetId,
    sourceTxHash: opts.sourceTxHash,
    recipient: opts.recipient,
    amount: opts.amount,
  });

  const sig = secp256k1.sign(body, seed, { lowS: true });
  const signed = concat(body, pubkeyBincode(pub), sig);
  return { rawHex: "0x" + bytesToHex(signed), from };
}

/** Convenience: derive the admin address that a key would sign as. */
export function adminAddressFromKey(privateKeyHex: string): string {
  const seedHex = privateKeyHex.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    throw new Error("admin private key must be 64 hex chars");
  }
  const seed = hexToBytes(seedHex);
  const pub = secp256k1.getPublicKey(seed, true);
  return addressFromPubkey(pub);
}
