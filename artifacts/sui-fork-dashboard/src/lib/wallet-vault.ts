// AES-GCM keystore vault for the browser wallet.
//
// Default storage in `web-wallet.ts` puts private keys in localStorage as
// plaintext JSON ("hot dev wallet" mode). This module wraps that storage in
// a password-protected vault using PBKDF2-SHA-256 → AES-GCM 256.
//
// Security model:
//   - Vault ciphertext lives in localStorage under `zbx.wallets.vault.v1`.
//   - Per-tab plaintext cache lives in sessionStorage under
//     `zbx.wallets.session.v1` so a page reload inside the same browser
//     session doesn't require re-entering the password.
//   - Closing the tab evicts sessionStorage; the user must unlock again.
//
// Threats this DOES protect against:
//   - Stolen device with browser data at rest
//   - Backup/sync of localStorage to another device
//   - Read-only malicious browser extensions inspecting localStorage
//
// Threats this does NOT fully protect against (out of scope for hot wallet):
//   - Active XSS while the vault is unlocked in the current tab
//   - A keylogger on the user's machine
//
// On-disk format (JSON in localStorage):
//   {
//     v: 1,
//     kdf: "pbkdf2-sha256",
//     iters: 200_000,
//     salt: hex(16 bytes),
//     iv:   hex(12 bytes),
//     ct:   hex(ciphertext),
//   }

import type { StoredWallet } from "./web-wallet";

const VAULT_KEY = "zbx.wallets.vault.v1";
const SESSION_KEY = "zbx.wallets.session.v1";
const PBKDF2_ITERS = 200_000;

// In-process cache for the current tab's decrypted wallets. Survives
// re-renders but not a full page reload (sessionStorage is the bridge for
// reloads within the same tab).
let memCache: StoredWallet[] | null = null;

// Cached derived AES key + salt for the current unlock. Holding the
// `CryptoKey` (non-extractable) — never the password — lets `saveWallets`
// transparently re-encrypt the on-disk vault on every write so the user
// never loses freshly added wallets to a tab close.
let cachedKey: CryptoKey | null = null;
let cachedSalt: Uint8Array | null = null;

interface VaultBlob {
  v: 1;
  kdf: "pbkdf2-sha256";
  iters: number;
  salt: string; // hex
  iv: string; // hex
  ct: string; // hex
}

// ── hex helpers ───────────────────────────────────────────────────────────
function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}
function hexToBytes(h: string): Uint8Array {
  const m = h.length;
  const out = new Uint8Array(m / 2);
  for (let i = 0; i < m; i += 2) out[i / 2] = parseInt(h.slice(i, i + 2), 16);
  return out;
}

async function deriveAesKey(
  password: string,
  salt: Uint8Array,
  iters: number,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  // `enc.encode(password)` and `salt` are widened to `Uint8Array<ArrayBufferLike>`
  // by recent lib.dom typings; the WebCrypto signature still expects the
  // narrower `BufferSource`. Cast at the boundary — the runtime contract is
  // identical (raw octets).
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password) as BufferSource,
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: iters,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ── Public API ────────────────────────────────────────────────────────────

/** Whether a vault blob exists at all (encrypted backup present). */
export function vaultExists(): boolean {
  try {
    return !!localStorage.getItem(VAULT_KEY);
  } catch {
    return false;
  }
}

/** Whether the vault has been unlocked in this tab (plaintext is reachable). */
export function vaultUnlocked(): boolean {
  if (memCache) return true;
  try {
    return !!sessionStorage.getItem(SESSION_KEY);
  } catch {
    return false;
  }
}

/**
 * Read the decrypted wallets for the current tab. Returns [] when a vault
 * exists but is not yet unlocked — the UI is expected to detect this via
 * `vaultExists() && !vaultUnlocked()` and prompt for the password.
 */
export function readVaultedWallets(): StoredWallet[] | null {
  if (memCache) return memCache;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      memCache = parsed;
      return memCache;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persist the current decrypted wallets back into the vault, deriving a
 * fresh key from the supplied password (used for the initial lock and for
 * "rotate password" flows).
 */
export async function writeVaultedWallets(
  ws: StoredWallet[],
  password: string,
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveAesKey(password, salt, PBKDF2_ITERS);
  await encryptWithKey(ws, key, salt);
  cachedKey = key;
  cachedSalt = salt;
  memCache = ws;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(ws));
  } catch {
    /* ignore */
  }
}

/**
 * Re-encrypt the in-memory wallet list with the **cached** key derived at
 * unlock time. Called automatically from `saveWallets` so any wallet added
 * after unlock is durably persisted without re-prompting for the password.
 */
async function reencryptWithCachedKey(ws: StoredWallet[]): Promise<void> {
  if (!cachedKey || !cachedSalt) return;
  await encryptWithKey(ws, cachedKey, cachedSalt);
}

/** Encrypt + write a vault blob using a pre-derived key + salt. */
async function encryptWithKey(
  ws: StoredWallet[],
  key: CryptoKey,
  salt: Uint8Array,
): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      enc.encode(JSON.stringify(ws)) as BufferSource,
    ),
  );
  const blob: VaultBlob = {
    v: 1,
    kdf: "pbkdf2-sha256",
    iters: PBKDF2_ITERS,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    ct: bytesToHex(ct),
  };
  localStorage.setItem(VAULT_KEY, JSON.stringify(blob));
}

