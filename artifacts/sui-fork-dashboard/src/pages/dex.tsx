import React, { useState } from "react";
import { CodeBlock } from "@/components/ui/code-block";
import { ArrowUpDown, Layers, BarChart2, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileConnectButton } from "@/components/wallet-connect/MobileConnectButton";
import { AddTokenDialog } from "@/components/tokens/AddTokenDialog";

export default function Dex() {
  const [addTokenOpen, setAddTokenOpen] = useState(false);
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">DEX / Token Swap</h1>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAddTokenOpen(true)}
              data-testid="button-add-token-dex"
            >
              + Add Token
            </Button>
            <MobileConnectButton variant="outline" />
          </div>
        </div>
        <p className="text-lg text-muted-foreground">
          Deploy a decentralized exchange on Zebvix — lets users swap ZBX and other tokens using an AMM (Automated Market Maker) model.
        </p>
      </div>
      <AddTokenDialog
        open={addTokenOpen}
        onClose={() => setAddTokenOpen(false)}
        defaultChain="zebvix"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: ArrowUpDown, label: "Token Swap", desc: "ZBX ↔ any token" },
          { icon: Layers, label: "Liquidity Pools", desc: "AMM model" },
          { icon: BarChart2, label: "Price Oracle", desc: "On-chain pricing" },
          { icon: Coins, label: "LP Tokens", desc: "Earn trading fees" },
        ].map(({ icon: Icon, label, desc }) => (
          <div key={label} className="p-4 rounded-lg bg-card border border-border text-center">
            <Icon className="h-6 w-6 text-primary mx-auto mb-2" />
            <div className="text-sm font-semibold">{label}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
          </div>
        ))}
      </div>

      <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 text-sm">
        <span className="font-semibold text-primary">Recommended: </span>
        <span className="text-muted-foreground">
          Fork <strong className="text-foreground">Cetus Protocol</strong> or <strong className="text-foreground">Turbos Finance</strong> — both are open-source Sui-based AMM DEXs written in Move. Already compatible with Zebvix.
        </span>
      </div>

      <div className="space-y-6">
        <div className="space-y-3">
          <h2 className="text-xl font-semibold border-b border-border pb-2">AMM Architecture</h2>
          <div className="grid grid-cols-3 gap-2 text-sm text-center">
            {[
              { label: "Pool Contract (Move)", items: ["Token pair storage", "Constant product AMM", "Fee collection"] },
              { label: "Router Contract", items: ["Multi-hop swaps", "Slippage protection", "Price calculation"] },
              { label: "Frontend (React)", items: ["Swap UI", "Liquidity UI", "Price charts"] },
            ].map(({ label, items }) => (
              <div key={label} className="rounded-lg bg-card border border-border p-3">
                <div className="font-semibold text-primary mb-2">{label}</div>
                {items.map(item => (
                  <div key={item} className="text-xs text-muted-foreground py-0.5">{item}</div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-xl font-semibold border-b border-border pb-2">Step 1 — Fork Cetus AMM (Recommended)</h2>
          <CodeBlock language="bash" code={`# Clone Cetus (open-source Sui AMM)
git clone https://github.com/CetusProtocol/cetus-clmm-interface.git zebvix-dex
cd zebvix-dex

# Or use the simpler constant-product AMM:
git clone https://github.com/pentagonxyz/movemate.git
# Contains reusable Move AMM primitives`} />
        </div>

        <div className="space-y-3">
          <h2 className="text-xl font-semibold border-b border-border pb-2">Step 2 — AMM Pool Move Module</h2>
          <CodeBlock language="move" code={`// sources/pool.move — Zebvix AMM Pool
module zebvix_dex::pool {
    use sui::object::{Self, UID};
    use sui::coin::{Self, Coin};
    use sui::tx_context::TxContext;
    use sui::transfer;
    use sui::math;

    // Liquidity pool for two token types
    struct Pool<phantom CoinA, phantom CoinB> has key {
        id: UID,
        reserve_a: Coin<CoinA>,
        reserve_b: Coin<CoinB>,
        lp_supply: u64,
        fee_bps: u64,  // fee in basis points (e.g. 30 = 0.3%)
    }

    // Create a new pool
    public entry fun create_pool<CoinA, CoinB>(
        coin_a: Coin<CoinA>,
        coin_b: Coin<CoinB>,
        ctx: &mut TxContext
    ) {
        let pool = Pool<CoinA, CoinB> {
            id: object::new(ctx),
            reserve_a: coin_a,
            reserve_b: coin_b,
            lp_supply: 0,
            fee_bps: 30, // 0.3% trading fee
        };
        transfer::share_object(pool);
    }

    // Swap CoinA for CoinB using constant-product formula: x * y = k
    public entry fun swap_a_for_b<CoinA, CoinB>(
        pool: &mut Pool<CoinA, CoinB>,
        coin_in: Coin<CoinA>,
        min_out: u64,
        ctx: &mut TxContext
    ) {
        let amount_in = coin::value(&coin_in);
        let reserve_a = coin::value(&pool.reserve_a);
        let reserve_b = coin::value(&pool.reserve_b);
        
        // Constant product: dy = (y * dx) / (x + dx)
        let fee = (amount_in * pool.fee_bps) / 10000;
        let amount_in_after_fee = amount_in - fee;
        let amount_out = (reserve_b * amount_in_after_fee) / (reserve_a + amount_in_after_fee);
        
        assert!(amount_out >= min_out, 0); // slippage check
        
        coin::put(&mut pool.reserve_a, coin_in);
        let coin_out = coin::take(&mut pool.reserve_b, amount_out, ctx);
        transfer::public_transfer(coin_out, sui::tx_context::sender(ctx));
    }
}`} />
        </div>

        <div className="space-y-3">
          <h2 className="text-xl font-semibold border-b border-border pb-2">Step 3 — Deploy Move Package</h2>
          <CodeBlock language="bash" code={`# Install Sui CLI (Zebvix uses same CLI)
cd zebvix-dex

# Create Move.toml
cat > Move.toml << 'EOF'
[package]
name = "zebvix_dex"
version = "0.0.1"

[addresses]
zebvix_dex = "0x0"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "mainnet-v1.20.0" }
EOF

# Publish to Zebvix chain
zebvix-node client publish \\
  --gas-budget 100000000 \\
  --json`} />
        </div>

        <div className="space-y-3">
          <h2 className="text-xl font-semibold border-b border-border pb-2">Step 4 — DEX Frontend (React)</h2>
          <CodeBlock language="bash" code={`npx create-react-app zebvix-swap-ui --template typescript
cd zebvix-swap-ui
npm install @mysten/sui.js @mysten/wallet-kit tailwindcss`} />
          <CodeBlock language="typescript" code={`// SwapPanel.tsx — simplified ZBX swap UI component
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { useWallet } from '@mysten/wallet-kit';

const DEX_PACKAGE = '0x...'; // your published package ID
const POOL_OBJECT = '0x...'; // pool object ID after create_pool

export function SwapPanel() {
  const { signAndExecuteTransactionBlock } = useWallet();

  const handleSwap = async (amountIn: number, minOut: number) => {
    const tx = new TransactionBlock();
    const [coinIn] = tx.splitCoins(tx.gas, [tx.pure(amountIn * 1e9)]);
    
    tx.moveCall({
      target: \`\${DEX_PACKAGE}::pool::swap_a_for_b\`,
      typeArguments: ['0x2::sui::SUI', '0x2::zbx::ZBX'],
      arguments: [
        tx.object(POOL_OBJECT),
        coinIn,
        tx.pure(minOut * 1e9), // min output (slippage)
      ],
    });
    
    await signAndExecuteTransactionBlock({ transactionBlock: tx });
  };

  return (
    <div>
      <h2>Swap ZBX</h2>
      <button onClick={() => handleSwap(1, 0.99)}>Swap 1 ZBX</button>
    </div>
  );
}`} />
        </div>

        <div className="space-y-3">
          <h2 className="text-xl font-semibold border-b border-border pb-2">Add Liquidity</h2>
          <CodeBlock language="typescript" code={`// Add liquidity to ZBX/USDT pool
const tx = new TransactionBlock();
const [coinA] = tx.splitCoins(tx.gas, [tx.pure(100 * 1e9)]); // 100 ZBX
// coinB = your USDT coin object

tx.moveCall({
  target: \`\${DEX_PACKAGE}::pool::add_liquidity\`,
  typeArguments: ['ZBX_TYPE', 'USDT_TYPE'],
  arguments: [tx.object(POOL_OBJECT), coinA, coinB],
});

// You receive LP tokens representing your pool share
// LP tokens earn 0.3% of every swap through the pool`} />
        </div>

        <div className="p-4 rounded-lg border border-green-500/30 bg-green-500/5 text-sm space-y-1">
          <div className="font-semibold text-green-400">DEX Configuration</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono text-muted-foreground mt-1">
            <div>Trading fee: <span className="text-foreground">0.3% per swap</span></div>
            <div>LP fee share: <span className="text-foreground">0.25%</span></div>
            <div>Protocol fee: <span className="text-foreground">0.05%</span></div>
            <div>Model: <span className="text-foreground">x * y = k (AMM)</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
