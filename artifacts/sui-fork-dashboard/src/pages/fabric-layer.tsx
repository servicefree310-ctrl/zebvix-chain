import React, { useState } from "react";
import {
  Layers, Code2, Coins, Image, Vote, Droplets,
  Globe, Zap, ChevronDown, ChevronRight, Copy, Check,
  ArrowLeftRight, BookOpen, Terminal, Link2, AtSign
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

    // One-time witness — name in capitals
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

const MASTER_POOL_CODE = `// ══════════════════════════════════════════════════════
// zebvix::master_pool  —  Global ZBX base pool (no admin)
// ══════════════════════════════════════════════════════
module zebvix::master_pool {
    use sui::object::{Self, UID};
    use sui::balance::{Self, Balance};
    use sui::tx_context::TxContext;
    use sui::transfer;
    use zebvix::zbx::ZBX;  // native coin type

    struct MasterPool has key {
        id: UID,
        zbx_reserve: Balance<ZBX>,
        total_volume_zbx: u64,
        // NO admin_cap, NO owner — protocol owned forever
    }

    fun init(ctx: &mut TxContext) {
        // Shared from genesis — permanently decentralized
        transfer::share_object(MasterPool {
            id: object::new(ctx),
            zbx_reserve: balance::zero<ZBX>(),
            total_volume_zbx: 0,
        });
    }

    // Only sub_pool module can interact with reserves
    public(friend) fun borrow_reserve(pool: &MasterPool): &Balance<ZBX> {
        &pool.zbx_reserve
    }
}

// ══════════════════════════════════════════════════════
// zebvix::sub_pool  —  Permissionless token pair pools
// ══════════════════════════════════════════════════════
module zebvix::sub_pool {
    use sui::object::{Self, UID};
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use zebvix::zbx::ZBX;

    // ── Error codes ──
    const E_MANUAL_LIQUIDITY_DISABLED: u64 = 100;
    const E_REMOVE_LIQUIDITY_DISABLED: u64 = 101;
    const E_ZERO_AMOUNT:               u64 = 102;
    const E_INSUFFICIENT_OUTPUT:       u64 = 103;

    // Fee constants
    const DEFAULT_FEE_BPS: u64 = 30;   // 0.30% per trade
    const BPS_DENOM:        u64 = 10_000;

    struct SubPool<phantom T> has key {
        id: UID,
        zbx_reserve:   Balance<ZBX>,
        token_reserve: Balance<T>,
        creator_fee_addr: address,   // fees are routed here — NOT an owner
        fee_bps: u64,                // e.g. 30 = 0.3%
        total_volume: u64,
        // NO owner field — creator only gets fee, nothing else
    }

    // ── Anyone can create a SubPool ──
    public fun create_sub_pool<T>(
        initial_zbx: Coin<ZBX>,
        initial_token: Coin<T>,
        fee_bps: u64,
        ctx: &mut TxContext
    ) {
        let creator = tx_context::sender(ctx);
        transfer::share_object(SubPool<T> {
            id: object::new(ctx),
            zbx_reserve:      coin::into_balance(initial_zbx),
            token_reserve:    coin::into_balance(initial_token),
            creator_fee_addr: creator,
            fee_bps,
            total_volume: 0,
        });
    }

    // ── BUY: ZBX deke token lo (x*y=k AMM) ──
    public fun buy<T>(
        pool: &mut SubPool<T>,
        zbx_in: Coin<ZBX>,
        min_token_out: u64,
        ctx: &mut TxContext
    ): Coin<T> {
        let zbx_amount = coin::value(&zbx_in);
        assert!(zbx_amount > 0, E_ZERO_AMOUNT);

        // Fee cut for creator
        let fee = (zbx_amount * pool.fee_bps) / BPS_DENOM;
        let zbx_net = zbx_amount - fee;

        // x*y=k formula: token_out = token_reserve * zbx_net / (zbx_reserve + zbx_net)
        let zbx_r = balance::value(&pool.zbx_reserve);
        let tok_r = balance::value(&pool.token_reserve);
        let token_out = (tok_r * zbx_net) / (zbx_r + zbx_net);
        assert!(token_out >= min_token_out, E_INSUFFICIENT_OUTPUT);

        // Update reserves
        balance::join(&mut pool.zbx_reserve, coin::into_balance(zbx_in));
        pool.total_volume = pool.total_volume + zbx_amount;

        // Send fee to creator
        let fee_coin = coin::from_balance(
            balance::split(&mut pool.zbx_reserve, fee), ctx
        );
        transfer::public_transfer(fee_coin, pool.creator_fee_addr);

        coin::from_balance(balance::split(&mut pool.token_reserve, token_out), ctx)
    }

    // ── SELL: token deke ZBX lo ──
    public fun sell<T>(
        pool: &mut SubPool<T>,
        token_in: Coin<T>,
        min_zbx_out: u64,
        ctx: &mut TxContext
    ): Coin<ZBX> {
        let tok_amount = coin::value(&token_in);
        assert!(tok_amount > 0, E_ZERO_AMOUNT);

        let tok_r = balance::value(&pool.token_reserve);
        let zbx_r = balance::value(&pool.zbx_reserve);
        let zbx_out_gross = (zbx_r * tok_amount) / (tok_r + tok_amount);
        let fee = (zbx_out_gross * pool.fee_bps) / BPS_DENOM;
        let zbx_out = zbx_out_gross - fee;
        assert!(zbx_out >= min_zbx_out, E_INSUFFICIENT_OUTPUT);

        balance::join(&mut pool.token_reserve, coin::into_balance(token_in));
        pool.total_volume = pool.total_volume + zbx_out_gross;

        let fee_coin = coin::from_balance(
            balance::split(&mut pool.zbx_reserve, fee), ctx
        );
        transfer::public_transfer(fee_coin, pool.creator_fee_addr);

        coin::from_balance(balance::split(&mut pool.zbx_reserve, zbx_out), ctx)
    }

    // ── MANUAL ADD LIQUIDITY — PERMANENTLY DISABLED ──
    public fun add_liquidity<T>(
        _pool: &mut SubPool<T>,
        _zbx: Coin<ZBX>,
        _token: Coin<T>,
        _ctx: &mut TxContext
    ) {
        abort E_MANUAL_LIQUIDITY_DISABLED
    }

    // ── MANUAL REMOVE LIQUIDITY — PERMANENTLY DISABLED ──
    public fun remove_liquidity<T>(
        _pool: &mut SubPool<T>,
        _amount: u64,
        _ctx: &mut TxContext
    ) {
        abort E_REMOVE_LIQUIDITY_DISABLED
    }
}`;

const PAY_ID_CODE = `module zebvix::pay_id {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::table::{Self, Table};
    use sui::transfer;
    use sui::coin::Coin;
    use std::string::{Self, String};

    // ── Global registry — a single shared instance lives on-chain ──
    struct PayIdRegistry has key {
        id: UID,
        // pay_id_name → owner_address  (e.g. "rahul" → 0xABC...)
        name_to_addr: Table<String, address>,
        // owner_address → pay_id_name  (ek address = ek hi ID)
        addr_to_name: Table<address, String>,
    }

    // ── On-chain PayId object — key only (non-transferable, permanent) ──
    struct PayId has key {
        id: UID,
        pay_id: String,        // short ID  e.g. "rahul"
        full_id: String,       // full ID   e.g. "rahul@zbx"
        display_name: String,  // real name e.g. "Rahul Kumar"  ← NEW, required
        owner: address,
        created_epoch: u64,
    }

    // ── Error codes ──
    const E_NAME_EMPTY:         u64 = 1;  // pay_id empty
    const E_NAME_TAKEN:         u64 = 2;  // duplicate pay_id
    const E_ALREADY_REGISTERED: u64 = 3;  // address already has ID
    const E_INVALID_CHARS:      u64 = 4;  // bad chars in pay_id
    const E_PAY_ID_NOT_FOUND:   u64 = 5;  // recipient not found
    const E_DISPLAY_NAME_EMPTY: u64 = 6;  // display_name missing ← NEW

    // ── Init: the registry is created exactly once ──
    fun init(ctx: &mut TxContext) {
        transfer::share_object(PayIdRegistry {
            id: object::new(ctx),
            name_to_addr: table::new(ctx),
            addr_to_name: table::new(ctx),
        });
    }

    // ── Register: BOTH fields are mandatory ──
    // pay_id      = short unique ID   (e.g. b"rahul")        → becomes rahul@zbx
    // display_name = real full name   (e.g. b"Rahul Kumar")  → stored on-chain
    public fun register_pay_id(
        registry: &mut PayIdRegistry,
        pay_id:       vector<u8>,   // e.g. b"rahul"        — unique, alphanumeric
        display_name: vector<u8>,   // e.g. b"Rahul Kumar"  — full name, required
        ctx: &mut TxContext
    ) {
        let sender    = tx_context::sender(ctx);
        let id_str    = string::utf8(pay_id);
        let dname_str = string::utf8(display_name);

        // ── Validations ──
        assert!(string::length(&id_str)    > 0, E_NAME_EMPTY);         // pay_id must not be empty
        assert!(string::length(&dname_str) > 0, E_DISPLAY_NAME_EMPTY); // display_name must not be empty
        // NOTE: display_name has NO uniqueness check — "Rahul Kumar" or any other
        //       name can be reused by different users. Only pay_id is globally unique.
        assert!(!table::contains(&registry.addr_to_name, sender),  E_ALREADY_REGISTERED);
        assert!(!table::contains(&registry.name_to_addr, id_str),  E_NAME_TAKEN); // pay_id unique check

        // ── Build full ID: "rahul" + "@zbx" = "rahul@zbx" ──
        let mut full_id = id_str;
        string::append_utf8(&mut full_id, b"@zbx");

        // ── Register in bidirectional maps ──
        table::add(&mut registry.name_to_addr, id_str,  sender);
        table::add(&mut registry.addr_to_name, sender,  id_str);

        // ── Mint immutable PayId object → sender (permanently bound) ──
        transfer::transfer(PayId {
            id: object::new(ctx),
            pay_id: id_str,
            full_id,
            display_name: dname_str,
            owner: sender,
            created_epoch: tx_context::epoch(ctx),
        }, sender);
    }

    // ── Resolve: look up the wallet address from a pay_id name ──
    public fun resolve_pay_id(
        registry: &PayIdRegistry,
        pay_id: vector<u8>,
    ): address {
        let id_str = string::utf8(pay_id);
        assert!(table::contains(&registry.name_to_addr, id_str), E_PAY_ID_NOT_FOUND);
        *table::borrow(&registry.name_to_addr, id_str)
    }

    // ── Transfer: send a coin/token directly via pay_id ──
    public fun transfer_to_pay_id<T>(
        registry: &PayIdRegistry,
        pay_id: vector<u8>,   // recipient's pay_id, e.g. b"rahul"
        coin: Coin<T>,
        _ctx: &mut TxContext
    ) {
        let recipient = resolve_pay_id(registry, pay_id);
        sui::transfer::public_transfer(coin, recipient);
    }

    // ── View helpers ──
    public fun is_name_available(registry: &PayIdRegistry, pay_id: vector<u8>): bool {
        !table::contains(&registry.name_to_addr, string::utf8(pay_id))
    }
    public fun get_display_name(pay_id_obj: &PayId): &String { &pay_id_obj.display_name }
    public fun get_full_id(pay_id_obj: &PayId): &String      { &pay_id_obj.full_id }
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
          <div className="font-semibold text-violet-300">What is the Fabric Layer?</div>
          <div className="text-muted-foreground">
            Zebvix's programmable layer — where Move modules (smart contracts) execute.
            It uses the Sui MoveVM, so any Sui Move package can be deployed directly.
            The native token <strong className="text-foreground">ZBX</strong> is used for gas; custom
            tokens are issued from Move contracts.
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
              Mint your own custom token alongside ZBX — ERC-20 style. The
              <strong className="text-foreground"> TreasuryCap</strong> holds mint/burn authority.
            </p>
            <div className="grid grid-cols-3 gap-3 text-xs">
              {[
                { k: "Decimals", v: "9 (MIST style)" },
                { k: "Mint", v: "via TreasuryCap" },
                { k: "Transfer", v: "Anyone can transfer" },
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
              On-chain NFT — image URL, name, and description are all stored on-chain.
              <strong className="text-foreground"> MintCap</strong> controls mint authority.
            </p>
            <div className="grid grid-cols-3 gap-3 text-xs">
              {[
                { k: "Storage", v: "On-chain object" },
                { k: "Mint", v: "via MintCap" },
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
              A basic DeFi building block — deposit coins into a vault and withdraw them later.
              The same pattern is used to build lending protocols and liquidity pools.
            </p>
            <CodeBlock code={DEFI_CODE} />
          </Section>

          {/* DAO */}
          <Section icon={Vote} title="DAO Governance" color="border-yellow-500/30 bg-yellow-500/3" badge="on-chain voting">
            <p className="text-sm text-muted-foreground">
              Decentralized voting — create a proposal, let VoteToken holders vote on it, then execute once the deadline passes.
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
              Send tokens to thousands of addresses in a single transaction — minted via TreasuryCap and transferred directly.
            </p>
            <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/20 p-3 text-xs text-cyan-300 mb-2">
              💡 <strong>Tip:</strong> A single transaction can include up to ~500 recipients — split larger lists into batches.
            </div>
            <CodeBlock code={AIRDROP_CODE} />
          </Section>

          {/* Master Pool AMM */}
          <Section icon={ArrowLeftRight} title="Master Pool + Sub Pool AMM — Permissionless DEX" color="border-cyan-500/30 bg-cyan-500/3" badge="x × y = k">
            {/* Architecture diagram */}
            <div className="rounded-lg bg-muted/10 border border-border p-4 mb-3">
              <div className="text-xs font-semibold text-muted-foreground mb-3 text-center">Architecture</div>
              <div className="flex flex-col items-center gap-2">
                <div className="rounded-xl border-2 border-cyan-500/50 bg-cyan-500/10 px-6 py-3 text-center">
                  <div className="text-xs text-cyan-400 font-bold">MasterPool</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">ZBX native · No admin key · Protocol-owned</div>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground text-xs">
                  <div className="w-px h-4 bg-border mx-auto" />
                </div>
                <div className="flex gap-3 flex-wrap justify-center">
                  {["SubPool (ZBX/MYT)", "SubPool (ZBX/NFT)", "SubPool (ZBX/USDC)"].map((sp, i) => (
                    <div key={i} className="rounded-lg border border-border bg-muted/10 px-3 py-2 text-center">
                      <div className="text-[10px] font-mono text-foreground">{sp}</div>
                      <div className="text-[9px] text-muted-foreground mt-0.5">creator fee only</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Rules grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs mb-3">
              {[
                { k: "AMM Formula", v: "x × y = k" },
                { k: "MasterPool Governor", v: "❌ None" },
                { k: "SubPool Owner", v: "❌ None" },
                { k: "Creator role", v: "Fee recipient only" },
                { k: "Manual Add/Remove", v: "❌ Permanently off" },
                { k: "Default fee", v: "0.3% (30 bps)" },
              ].map(r => (
                <div key={r.k} className="rounded-lg bg-muted/20 p-3 border border-border/50">
                  <div className="text-muted-foreground">{r.k}</div>
                  <div className="font-mono font-semibold text-foreground mt-0.5">{r.v}</div>
                </div>
              ))}
            </div>

            {/* Key rules box */}
            <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3 mb-3 space-y-1 text-xs">
              <div className="text-xs font-semibold text-red-400 mb-1">Anti Rug Pull — Hard Rules:</div>
              <div className="flex gap-2 text-muted-foreground"><span className="text-red-400">•</span><span><code className="font-mono">add_liquidity()</code> → <strong className="text-red-300">abort E_MANUAL_LIQUIDITY_DISABLED</strong> — no manual deposits.</span></div>
              <div className="flex gap-2 text-muted-foreground"><span className="text-red-400">•</span><span><code className="font-mono">remove_liquidity()</code> → <strong className="text-red-300">abort E_REMOVE_LIQUIDITY_DISABLED</strong> — pool can never be drained.</span></div>
              <div className="flex gap-2 text-muted-foreground"><span className="text-red-400">•</span><span>The SubPool struct has no <code className="font-mono">owner</code> field at all — a rug pull is structurally impossible.</span></div>
              <div className="flex gap-2 text-muted-foreground"><span className="text-cyan-400">→</span><span>Liquidity only adjusts via buy/sell trades — a pure AMM.</span></div>
            </div>

            <CodeBlock code={MASTER_POOL_CODE} />
          </Section>

          {/* ZBX Pay ID */}
          <Section icon={AtSign} title="ZBX Pay ID — UPI-style Human Readable Address" color="border-violet-500/30 bg-violet-500/3" badge="name@zbx">

            {/* Complete flow card */}
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/8 p-4 mb-4">
              <div className="text-xs font-semibold text-violet-300 mb-3">Complete Registration Flow:</div>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-violet-500/30 text-violet-300 text-xs flex items-center justify-center font-bold shrink-0">1</span>
                  <div className="text-sm">
                    <span className="text-foreground font-medium">Pay ID</span>
                    <span className="text-muted-foreground"> — unique short identifier (alphanumeric)</span>
                    <code className="block mt-1 text-xs bg-muted/30 px-3 py-1.5 rounded font-mono text-violet-300">rahul</code>
                    <span className="text-xs text-muted-foreground">→ automatically becomes <code className="font-mono text-violet-400">rahul@zbx</code></span>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-violet-500/30 text-violet-300 text-xs flex items-center justify-center font-bold shrink-0">2</span>
                  <div className="text-sm">
                    <span className="text-foreground font-medium">Display Name</span>
                    <span className="text-muted-foreground"> — real full name (mandatory, stored on-chain)</span>
                    <code className="block mt-1 text-xs bg-muted/30 px-3 py-1.5 rounded font-mono text-green-300">Rahul Kumar</code>
                    <span className="text-xs text-red-400">← without this the ID will not register — abort E_DISPLAY_NAME_EMPTY</span>
                  </div>
                </div>
                <div className="rounded-lg bg-muted/20 border border-border px-4 py-3 mt-2">
                  <div className="text-xs text-muted-foreground mb-1">On-chain result:</div>
                  <div className="flex flex-wrap gap-3 text-xs font-mono">
                    <span><span className="text-muted-foreground">pay_id:</span> <span className="text-violet-400">rahul@zbx</span></span>
                    <span><span className="text-muted-foreground">display_name:</span> <span className="text-green-400">Rahul Kumar</span></span>
                    <span><span className="text-muted-foreground">owner:</span> <span className="text-orange-400">0xABC...123</span></span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs mb-3">
              {[
                { k: "Pay ID format", v: "name@zbx", note: "✅ Globally unique" },
                { k: "Display Name", v: "Mandatory", note: "Not unique — duplicates allowed" },
                { k: "Per address", v: "Only 1 ID", note: "" },
                { k: "Delete/Edit", v: "❌ Never", note: "" },
                { k: "Transfer via ID", v: "ZBX + Tokens", note: "" },
                { k: "ID Uniqueness", v: "Pay ID only", note: "Display Name is unconstrained" },
              ].map(r => (
                <div key={r.k} className="rounded-lg bg-muted/20 p-3 border border-border/50">
                  <div className="text-muted-foreground">{r.k}</div>
                  <div className="font-mono font-semibold text-foreground mt-0.5">{r.v}</div>
                  {r.note && <div className="text-[10px] text-muted-foreground mt-0.5">{r.note}</div>}
                </div>
              ))}
            </div>

            {/* Unique vs Not unique clarification */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
                <div className="font-semibold text-primary mb-1">✅ Pay ID — UNIQUE</div>
                <div className="text-muted-foreground">Only one address can ever own <code className="font-mono text-foreground">rahul@zbx</code>, globally. No duplicates allowed.</div>
              </div>
              <div className="rounded-lg border border-muted bg-muted/10 p-3 text-xs">
                <div className="font-semibold text-muted-foreground mb-1">Display Name — NOT unique</div>
                <div className="text-muted-foreground">Two different users can both register the display name <code className="font-mono text-foreground">Rahul Kumar</code> — there is no uniqueness check on the display name. Only the Pay ID is checked.</div>
              </div>
            </div>

            {/* Example IDs with full names */}
            <div className="rounded-lg bg-violet-500/10 border border-violet-500/20 p-3 mb-3">
              <div className="text-xs font-semibold text-violet-300 mb-2">Example Registered IDs:</div>
              <div className="space-y-2">
                {[
                  { id: "rahul@zbx",        name: "Rahul Kumar",       unique: true  },
                  { id: "rahul_k@zbx",      name: "Rahul Kumar",       unique: true  },
                  { id: "zebvix_tech@zbx",  name: "Zebvix Technologies", unique: true },
                  { id: "validator1@zbx",   name: "Rahul Kumar",       unique: true  },
                ].map(ex => (
                  <div key={ex.id} className="flex items-center gap-3 text-xs">
                    <code className="bg-violet-500/20 text-violet-200 px-2.5 py-1 rounded-full font-mono shrink-0">{ex.id}</code>
                    <span className="text-muted-foreground">→</span>
                    <span className="text-green-300 font-medium">{ex.name}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 pt-2 border-t border-violet-500/20 text-[10px] text-muted-foreground">
                💡 Three of the entries above share the display name <code className="font-mono">"Rahul Kumar"</code> — that is allowed. But each Pay ID (<code className="font-mono">rahul@zbx</code>, <code className="font-mono">rahul_k@zbx</code>, <code className="font-mono">validator1@zbx</code>) is distinct — those are the values that must be globally unique.
              </div>
            </div>

            {/* Rules box */}
            <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3 mb-3 space-y-1 text-xs">
              <div className="text-xs font-semibold text-red-400 mb-1">Hard Rules (chain level enforce):</div>
              <div className="flex gap-2 text-muted-foreground"><span className="text-red-400">•</span><span><strong className="text-foreground">Pay ID empty</strong> = abort E_NAME_EMPTY</span></div>
              <div className="flex gap-2 text-muted-foreground"><span className="text-red-400">•</span><span><strong className="text-foreground">Display Name empty</strong> = abort E_DISPLAY_NAME_EMPTY — display name is mandatory.</span></div>
              <div className="flex gap-2 text-muted-foreground"><span className="text-red-400">•</span><span>One address can hold only one Pay ID — a second attempt aborts with E_ALREADY_REGISTERED.</span></div>
              <div className="flex gap-2 text-muted-foreground"><span className="text-red-400">•</span><span>If someone else already owns the same pay_id, the call aborts with E_NAME_TAKEN — Pay IDs are globally unique.</span></div>
              <div className="flex gap-2 text-muted-foreground"><span className="text-red-400">•</span><span>PayId: <code className="font-mono">has key</code> only — transfer/delete permanently blocked at VM level</span></div>
            </div>

            <CodeBlock code={PAY_ID_CODE} />

            {/* JS usage */}
            <div className="mt-3">
              <p className="text-xs text-muted-foreground mb-2 font-semibold">Use it from the SDK (TypeScript):</p>
              <CodeBlock code={`// ── Step 1: Register Pay ID (both fields are mandatory) ──
const txb = new TransactionBlock();
txb.moveCall({
  target: '0xPKG::pay_id::register_pay_id',
  arguments: [
    txb.object(REGISTRY_ID),            // shared PayIdRegistry
    txb.pure(Array.from(new TextEncoder().encode('rahul'))),        // pay_id
    txb.pure(Array.from(new TextEncoder().encode('Rahul Kumar'))),  // display_name ← required
  ],
});
// Result: rahul@zbx registered, "Rahul Kumar" stored on-chain permanently

// ── Step 2: Send ZBX to someone's Pay ID ──
const sendTxb = new TransactionBlock();
sendTxb.moveCall({
  target: '0xPKG::pay_id::transfer_to_pay_id',
  typeArguments: ['0x2::zbx::ZBX'],
  arguments: [
    sendTxb.object(REGISTRY_ID),
    sendTxb.pure(Array.from(new TextEncoder().encode('rahul'))), // recipient pay_id
    sendTxb.object(coinObjectId),
  ],
});

// ── Step 3: Lookup — is this name available? ──
// devInspect: is_name_available(registry, b"rahul")
// → true if free, false if taken`} lang="typescript" />
            </div>
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
              JavaScript/TypeScript SDK — same pattern as the Sui SDK; just change the RPC URL.
            </p>
            <CodeBlock code={WEB3_RPC} lang="typescript" />
          </Section>

          {/* Events & Objects */}
          <Section icon={Zap} title="Events & Object Queries" color="border-orange-500/30 bg-orange-500/3" badge="subscribeEvent">
            <p className="text-sm text-muted-foreground">
              Subscribe to real-time events — NFT mints, token transfers, DAO votes, and more.
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
                { method: "zbx_getBalance", desc: "ZBX balance for an address" },
                { method: "zbx_getOwnedObjects", desc: "All objects owned by an address (NFTs, coins, etc.)" },
                { method: "zbx_getObject", desc: "Full details for a single object" },
                { method: "zbx_executeTransactionBlock", desc: "Submit a signed transaction" },
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
