export interface ZebvixChainInfo {
  id: number;
  idHex: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
  rpcUrl: string;
  explorerUrl?: string;
  precompiles: {
    bridgeOut: `0x${string}`;
    payIdResolve: `0x${string}`;
    ammSwap: `0x${string}`;
    multisig: `0x${string}`;
  };
}

export const ZEBVIX_MAINNET: ZebvixChainInfo = {
  id: 7878,
  idHex: "0x1ec6",
  name: "Zebvix Mainnet",
  symbol: "ZBX",
  decimals: 18,
  rpcUrl: "http://93.127.213.192:8545",
  precompiles: {
    bridgeOut: "0x0000000000000000000000000000000000000080",
    payIdResolve: "0x0000000000000000000000000000000000000081",
    ammSwap: "0x0000000000000000000000000000000000000082",
    multisig: "0x0000000000000000000000000000000000000083",
  },
};
