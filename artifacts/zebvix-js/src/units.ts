import { parseEther, formatEther, parseUnits, formatUnits } from "ethers";

export const ZBX_DECIMALS = 18;
export const GWEI_DECIMALS = 9;

export function parseZBX(value: string | number): bigint {
  return parseEther(typeof value === "number" ? value.toString() : value);
}

export function formatZBX(wei: bigint | string | number): string {
  return formatEther(wei);
}

export function parseGwei(value: string | number): bigint {
  return parseUnits(
    typeof value === "number" ? value.toString() : value,
    GWEI_DECIMALS,
  );
}

export function formatGwei(wei: bigint | string | number): string {
  return formatUnits(wei, GWEI_DECIMALS);
}
