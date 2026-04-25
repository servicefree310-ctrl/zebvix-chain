import { ZebvixProvider, formatZBX } from "../src/index.js";

async function main() {
  const provider = new ZebvixProvider();

  console.log("Client:", await provider.getClientVersion());

  const tip = await provider.getZbxBlockNumber();
  console.log(`Tip: #${tip.height.toLocaleString()}  hash=${tip.hash}`);

  const supply = await provider.getSupply();
  console.log("Supply:", supply);

  const props = await provider.listProposals(5);
  console.log(`\nGovernance: ${props.count} proposals`);
  for (const p of props.proposals.slice(0, 3)) {
    console.log(`  #${p.id} [${p.status}] ${p.title}`);
  }

  const flags = await provider.listFeatureFlags();
  console.log(`\nFeature flags: ${flags.count} active`);
  for (const f of flags.flags.slice(0, 5)) {
    console.log(`  ${f.key} = ${f.value}  enabled=${f.enabled}`);
  }

  console.log(`\nGas price: ${formatZBX(await provider.getZbxGasPrice())} ZBX`);
}

main().catch(console.error);
