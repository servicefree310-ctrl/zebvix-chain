import type { TypedDataDomain, TypedDataField } from "ethers";

export interface MintRequest {
  sourceTxHash: string;
  recipient: string;
  amount: bigint;
  sourceChainId: bigint;
  sourceBlockHeight: bigint;
}

export const MINT_REQUEST_TYPES: Record<string, TypedDataField[]> = {
  MintRequest: [
    { name: "sourceTxHash", type: "bytes32" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "sourceChainId", type: "uint256" },
    { name: "sourceBlockHeight", type: "uint64" },
  ],
};

export function buildDomain(bscChainId: number, bridgeAddress: string): TypedDataDomain {
  return {
    name: "ZebvixBridge",
    version: "1",
    chainId: bscChainId,
    verifyingContract: bridgeAddress,
  };
}