/**
 * Initial setup: encrypt the given wallets into a fresh vault and clear
 * any plaintext storage. Call this from the "Lock" UI.
 */
export async function lockVault(
  ws: StoredWallet[],
  password: string,
  plaintextStorageKey: string,
): Promise<void> {
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  await writeVaultedWallets(ws, password);
  // Wipe the plaintext mirror so a future at-rest dump can't recover keys.
  try {
    localStorage.removeItem(plaintextStorageKey);
  } catch {
    /* ignore */
  }
}

/**
 * Provision a fresh vault for the user — used by the "encrypted by default"
 * onboarding gate before any wallet is created or imported.
 *
 * Behaviour:
 *   - Refuses to overwrite an existing vault (caller must use "change
 *     password" instead).
 *   - If a legacy plaintext wallet list exists at `plaintextStorageKey`,
 *     migrate those wallets into the new vault and wipe the plaintext copy.
 *   - Otherwise the new vault simply starts out empty; subsequent
 *     `saveWallets` calls will encrypt against the cached key.
 *
 * Leaves the vault unlocked in this tab on success.
 */
export async function setupVault(
  password: string,
  plaintextStorageKey: string,
): Promise<void> {
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  if (vaultExists()) {
    throw new Error(
      "A vault already exists — use change-password to update it.",
    );
  }
  let existing: StoredWallet[] = [];
  try {
    const raw = localStorage.getItem(plaintextStorageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) existing = parsed as StoredWallet[];
    }
  } catch {
    /* ignore — start with an empty vault */
  }
  await writeVaultedWallets(existing, password);
  try {
    localStorage.removeItem(plaintextStorageKey);
  } catch {
    /* ignore */
  }
}

/**
 * Decrypt the vault with the given password. On success populate the
 * in-process + sessionStorage caches and return the wallet list.
 */
export async function unlockVault(password: string): Promise<StoredWallet[]> {
  const raw = localStorage.getItem(VAULT_KEY);
  if (!raw) throw new Error("No vault found");
  let blob: VaultBlob;
  try {
    blob = JSON.parse(raw) as VaultBlob;
  } catch {
    throw new Error("Vault is corrupted");
  }
  if (blob.v !== 1 || blob.kdf !== "pbkdf2-sha256") {
    throw new Error("Unsupported vault version");
  }
  const salt = hexToBytes(blob.salt);
  const iv = hexToBytes(blob.iv);
  const ct = hexToBytes(blob.ct);
  const key = await deriveAesKey(password, salt, blob.iters);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ct as BufferSource,
    );
  } catch {
    throw new Error("Wrong password");
  }
  const text = new TextDecoder().decode(plain);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Vault payload is corrupted");
  }
  if (!Array.isArray(parsed)) throw new Error("Vault payload is corrupted");
  memCache = parsed as StoredWallet[];
  cachedKey = key;
  cachedSalt = salt;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(memCache));
  } catch {
    /* ignore */
  }
  return memCache;
}

/**
 * Forget the per-tab cache without removing the on-disk vault. Subsequent
 * reads will require `unlockVault()` again.
 */
export function relockVault(): void {
  memCache = null;
  cachedKey = null;
  cachedSalt = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Decrypt the vault, restore the plaintext storage, and remove the on-disk
 * vault. Use this from a "Disable encryption" affordance — back-compat for
 * users who explicitly opt out.
 */
export async function destroyVault(
  password: string,
  plaintextStorageKey: string,
): Promise<StoredWallet[]> {
  const ws = await unlockVault(password);
  try {
    localStorage.setItem(plaintextStorageKey, JSON.stringify(ws));
    localStorage.removeItem(VAULT_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  memCache = null;
  cachedKey = null;
  cachedSalt = null;
  return ws;
}

/**
 * Internal use by `web-wallet.saveWallets` once the vault is unlocked.
 * Updates in-memory + sessionStorage caches and asynchronously re-encrypts
 * the on-disk vault with the cached AES key — no password prompt needed,
 * so freshly added wallets are durable across tab close.
 */
export function memCacheSet(ws: StoredWallet[]) {
  memCache = ws;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(ws));
  } catch {
    /* ignore */
  }
  // Fire-and-forget vault rewrite. Errors are surfaced to the console only
  // — a broken localStorage write here doesn't lose data because the
  // sessionStorage mirror still holds the latest plaintext.
  if (cachedKey) {
    void reencryptWithCachedKey(ws).catch(() => {
      /* ignore — sessionStorage is the safety net */
    });
  }
}

/**
 * Force a re-encrypt with a freshly-supplied password (used by the "Save
 * vault / rotate password" affordance). Re-derives the key from the new
 * password + a new salt and updates the cached key.
 */
export async function persistVaultUpdate(password: string): Promise<void> {
  if (!memCache) return;
  await writeVaultedWallets(memCache, password);
}
