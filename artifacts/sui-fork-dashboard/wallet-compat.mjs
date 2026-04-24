import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

// 1. ETH test vector — Vitalik's well-known sk=0x4646...46.
const sk = hexToBytes("4646464646464646464646464646464646464646464646464646464646464646");
const pubC = secp256k1.getPublicKey(sk, true);
const pubU = secp256k1.getPublicKey(sk, false);
const addr = "0x" + bytesToHex(keccak_256(pubU.slice(1)).slice(12));
console.log("[ETH compat] sk      = 0x4646...4646");
console.log("[ETH compat] pubC    = 0x" + bytesToHex(pubC));
console.log("[ETH compat] address = " + addr);
console.log("[ETH compat] expect  = 0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f");
console.log("[ETH compat] MATCH:  ", addr === "0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f");
console.log();

// 2. Founder address from new tokenomics seed.
const founderSk = keccak_256(new TextEncoder().encode("zebvix-genesis-founder-v1"));
const founderPubC = secp256k1.getPublicKey(founderSk, true);
const founderPubU = secp256k1.getPublicKey(founderSk, false);
const founderAddr = "0x" + bytesToHex(keccak_256(founderPubU.slice(1)).slice(12));
console.log("[Founder]    sk      = 0x" + bytesToHex(founderSk));
console.log("[Founder]    pubC    = 0x" + bytesToHex(founderPubC));
console.log("[Founder]    address = " + founderAddr);
console.log("[Founder]    chain   = 0x40907000ac0a1a73e4cd89889b4d7ee8980c0315");
console.log("[Founder]    MATCH:  ", founderAddr === "0x40907000ac0a1a73e4cd89889b4d7ee8980c0315");
console.log();

// 3. Sign+verify roundtrip + deterministic signature check.
const body = new TextEncoder().encode("hello-zebvix-tx-body-bytes");
const hash = sha256(body);
const sig1 = secp256k1.sign(hash, sk, { lowS: true });
const sig2 = secp256k1.sign(hash, sk, { lowS: true });
console.log("[Sign]       sig len  =", sig1.length, "(expect 64)");
console.log("[Sign]       sig hex  = 0x" + bytesToHex(sig1));
console.log("[Sign]       deter.   =", bytesToHex(sig1) === bytesToHex(sig2));
console.log("[Sign]       verify   =", secp256k1.verify(sig1, hash, pubC));
console.log("[Sign]       lowS:    ", BigInt("0x" + bytesToHex(sig1.slice(32))) <
  (secp256k1.CURVE.n / 2n + 1n));
