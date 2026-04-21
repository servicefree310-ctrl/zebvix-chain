import React, { useState } from "react";
import {
  Layers, Code2, Coins, Image, Vote, Droplets,
  Globe, Zap, ChevronDown, ChevronRight, Copy, Check,
  ArrowLeftRight, BookOpen, Terminal, Link2
} from "lucide-react";

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function CodeBlock({ code, lang = "move" }: { code: string; lang?: string }) {
  return (
    <div className="rounded-lg border border-border bg-[#0d1117] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-muted/10">
        <span className="text-xs font-mono text-muted-foreground">{lang}</span>
        <CopyBtn text={code} />
      </div>
      <pre className="text-xs text-green-300/90 font-mono p-4 overflow-x-auto leading-relaxed">{code}</pre>
    </div>
  );
}

function Section({
  icon: Icon, title, color, children, badge
}: {
  icon: React.ElementType; title: string; color: string; children: React.ReactNode; badge?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`rounded-xl border ${color} overflow-hidden`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/10 transition-colors text-left"
      >
        <Icon className="h-5 w-5 shrink-0" style={{ color: "inherit" }} />
        <span className="font-bold text-foreground flex-1">{title}</span>
        {badge && <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono">{badge}</span>}
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-5 pb-5 space-y-4">{children}</div>}
    </div>
  );
}

function InfoBadge({ label, value, color = "bg-muted/20 text-foreground" }: { label: string; value: string; color?: string }) {
  return (
    <div className={`inline-flex flex-col items-center px-4 py-2.5 rounded-lg ${color} border border-border/50 text-center`}>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className="font-bold text-sm font-mono mt-0.5">{value}</span>
    </div>
  );
}

const CUSTOM_TOKEN_CODE = `module zebvix::mytoken {
    use sui::coin::{Self, TreasuryCap};
    use sui::tx_context::TxContext;

    // One-time witness — naam capital mein
    struct MYTOKEN has drop {}

    fun init(witness: MYTOKEN, ctx: &mut TxContext) {
        let (treasury_cap, metadata) = coin::create_currency(
            witness,
            9,               // decimals (9 = MIST style)
            b"MYT",          // symbol
            b"MyToken",      // name
            b"Custom token on Zebvix chain",
            option::none(),  // icon url
            ctx
        );
        // Treasury cap = mint/burn authority
        transfer::public_transfer(treasury_cap, tx_context::sender(ctx));
        transfer::public_share_object(metadata);
    }

    // Mint tokens
    public fun mint(
        cap: &mut TreasuryCap<MYTOKEN>,
        amount: u64,
        ctx: &mut TxContext
    ): coin::Coin<MYTOKEN> {
        coin::mint(cap, amount, ctx)
    }

    // Burn tokens
    public fun burn(
        cap: &mut TreasuryCap<MYTOKEN>,
        coin: coin::Coin<MYTOKEN>
    ) {
        coin::burn(cap, coin);
    }
}`;

const NFT_CODE = `module zebvix::zebvix_nft {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use std::string::{Self, String};

    struct ZebvixNFT has key, store {
        id: UID,
        name: String,
        description: String,
        image_url: String,
        creator: address,
    }

    struct MintCap has key { id: UID }

    fun init(ctx: &mut TxContext) {
        transfer::transfer(MintCap {
            id: object::new(ctx)
        }, tx_context::sender(ctx));
    }

    public fun mint(
        _cap: &MintCap,
        name: vector<u8>,
        description: vector<u8>,
        image_url: vector<u8>,
        recipient: address,
        ctx: &mut TxContext
    ) {
        let nft = ZebvixNFT {
            id: object::new(ctx),
            name: string::utf8(name),
            description: string::utf8(description),
            image_url: string::utf8(image_url),
            creator: tx_context::sender(ctx),
        };
        transfer::public_transfer(nft, recipient);
    }
}`;

const DAO_CODE = `module zebvix::dao {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::table::{Self, Table};
    use sui::transfer;

    struct Proposal has key {
        id: UID,
        title: vector<u8>,
        yes_votes: u64,
        no_votes: u64,
        deadline_epoch: u64,
        executed: bool,
    }

    struct VoteToken has key, store { id: UID }

    // Cast vote
    public fun vote(
        proposal: &mut Proposal,
        _token: &VoteToken,
        approve: bool,
        ctx: &mut TxContext
    ) {
        assert!(tx_context::epoch(ctx) <= proposal.deadline_epoch, 0);
        if (approve) { proposal.yes_votes = proposal.yes_votes + 1; }
        else         { proposal.no_votes  = proposal.no_votes  + 1; }
    }
}`;

const AIRDROP_CODE = `module zebvix::airdrop {
    use sui::coin::{Self, TreasuryCap, Coin};
    use sui::tx_context::TxContext;
    use sui::transfer;

    // Airdrop ZBX-based tokens to a list of addresses
    public fun airdrop_batch<T>(
        cap: &mut TreasuryCap<T>,
        recipients: vector<address>,
        amount_each: u64,
        ctx: &mut TxContext
    ) {
        let i = 0u64;
        let len = vector::length(&recipients);
        while (i < len) {
            let addr = *vector::borrow(&recipients, i);
            let coin = coin::mint(cap, amount_each, ctx);
            transfer::public_transfer(coin, addr);
            i = i + 1;
        }
    }
}`;

const DEFI_CODE = `module zebvix::simple_vault {
    use sui::coin::{Self, Coin};
    use sui::object::{Self, UID};
    use sui::balance::{Self, Balance};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;

    struct Vault<phantom T> has key {
        id: UID,
        reserve: Balance<T>,
        total_deposited: u64,
    }

    // Deposit coins into vault
    public fun deposit<T>(
        vault: &mut Vault<T>,
        coin: Coin<T>,
    ) {
        let amount = coin::value(&coin);
        vault.total_deposited = vault.total_deposited + amount;
        balance::join(&mut vault.reserve, coin::into_balance(coin));
    }

    // Withdraw from vault
    public fun withdraw<T>(
        vault: &mut Vault<T>,
        amount: u64,
        ctx: &mut TxContext
    ): Coin<T> {
        coin::from_balance(
            balance::split(&mut vault.reserve, amount),
            ctx
        )
    }
}`;

const WEB3_RPC = `// JavaScript / TypeScript — Zebvix Web3 SDK
import { ZebvixClient } from '@zebvix/sdk';

const client = new ZebvixClient({
  url: 'https://rpc.zebvix.network',    // mainnet
  // url: 'https://rpc-testnet.zebvix.network',  // testnet
});

// Get latest checkpoint
const checkpoint = await client.getLatestCheckpointSequenceNumber();

// Get balance
const balance = await client.getBalance({
  owner: '0xYourAddress',
  coinType: '0x2::zbx::ZBX',
});
console.log('Balance:', balance.totalBalance, 'MIST');

// Execute transaction
const txb = new TransactionBlock();
txb.transferObjects([...], recipient);
const result = await client.signAndExecuteTransactionBlock({
  signer: keypair,
  transactionBlock: txb,
});`;

const WEB3_EVENTS = `// Subscribe to on-chain events
const unsubscribe = await client.subscribeEvent({
  filter: { MoveModule: { package: '0xYourPkg', module: 'mytoken' } },
  onMessage: (event) => {
    console.log('Event:', event.type, event.parsedJson);
  },
});

// Get objects owned by address
const objects = await client.getOwnedObjects({
  owner: '0xYourAddress',
  filter: { StructType: '0xPkg::nft::ZebvixNFT' },
});

// Call view function (read-only)
const result = await client.devInspectTransactionBlock({
  sender: '0xSender',
  transactionBlock: txb,
});`;

const DEPLOY_CMD = `# 1. Build Move package
cd my-zebvix-contract/
zebvix move build

# 2. Run tests
zebvix move test

# 3. Deploy to testnet
zebvix client publish \\
  --gas-budget 100000000 \\
  --rpc-url https://rpc-testnet.zebvix.network

# 4. Deploy to mainnet
zebvix client publish \\
  --gas-budget 100000000 \\
  --rpc-url https://rpc.zebvix.network`;

const MOVE_TOML = `[package]
name    = "MyZebvixContract"
version = "0.0.1"
edition = "2024.beta"

[dependencies]
Zebvix = { git = "https://github.com/zebvix/zebvix-framework.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "mainnet-v1.69.2" }

[addresses]
mycontract = "0x0"
zebvix     = "0x2"`;

export default function FabricLayer() {
  const [activeTab, setActiveTab] = useState<"contracts" | "web3">("contracts");

  const tabs = [
    { id: "contracts" as const, label: "Move Contracts", icon: Code2 },
    { id: "web3" as const, label: "Web3 Integration", icon: Globe },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-500/20 flex items-center justify-center">
            <Layers className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Zebvix Fabric Layer</h1>
            <p className="text-sm text-muted-foreground">Move smart contracts + Web3 integration guide for Zebvix chain</p>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap gap-3">
        <InfoBadge label="Language" value="Move 2024" color="bg-violet-500/10 text-violet-300" />
        <InfoBadge label="VM" value="MoveVM" color="bg-blue-500/10 text-blue-300" />
        <InfoBadge label="Gas Token" value="ZBX" color="bg-primary/10 text-primary" />
        <InfoBadge label="Address" value="20 bytes" color="bg-orange-500/10 text-orange-300" />
        <InfoBadge label="RPC" value="JSON-RPC 2.0" color="bg-yellow-500/10 text-yellow-300" />
      </div>

      {/* Architecture note */}
      <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 flex gap-3">
        <BookOpen className="h-5 w-5 text-violet-400 shrink-0 mt-0.5" />
        <div className="text-sm space-y-1">
          <div className="font-semibold text-violet-300">Fabric Layer kya hai?</div>
          <div className="text-muted-foreground">
            Zebvix chain ka programmable layer — jisme Move modules (smart contracts) run karte hain. 
            Sui ka MoveVM use hota hai, isliye sab Sui Move packages directly deploy ho sakte hain. 
            Native token <strong className="text-foreground">ZBX</strong> gas fee ke liye use hota hai — 
            custom tokens Move contracts se banate hain.
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border border-b-0 transition-colors -mb-px
              ${activeTab === tab.id
                ? "bg-background border-border text-foreground"
                : "bg-muted/20 border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── CONTRACTS TAB ─── */}
      {activeTab === "contracts" && (
        <div className="space-y-4">

          {/* Move.toml */}
          <div className="rounded-xl border border-border bg-muted/5 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-bold text-foreground">Project Setup (Move.toml)</h3>
            </div>
            <CodeBlock code={MOVE_TOML} lang="toml" />
            <CodeBlock code={DEPLOY_CMD} lang="bash" />
          </div>

          {/* Custom Token */}
          <Section icon={Coins} title="Custom Token (Fungible)" color="border-primary/30 bg-primary/3" badge="coin::create_currency">
            <p className="text-sm text-muted-foreground">
              ZBX ke alawa apna custom token banao — ERC-20 jaisa. 
              <strong className="text-foreground"> TreasuryCap</strong> ke paas mint/burn authority hoti hai.
            </p>
            <div className="grid grid-cols-3 gap-3 text-xs">
              {[
                { k: "Decimals", v: "9 (MIST style)" },
                { k: "Mint", v: "TreasuryCap se" },
                { k: "Transfer", v: "Koi bhi kar sakta" },
              ].map(r => (
                <div key={r.k} className="rounded-lg bg-muted/20 p-3 border border-border/50">
                  <div className="text-muted-foreground">{r.k}</div>
                  <div className="font-mono font-semibold text-foreground mt-0.5">{r.v}</div>
                </div>
              ))}
            </div>
            <CodeBlock code={CUSTOM_TOKEN_CODE} />
          </Section>

          {/* NFT */}
          <Section icon={Image} title="NFT Collection" color="border-pink-500/30 bg-pink-500/3" badge="has key, store">
            <p className="text-sm text-muted-foreground">
              On-chain NFT — image URL, name, description chain pe store hoti hai. 
              <strong className="text-foreground"> MintCap</strong> se mint authority control hoti hai.
            </p>
            <div className="grid grid-cols-3 gap-3 text-xs">
              {[
                { k: "Storage", v: "On-chain object" },
                { k: "Mint", v: "MintCap se" },
                { k: "Transfer", v: "public_transfer" },
              ].map(r => (
                <div key={r.k} className="rounded-lg bg-muted/20 p-3 border border-border/50">
                  <div className="text-muted-foreground">{r.k}</div>
                  <div className="font-mono font-semibold text-foreground mt-0.5">{r.v}</div>
                </div>
              ))}
            </div>
            <CodeBlock code={NFT_CODE} />
          </Section>

          {/* DeFi Vault */}
          <Section icon={ArrowLeftRight} title="DeFi — Simple Vault (Deposit / Withdraw)" color="border-blue-500/30 bg-blue-500/3" badge="Balance<T>">
            <p className="text-sm text-muted-foreground">
              Basic DeFi building block — coins vault mein deposit karo, baad mein withdraw karo. 
              Isi pattern se lending protocol, liquidity pool banate hain.
            </p>
            <CodeBlock code={DEFI_CODE} />
          </Section>

          {/* DAO */}
          <Section icon={Vote} title="DAO Governance" color="border-yellow-500/30 bg-yellow-500/3" badge="on-chain voting">
            <p className="text-sm text-muted-foreground">
              Decentralized voting — proposal banao, VoteToken holders vote karein, deadline ke baad execute karo.
            </p>
            <div className="grid grid-cols-3 gap-3 text-xs mb-2">
              {[
                { k: "Vote Type", v: "Yes / No" },
                { k: "Authority", v: "VoteToken holders" },
                { k: "Deadline", v: "epoch number" },
              ].map(r => (
                <div key={r.k} className="rounded-lg bg-muted/20 p-3 border border-border/50">
                  <div className="text-muted-foreground">{r.k}</div>
                  <div className="font-mono font-semibold text-foreground mt-0.5">{r.v}</div>
                </div>
              ))}
            </div>
            <CodeBlock code={DAO_CODE} />
          </Section>

          {/* Airdrop */}
          <Section icon={Droplets} title="Airdrop Contract" color="border-cyan-500/30 bg-cyan-500/3" badge="batch transfer">
            <p className="text-sm text-muted-foreground">
              Ek transaction mein hazaro addresses ko tokens bhejo — TreasuryCap se mint karke direct transfer.
            </p>
            <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/20 p-3 text-xs text-cyan-300 mb-2">
              💡 <strong>Tip:</strong> Ek transaction mein max ~500 recipients — badi list ko batches mein split karo
            </div>
            <CodeBlock code={AIRDROP_CODE} />
          </Section>

        </div>
      )}

      {/* ─── WEB3 TAB ─── */}
      {activeTab === "web3" && (
        <div className="space-y-4">

          {/* Stack overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "RPC", value: "JSON-RPC 2.0", sub: "sui_* methods", color: "border-violet-500/30" },
              { label: "SDK", value: "@zebvix/sdk", sub: "TypeScript / Rust", color: "border-blue-500/30" },
              { label: "Wallets", value: "Zebvix Wallet", sub: "+ Sui-compatible", color: "border-primary/30" },
              { label: "Events", value: "WebSocket", sub: "Real-time subscribe", color: "border-orange-500/30" },
            ].map((c, i) => (
              <div key={i} className={`rounded-xl border ${c.color} bg-muted/5 p-4 text-center`}>
                <div className="text-xs text-muted-foreground">{c.label}</div>
                <div className="font-bold text-foreground mt-1">{c.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{c.sub}</div>
              </div>
            ))}
          </div>

          {/* RPC Endpoints */}
          <div className="rounded-xl border border-border bg-muted/5 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-bold text-foreground">RPC Endpoints</h3>
            </div>
            <div className="space-y-2">
              {[
                { label: "Mainnet RPC", url: "https://rpc.zebvix.network", badge: "HTTPS", color: "text-primary" },
                { label: "Testnet RPC", url: "https://rpc-testnet.zebvix.network", badge: "HTTPS", color: "text-yellow-400" },
                { label: "Mainnet WS", url: "wss://ws.zebvix.network", badge: "WebSocket", color: "text-blue-400" },
                { label: "Testnet WS", url: "wss://ws-testnet.zebvix.network", badge: "WebSocket", color: "text-cyan-400" },
                { label: "Local Node", url: "http://127.0.0.1:9000", badge: "Local", color: "text-muted-foreground" },
              ].map((ep, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/10 px-4 py-2.5">
                  <span className="text-xs text-muted-foreground w-28 shrink-0">{ep.label}</span>
                  <code className={`text-xs font-mono flex-1 ${ep.color}`}>{ep.url}</code>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/30 text-muted-foreground shrink-0">{ep.badge}</span>
                  <CopyBtn text={ep.url} />
                </div>
              ))}
            </div>
          </div>

          {/* SDK — Client Setup & Queries */}
          <Section icon={Code2} title="SDK — Client Setup & Queries" color="border-violet-500/30 bg-violet-500/3" badge="@zebvix/sdk">
            <p className="text-sm text-muted-foreground">
              JavaScript/TypeScript SDK — Sui SDK ke same pattern, sirf RPC URL change karo.
            </p>
            <CodeBlock code={WEB3_RPC} lang="typescript" />
          </Section>

          {/* Events & Objects */}
          <Section icon={Zap} title="Events & Object Queries" color="border-orange-500/30 bg-orange-500/3" badge="subscribeEvent">
            <p className="text-sm text-muted-foreground">
              Real-time events subscribe karo — NFT mint, token transfer, DAO vote sab track kar sakte ho.
            </p>
            <CodeBlock code={WEB3_EVENTS} lang="typescript" />
          </Section>

          {/* Wallet integration */}
          <Section icon={Globe} title="Wallet Connection" color="border-primary/30 bg-primary/3" badge="dApp Kit">
            <p className="text-sm text-muted-foreground mb-2">
              Zebvix Wallet browser extension ya Sui-compatible wallets — same ConnectButton pattern.
            </p>
            <CodeBlock code={`// React + @zebvix/dapp-kit
import { ConnectButton, useCurrentAccount, useSignAndExecuteTransactionBlock } from '@zebvix/dapp-kit';
import { ZebvixClientProvider, WalletProvider } from '@zebvix/dapp-kit';

// Wrap your app
<ZebvixClientProvider networks={{ mainnet: { url: 'https://rpc.zebvix.network' } }}>
  <WalletProvider autoConnect>
    <App />
  </WalletProvider>
</ZebvixClientProvider>

// In component
const account = useCurrentAccount();
const { mutate: signAndExecute } = useSignAndExecuteTransactionBlock();

// Connect button
<ConnectButton />

// Execute txn
signAndExecute({ transactionBlock: txb }, {
  onSuccess: (result) => console.log('Txn:', result.digest),
});`} lang="tsx" />
          </Section>

          {/* Common RPC Methods */}
          <div className="rounded-xl border border-border bg-muted/5 p-5 space-y-3">
            <h3 className="font-bold text-foreground">Common JSON-RPC Methods</h3>
            <div className="space-y-2">
              {[
                { method: "zbx_getBalance", desc: "Address ka ZBX balance" },
                { method: "zbx_getOwnedObjects", desc: "Kisi address ke saare objects (NFT, coins, etc.)" },
                { method: "zbx_getObject", desc: "Single object ki full detail" },
                { method: "zbx_executeTransactionBlock", desc: "Signed transaction submit karo" },
                { method: "zbx_getCheckpoint", desc: "Checkpoint info" },
                { method: "zbx_subscribeEvent", desc: "WebSocket — live events" },
                { method: "zbx_devInspectTransactionBlock", desc: "Read-only call — view functions" },
                { method: "zbx_getValidators", desc: "Active validator set" },
              ].map((r, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <code className="text-xs font-mono text-primary bg-primary/10 px-2 py-1 rounded shrink-0">{r.method}</code>
                  <span className="text-muted-foreground">{r.desc}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
