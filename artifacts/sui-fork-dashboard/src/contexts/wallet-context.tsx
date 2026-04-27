import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  loadWallets,
  saveWallets,
  getActiveAddress,
  setActiveAddress as persistActive,
  generateWallet,
  importWalletFromHex,
  removeWallet as removeStored,
  type StoredWallet,
} from "@/lib/web-wallet";
import { importWalletFromMnemonic } from "@/lib/mnemonic";
import { vaultExists, vaultUnlocked } from "@/lib/wallet-vault";

const REMOTE_KEY = "zbx.wallet.remote";

export interface RemoteWallet {
  address: string;
  label: string;
  sessionId: string;
  relayUrl: string;
  connectedAt: number;
}

/**
 * Effective active wallet. Always exposes `address` + `label` + `privateKey`
 * so existing local-signing call sites compile, but `privateKey` is empty
 * for remote (mobile-paired) wallets — every signing page MUST guard with
 * `isRemote` (or `kind === "remote"`) before attempting a local sign.
 */
export interface ActiveWallet {
  kind: "local" | "remote";
  address: string;
  label: string;
  privateKey: string; // "" for remote
  /** Present only for remote wallets. */
  remote?: RemoteWallet;
}

interface WalletCtx {
  wallets: StoredWallet[];
  /** The effective active wallet — a connected mobile wallet takes priority over a local one. */
  active: ActiveWallet | null;
  /** The local stored wallet that is "selected" — independent of remote connection. */
  localActive: StoredWallet | null;
  /** A connected mobile wallet (set after a successful QR scan), if any. */
  remote: RemoteWallet | null;
  activeAddress: string | null;
  isRemote: boolean;
  /**
   * Whether the encrypted wallet vault is currently usable for new
   * mints — true ⇔ vault exists AND is unlocked in this tab. UI
   * components MUST check this before calling `addGenerated` /
   * `addFromPrivateKey` / `addFromMnemonic` to avoid an unhandled
   * "vault not ready" exception from the storage layer.
   */
  vaultReady: boolean;
  /** Coarse vault state: "missing" (set up needed), "locked", or "ready". */
  vaultState: "missing" | "locked" | "ready";
  setActive: (addr: string | null) => void;
  addGenerated: (label?: string) => StoredWallet;
  addFromPrivateKey: (hex: string, label?: string) => StoredWallet;
  addFromMnemonic: (phrase: string, label?: string) => StoredWallet;
  remove: (addr: string) => void;
  /**
   * Rename an existing stored wallet's user-facing label.  No-op if the
   * address is not in the local list.  Persists through whichever storage
   * layer is active (vault or plaintext) — same write-path as `addToList`.
   */
  rename: (addr: string, label: string) => void;
  refresh: () => void;
  connectRemote: (info: Omit<RemoteWallet, "connectedAt">) => void;
  disconnectRemote: () => void;
}

const Ctx = createContext<WalletCtx | null>(null);

