import {
  ZebvixProvider,
  ZebvixWallet,
  parseZBX,
  formatZBX,
  parseGwei,
  formatGwei,
  ZEBVIX_MAINNET,
  PRECOMPILES,
} from "../src/index.js";

const VPS_RPC = process.env.ZBX_RPC_URL ?? "http://93.127.213.192:8545";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}${detail ? `  — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

async function section(title: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n── ${title}`);
  try {
    await fn();
  } catch (e) {
    failed++;
    console.log(`  ✗ section threw — ${(e as Error).message}`);
  }
}

async function main(): Promise<void> {
  console.log("════════════════════════════════════════");
  console.log("  zebvix.js live integration test");
  console.log(`  RPC: ${VPS_RPC}`);
  console.log("════════════════════════════════════════");

  const provider = new ZebvixProvider({ rpcUrl: VPS_RPC });

  await section("Identity", async () => {
    const cv = await provider.getClientVersion();
    check(
      `web3_clientVersion contains 'zvm-cancun'`,
      cv.includes("zvm-cancun"),
      cv,
    );

    const zcv = await provider.getZbxClientVersion();
    check(`zbx_clientVersion alias matches`, zcv === cv, zcv);

    const net = await provider.getNetwork();
    check(
      `chainId == ${ZEBVIX_MAINNET.id}`,
      net.chainId === BigInt(ZEBVIX_MAINNET.id),
      `got ${net.chainId}`,
    );
  });

  await section("Block / Tip", async () => {
    const tip = await provider.getZbxBlockNumber();
    check(`zbx_blockNumber returns object`, typeof tip === "object" && tip !== null);
    check(`tip.height > 0`, tip.height > 0, `#${tip.height}`);
    check(`tip.hash is 0x-prefixed`, tip.hash?.startsWith("0x"));

    const blockTip = await provider.getZbxBlockByNumber(tip.height);
    check(`zbx_getBlockByNumber(tip) returns block`, blockTip !== null);
  });

  await section("Account read (zero-address)", async () => {
    const ZERO = "0x0000000000000000000000000000000000000000" as const;
    const bal = await provider.getZbxBalance(ZERO);
    check(`zbx_getBalance(0x0) returns bigint`, typeof bal === "bigint");
    const nonce = await provider.getZbxNonce(ZERO);
    check(`zbx_getNonce(0x0) returns bigint`, typeof nonce === "bigint");
  });

  await section("Pay-ID", async () => {
    const count = await provider.getPayIdCount();
    check(
      `zbx_payIdCount returns { total }`,
      typeof count.total === "number",
      `total=${count.total}`,
    );
  });

  await section("Governance", async () => {
    const props = await provider.listProposals(5);
    check(
      `zbx_proposalsList returns ProposalsListResp`,
      typeof props.count === "number" && Array.isArray(props.proposals),
      `count=${props.count} tip=${props.tip_height}`,
    );

    const flags = await provider.listFeatureFlags();
    check(
      `zbx_featureFlagsList returns flags array`,
      Array.isArray(flags.flags),
      `${flags.count} flags`,
    );
  });

  await section("Multisig", async () => {
    const c = await provider.getMultisigCount();
    check(
      `zbx_multisigCount returns { total }`,
      typeof c.total === "number",
      `total=${c.total}`,
    );
  });

  await section("AMM / Pool", async () => {
    const pool = await provider.getPool();
    check(`zbx_getPool returns data`, pool !== null && pool !== undefined);
  });

  await section("Supply / Reserve", async () => {
    const supply = await provider.getSupply();
    check(`zbx_supply returns SupplyInfo`, typeof supply === "object");
  });

  await section("Bridge", async () => {
    const r = await provider.listBridgeNetworks();
    check(
      `zbx_listBridgeNetworks returns { count, networks }`,
      typeof r.count === "number" && Array.isArray(r.networks),
      `count=${r.count}`,
    );
  });

  await section("Staking", async () => {
    const vals = await provider.listValidators();
    check(`zbx_listValidators returns data`, vals !== null && vals !== undefined);
  });

  await section("Mempool", async () => {
    const status = await provider.getMempoolStatus();
    check(`zbx_mempoolStatus returns object`, typeof status === "object");
  });

  await section("Fees", async () => {
    const gp = await provider.getZbxGasPrice();
    check(`zbx_gasPrice returns bigint`, typeof gp === "bigint", `${gp} wei`);
  });

  await section("Units", async () => {
    const w = parseZBX("1.5");
    check(`parseZBX('1.5') == 1500000000000000000n`, w === 1500000000000000000n, `${w}`);
    const z = formatZBX(w);
    check(`formatZBX(...) == '1.5'`, z === "1.5", z);

    const gw = parseGwei("20");
    check(`parseGwei('20') == 20000000000n`, gw === 20000000000n, `${gw}`);
    const back = formatGwei(gw);
    check(`formatGwei(...) == '20.0'`, back === "20.0", back);
  });

  await section("Precompiles & chain constants", async () => {
    check(
      `PRECOMPILES.bridgeOut == 0x...80`,
      PRECOMPILES.bridgeOut === "0x0000000000000000000000000000000000000080",
    );
    check(`ZEBVIX_MAINNET.id == 7878`, ZEBVIX_MAINNET.id === 7878);
    check(`ZEBVIX_MAINNET.symbol == 'ZBX'`, ZEBVIX_MAINNET.symbol === "ZBX");
    check(`ZEBVIX_MAINNET.decimals == 18`, ZEBVIX_MAINNET.decimals === 18);
  });

  await section("Wallet (random burner)", async () => {
    const w = ZebvixWallet.fromRandom(provider);
    check(`wallet.address is 0x-prefixed`, w.address.startsWith("0x"));
    const bal = await w.getZbxBalance();
    check(`burner balance is 0n`, bal === 0n, `${bal}`);
    const nonce = await w.getZbxNonce();
    check(`burner nonce is 0n`, nonce === 0n);
    const payid = await w.getMyPayId();
    check(`burner has no Pay-ID`, payid === null);
  });

  console.log("\n════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("════════════════════════════════════════");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
