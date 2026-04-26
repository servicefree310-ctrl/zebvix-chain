import { TypedDataDomain, TypedDataField } from "ethers";

/**
 * EIP-712 typed-data for ZebvixBridge.mintFromZebvix.
 * MUST match the Solidity contract's MINT_REQUEST_TYPEHASH exactly:
 *   keccak256("MintRequest(bytes32 sourceTxHash,address recipient,uint256 amount,uint256 sourceChainId,uint64 sourceBlockHeight)")
 */

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
