// Global wallet context — single source of truth for the active hot wallet.
// Pages that need to sign or display the connected address subscribe here
// instead of poking localStorage directly.

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

interface WalletCtx {
  wallets: StoredWallet[];
  active: StoredWallet | null;
  activeAddress: string | null;
  setActive: (addr: string | null) => void;
  addGenerated: (label?: string) => StoredWallet;
  addFromPrivateKey: (hex: string, label?: string) => StoredWallet;
  addFromMnemonic: (phrase: string, label?: string) => StoredWallet;
  remove: (addr: string) => void;
  refresh: () => void;
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallets, setWallets] = useState<StoredWallet[]>([]);
  const [activeAddress, setActiveAddressState] = useState<string | null>(null);

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
  }, []);

  useEffect(() => {
    refresh();
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
      saveWallets(next);
      setWallets(next);
      persistActive(w.address);
      setActiveAddressState(w.address);
      return w;
    },
    [],
  );

  const addGenerated = useCallback(
    (label = `Wallet ${loadWallets().length + 1}`) => addToList(generateWallet(label)),
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

  const active = useMemo(
    () =>
      wallets.find(
        (w) => w.address.toLowerCase() === (activeAddress ?? "").toLowerCase(),
      ) ?? null,
    [wallets, activeAddress],
  );

  const value: WalletCtx = useMemo(
    () => ({
      wallets,
      active,
      activeAddress,
      setActive,
      addGenerated,
      addFromPrivateKey,
      addFromMnemonic,
      remove,
      refresh,
    }),
    [wallets, active, activeAddress, setActive, addGenerated, addFromPrivateKey, addFromMnemonic, remove, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
