/* eslint-disable no-console */
import { run, network } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

async function main() {
  const file = path.join(__dirname, "..", "deployments", network.name, "addresses.json");
  if (!fs.existsSync(file)) throw new Error(`no deployment found for ${network.name}`);
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));

  console.log("→ Verifying WrappedZBX…");
  await run("verify:verify", {
    address: dep.contracts.WrappedZBX,
    constructorArguments: [dep.config.wzbxAdmin, "0x0000000000000000000000000000000000000000"],
  });

  console.log("→ Verifying ZebvixBridge…");
  await run("verify:verify", {
    address: dep.contracts.ZebvixBridge,
    constructorArguments: [
      dep.config.owner,
      dep.contracts.WrappedZBX,
      dep.config.validators,
      dep.config.threshold,
      dep.config.zebvixChainId,
    ],
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
