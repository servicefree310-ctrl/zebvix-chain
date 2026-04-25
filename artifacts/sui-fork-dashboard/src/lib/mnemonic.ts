// BIP39 mnemonic + BIP32 HD-derivation for Zebvix wallets.
//
// We use the standard Ethereum derivation path (m/44'/60'/0'/0/0) so a
// Zebvix mnemonic can be re-imported into MetaMask / any EVM wallet and
// produce the SAME 0x-address. This works because Zebvix uses the same
// keccak256(uncompressed_pubkey[1..])[12..] address scheme as Ethereum.

import { generateMnemonic as bip39Generate, mnemonicToSeedSync, validateMnemonic as bip39Validate } from "@scure/bip39";
import { wordlist as english } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import { bytesToHex } from "@noble/hashes/utils.js";
import { addressFromPublic, publicKeyFromSeed, type StoredWallet } from "./web-wallet";

export const ETH_DEFAULT_PATH = "m/44'/60'/0'/0/0";

/** Generate a fresh BIP39 mnemonic. `strength`: 128 = 12 words, 256 = 24. */
export function generateMnemonic(strength: 128 | 256 = 128): string {
  return bip39Generate(english, strength);
}

export function validateMnemonic(phrase: string): boolean {
  return bip39Validate(phrase.trim().toLowerCase().split(/\s+/).join(" "), english);
}

/** Derive a 32-byte secp256k1 private key from a mnemonic + HD path. */
export function privateKeyFromMnemonic(
  phrase: string,
  path: string = ETH_DEFAULT_PATH,
  passphrase: string = "",
): Uint8Array {
  const cleaned = phrase.trim().toLowerCase().split(/\s+/).join(" ");
  if (!bip39Validate(cleaned, english)) {
    throw new Error("invalid BIP39 mnemonic (check spelling and word order)");
  }
  const seed = mnemonicToSeedSync(cleaned, passphrase);
  const node = HDKey.fromMasterSeed(seed).derive(path);
  if (!node.privateKey) {
    throw new Error(`derivation failed at path ${path}`);
  }
  return node.privateKey;
}

export function importWalletFromMnemonic(
  phrase: string,
  label = "Imported (mnemonic)",
  path: string = ETH_DEFAULT_PATH,
): StoredWallet {
  const sk = privateKeyFromMnemonic(phrase, path);
  const pub = publicKeyFromSeed(sk);
  return {
    address: addressFromPublic(pub),
    publicKey: "0x" + bytesToHex(pub),
    privateKey: "0x" + bytesToHex(sk),
    label,
    createdAt: Date.now(),
  };
}

/** True if the string parses as a valid BIP39 mnemonic of 12 / 15 / 18 / 21 / 24 words. */
export function looksLikeMnemonic(input: string): boolean {
  const words = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (![12, 15, 18, 21, 24].includes(words.length)) return false;
  return validateMnemonic(words.join(" "));
}
