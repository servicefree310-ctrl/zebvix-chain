import { ZebvixProvider, ZebvixWallet, formatZBX } from "../src/index.js";

async function main() {
  const provider = new ZebvixProvider();

  // Use ZBX_PRIVATE_KEY env var or fall back to a random burner
  const pk = process.env.ZBX_PRIVATE_KEY;
  const wallet = pk
    ? new ZebvixWallet(pk, provider)
    : ZebvixWallet.fromRandom(provider);

  console.log("Wallet:", wallet.address);
  console.log("ZBX balance:", formatZBX(await wallet.getZbxBalance()));
  console.log("ZUSD balance:", formatZBX(await wallet.getZusdBalance()));
  console.log("LP balance:", formatZBX(await wallet.getLpBalance()));
  console.log("Nonce:", await wallet.getZbxNonce());

  const payid = await wallet.getMyPayId();
  console.log("Pay-ID:", payid?.pay_id ?? "(none)");

  const multisigs = await wallet.listMyMultisigs();
  console.log(`Multisigs owned: ${multisigs.length}`);

  // Standard EVM transfer (commented out — requires funded wallet)
  // const tx = await wallet.sendTransaction({
  //   to: "0xRecipient...",
  //   value: parseZBX("0.01"),
  // });
  // console.log("Tx hash:", tx.hash);
  // const receipt = await tx.wait();
  // console.log("Mined in block:", receipt?.blockNumber);
}

main().catch(console.error);
