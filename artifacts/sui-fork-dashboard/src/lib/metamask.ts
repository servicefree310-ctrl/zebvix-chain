// Minimal EIP-1193 type surface kept around for the BSC bridge UI
// (`src/lib/bsc-bridge.ts` and `src/components/bridge/BscSidePanel.tsx`),
// which still talks to a user-supplied injected wallet (e.g. MetaMask) on
// the Binance Smart Chain side of the bridge.
//
// The first-party ZBX wallet page (`/wallet`) does NOT use this module —
// it ships its own native send/receive flow and a QR-based receive tab.

export interface RequestArguments {
  method: string;
  params?: unknown[] | object;
}

export interface EthProvider {
  isMetaMask?: boolean;
  request: (args: RequestArguments) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: EthProvider;
  }
}

export {};
