/* eslint-disable no-console */
import { ethers, network } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Deploys WrappedZBX + ZebvixBridge to the configured network.
 *
 * Required env vars:
 *   BRIDGE_OWNER         — Gnosis Safe address that will own the bridge.
 *                          For testnet you can use your deployer EOA, but for
 *                          mainnet this MUST be a deployed Safe.
 *   BRIDGE_VALIDATORS    — Comma-separated validator addresses (M-of-N signers).
 *   BRIDGE_THRESHOLD     — Integer M. Must be <= number of validators.
 *   ZEBVIX_CHAIN_ID      — Zebvix L1 chain id (default 7878).
 *
 * Optional:
 *   WZBX_ADMIN           — wZBX governance admin (defaults to BRIDGE_OWNER).
 */
async function main() {
  const owner = mustEnv("BRIDGE_OWNER");
  const validators = mustEnv("BRIDGE_VALIDATORS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const threshold = parseInt(mustEnv("BRIDGE_THRESHOLD"), 10);
  const zebvixChainId = BigInt(process.env.ZEBVIX_CHAIN_ID ?? "7878");
  const wzbxAdmin = process.env.WZBX_ADMIN ?? owner;

  if (!ethers.isAddress(owner)) throw new Error(`bad BRIDGE_OWNER: ${owner}`);
  if (!ethers.isAddress(wzbxAdmin)) throw new Error(`bad WZBX_ADMIN: ${wzbxAdmin}`);
  for (const v of validators) {
    if (!ethers.isAddress(v)) throw new Error(`bad validator: ${v}`);
  }
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error(`bad threshold: ${threshold}`);
  }
  if (validators.length < threshold) {
    throw new Error(`validators (${validators.length}) < threshold (${threshold})`);
  }

  const [deployer] = await ethers.getSigners();
  console.log("─────────────────────────────────────────────────");
  console.log(`Network:        ${network.name}`);
  console.log(`Deployer:       ${await deployer.getAddress()}`);
  console.log(`Owner (Safe):   ${owner}`);
  console.log(`wZBX admin:     ${wzbxAdmin}`);
  console.log(`Zebvix chain:   ${zebvixChainId.toString()}`);
  console.log(`Validators (${validators.length}):`);
  validators.forEach((v, i) => console.log(`  [${i}] ${v}`));
  console.log(`Threshold:      ${threshold}-of-${validators.length}`);
  console.log("─────────────────────────────────────────────────");

  // Step 1: Deploy WrappedZBX with admin = wzbxAdmin, no minter yet (we set in step 3).
  console.log("→ Deploying WrappedZBX…");
  const WrappedZBX = await ethers.getContractFactory("WrappedZBX");
  const wzbx = await WrappedZBX.deploy(wzbxAdmin, ethers.ZeroAddress);
  await wzbx.waitForDeployment();
  const wzbxAddr = await wzbx.getAddress();
  console.log(`  ✓ WrappedZBX:    ${wzbxAddr}`);

  // Step 2: Deploy ZebvixBridge.
  console.log("→ Deploying ZebvixBridge…");
  const Bridge = await ethers.getContractFactory("ZebvixBridge");
  const bridge = await Bridge.deploy(owner, wzbxAddr, validators, threshold, zebvixChainId);
  await bridge.waitForDeployment();
  const bridgeAddr = await bridge.getAddress();
  console.log(`  ✓ ZebvixBridge:  ${bridgeAddr}`);

  // Step 3: Grant MINTER_ROLE to bridge. wzbxAdmin must be deployer for this
  //         to succeed in one script run; otherwise emit a manual instruction.
  const MINTER_ROLE = await wzbx.MINTER_ROLE();
  const deployerAddr = (await deployer.getAddress()).toLowerCase();
  if (wzbxAdmin.toLowerCase() === deployerAddr) {
    console.log("→ Granting MINTER_ROLE on wZBX to bridge…");
    const tx = await wzbx.grantRole(MINTER_ROLE, bridgeAddr);
    await tx.wait();
    console.log(`  ✓ Granted (tx: ${tx.hash})`);
  } else {
    console.log("");
    console.log("⚠️  WZBX_ADMIN is not the deployer. You must execute the");
    console.log("   following call from the admin address (Safe) to enable minting:");
    console.log("");
    console.log(`     wZBX.grantRole(${MINTER_ROLE}, ${bridgeAddr})`);
    console.log("");
  }

  // Persist deployment info.
  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: await deployer.getAddress(),
    timestamp: new Date().toISOString(),
    contracts: {
      WrappedZBX: wzbxAddr,
      ZebvixBridge: bridgeAddr,
    },
    config: {
      owner,
      wzbxAdmin,
      validators,
      threshold,
      zebvixChainId: zebvixChainId.toString(),
    },
  };
  const dir = path.join(__dirname, "..", "deployments", network.name);
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, "addresses.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("─────────────────────────────────────────────────");
  console.log(`Wrote ${outPath}`);
  console.log("─────────────────────────────────────────────────");
}

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var: ${name}`);
  return v;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