function loadRemote(): RemoteWallet | null {
  try {
    const raw = sessionStorage.getItem(REMOTE_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as RemoteWallet;
    if (!r?.address || !r?.sessionId || !r?.relayUrl) return null;
    return r;
  } catch {
    return null;
  }
}

function saveRemote(r: RemoteWallet | null) {
  try {
    if (r) sessionStorage.setItem(REMOTE_KEY, JSON.stringify(r));
    else sessionStorage.removeItem(REMOTE_KEY);
  } catch {
    /* ignore */
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<StoredWallet[]>([]);
  const [activeAddress, setActiveAddressState] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteWallet | null>(null);
  // Vault state is sampled into React state so components re-render when
  // the user encrypts / unlocks via VaultControls. The underlying truth
  // still lives in `vaultExists()` / `vaultUnlocked()`.
  const [vaultState, setVaultStateInternal] = useState<
    "missing" | "locked" | "ready"
  >(() => {
    if (typeof window === "undefined") return "missing";
    if (!vaultExists()) return "missing";
    return vaultUnlocked() ? "ready" : "locked";
  });

  const sampleVaultState = useCallback(() => {
    if (!vaultExists()) setVaultStateInternal("missing");
    else if (vaultUnlocked()) setVaultStateInternal("ready");
    else setVaultStateInternal("locked");
  }, []);

  const refresh = useCallback(() => {
    const ws = loadWallets();
    setWallets(ws);
    const a = getActiveAddress();
    if (a && ws.some((w) => w.address.toLowerCase() === a.toLowerCase())) {
      setActiveAddressState(a);
    } else if (ws[0]) {
      persistActive(ws[0].address);
      setActiveAddressState(ws[0].address);
    } else {
      setActiveAddressState(null);
    }
    sampleVaultState();
  }, [sampleVaultState]);

  useEffect(() => {
    refresh();
    setRemote(loadRemote());
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith("zbx.wallet")) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  const setActive = useCallback((addr: string | null) => {
    persistActive(addr);
    setActiveAddressState(addr);
  }, []);

  const addToList = useCallback(
    (w: StoredWallet) => {
      const ws = loadWallets();
      const exists = ws.some(
        (x) => x.address.toLowerCase() === w.address.toLowerCase(),
      );
      const next = exists ? ws : [...ws, w];
      // `saveWallets` enforces the encrypted-by-default policy and throws
      // a typed `VAULT_NOT_READY` error when the vault is missing or
      // locked. We let that propagate to the caller — every UI mint site
      // is expected to either pre-check `vaultReady` from the context or
      // wrap the call in try/catch with `isVaultNotReady` so the user
      // gets a "set up / unlock" prompt instead of a crash.
      saveWallets(next);
      setWallets(next);
      persistActive(w.address);
      setActiveAddressState(w.address);
      // Re-sample vault state in case `saveWallets` minted into a freshly
      // unlocked vault for the first time.
      sampleVaultState();
      return w;
    },
    [sampleVaultState],
  );

  const addGenerated = useCallback(
    (label = `Wallet ${loadWallets().length + 1}`) =>
      addToList(generateWallet(label)),
    [addToList],
  );
  const addFromPrivateKey = useCallback(
    (hex: string, label?: string) =>
      addToList(importWalletFromHex(hex, label ?? "Imported (key)")),
    [addToList],
  );
  const addFromMnemonic = useCallback(
    (phrase: string, label?: string) =>
      addToList(importWalletFromMnemonic(phrase, label ?? "Imported (mnemonic)")),
    [addToList],
  );

  const remove = useCallback(
    (addr: string) => {
      removeStored(addr);
      refresh();
    },
    [refresh],
  );

  const rename = useCallback(
    (addr: string, label: string) => {
      const target = addr.toLowerCase();
      const next = loadWallets().map((w) =>
        w.address.toLowerCase() === target ? { ...w, label } : w,
      );
      // Goes through the same encrypted-by-default write-path as `addToList`
      // — propagates VAULT_NOT_READY for the caller to surface.
      saveWallets(next);
      setWallets(next);
      sampleVaultState();
    },
    [sampleVaultState],
  );

  const connectRemote = useCallback(
    (info: Omit<RemoteWallet, "connectedAt">) => {
      const r: RemoteWallet = {
        ...info,
        address: info.address.toLowerCase(),
        connectedAt: Date.now(),
      };
      saveRemote(r);
      setRemote(r);
    },
    [],
  );

  const disconnectRemote = useCallback(() => {
    saveRemote(null);
    setRemote(null);
  }, []);

  const localActive = useMemo(
    () =>
      wallets.find(
        (w) => w.address.toLowerCase() === (activeAddress ?? "").toLowerCase(),
      ) ?? null,
    [wallets, activeAddress],
  );

  // Effective active wallet: remote (mobile-connected) takes priority
  // so every page that reads `active` reflects the connected wallet.
  const active: ActiveWallet | null = useMemo(() => {
    if (remote) {
      return {
        kind: "remote",
        address: remote.address,
        label: remote.label,
        privateKey: "", // remote signs on the phone — no key on dashboard
        remote,
      };
    }
    if (localActive) {
      return {
        kind: "local",
        address: localActive.address,
        label: localActive.label,
        privateKey: localActive.privateKey,
      };
    }
    return null;
  }, [remote, localActive]);

  const effectiveAddress = active?.address ?? null;

  const value: WalletCtx = useMemo(
    () => ({
      wallets,
      active,
      localActive,
      remote,
      activeAddress: effectiveAddress,
      isRemote: !!remote,
      vaultReady: vaultState === "ready",
      vaultState,
      setActive,
      addGenerated,
      addFromPrivateKey,
      addFromMnemonic,
      remove,
      rename,
      refresh,
      connectRemote,
      disconnectRemote,
    }),
    [
      wallets,
      active,
      localActive,
      remote,
      effectiveAddress,
      vaultState,
      setActive,
      addGenerated,
      addFromPrivateKey,
      addFromMnemonic,
      remove,
      rename,
      refresh,
      connectRemote,
      disconnectRemote,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
