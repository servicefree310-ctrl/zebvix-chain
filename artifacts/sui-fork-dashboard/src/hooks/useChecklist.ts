import { useState, useEffect } from "react";

export type ChecklistItem = {
  id: string;
  category: string;
  text: string;
  /** Optional pointer at the file / RPC / CLI command this item touches. */
  ref?: string;
  completed: boolean;
};

export type ChecklistCategory = {
  name: string;
  description: string;
};

/**
 * Categories in the order operators should work through them. The hook
 * preserves this order in `categoriesOrdered` (the raw `items` array does too,
 * but the grouping `{}.entries` lookup needs an explicit order array).
 */
export const categoriesOrdered: ChecklistCategory[] = [
  {
    name: "1. Repo & Build",
    description: "Clone the Zebvix monorepo and produce a working zebvix-node binary on the target host.",
  },
  {
    name: "2. Pre-flight Configuration",
    description: "Decide chain_id, founder rotation strategy, and whether to enable the ZVM feature flag BEFORE genesis.",
  },
  {
    name: "3. Genesis",
    description: "Pick allocations and run `init` on every host. genesis.json is a small metadata blob; the genesis validator slot is seeded deterministically from a compiled-in const, and tokenomics constants are NOT in genesis (they are in the binary).",
  },
  {
    name: "4. Validator & Key Management",
    description: "Generate fresh secp256k1 keys, back them up offline, and decide each validator's seating path — governor-added (no self-bond) and/or staking-module create (≥ 100 ZBX self-bond). Production = both.",
  },
  {
    name: "5. Network / Servers",
    description: "Provision validator hosts, open libp2p + JSON-RPC ports, pass bootstrap peers as repeatable --peer flags on the start command (node.json holds only the validator key path).",
  },
  {
    name: "6. Security Hardening",
    description: "Cold-storage keys, isolate validator P2P, lock down governor-only RPCs, accept known double-sign rules.",
  },
  {
    name: "7. Test on a Separate chain_id",
    description: "Bring up a parallel chain (e.g. chain_id 7879) and exercise every Phase A → D feature end-to-end before mainnet.",
  },
  {
    name: "8. Operational Wiring",
    description: "Systemd unit, log rotation, RocksDB backups, simple cron-based health monitors.",
  },
  {
    name: "9. Mainnet Cutover",
    description: "Final genesis sign-off, public docs, bridge registry pre-seeded, dashboard pointed at production.",
  },
  {
    name: "10. Trust-Model Sign-off (must read)",
    description: "Operators MUST acknowledge the documented limitations of the current code before going live.",
  },
];

const defaultItems: ChecklistItem[] = [
  // ─────── 1. Repo & Build ───────
  {
    id: "build-rust",
    category: "1. Repo & Build",
    text: "Install Rust toolchain (stable, ≥ 1.75) via rustup",
    ref: "rustup default stable && rustup target add x86_64-unknown-linux-gnu",
    completed: false,
  },
  {
    id: "build-deps",
    category: "1. Repo & Build",
    text: "Install system build deps: clang, cmake, pkg-config, libssl-dev, build-essential",
    ref: "apt-get install -y clang cmake pkg-config libssl-dev build-essential",
    completed: false,
  },
  {
    id: "build-clone",
    category: "1. Repo & Build",
    text: "Clone the Zebvix monorepo into /home/zebvix-chain/ on the target host",
    ref: "git clone … /home/zebvix-chain && cd /home/zebvix-chain",
    completed: false,
  },
  {
    id: "build-baseline",
    category: "1. Repo & Build",
    text: "Build the baseline (non-ZVM) zebvix-node binary in release mode and confirm `zebvix-node --version`",
    ref: "cargo build --release  →  ./target/release/zebvix-node --version",
    completed: false,
  },
  {
    id: "build-evm",
    category: "1. Repo & Build",
    text: "(Optional) Build with ZVM enabled if Solidity contracts are part of launch scope",
    ref: "cargo build --release --features zvm  (Phase C.2 — see Smart Contracts page caveats)",
    completed: false,
  },

  // ─────── 2. Pre-flight Configuration ───────
  {
    id: "pre-chainid",
    category: "2. Pre-flight Configuration",
    text: "Confirm CHAIN_ID = 7878 for mainnet (numeric u64, not a string). Pick a different value (e.g. 7879) for any parallel test chain — DIFFERENT chain_id is what isolates the two networks at the gossipsub topic level.",
    ref: "zebvix-chain/src/tokenomics.rs:36  pub const CHAIN_ID: u64 = 7878;",
    completed: false,
  },
  {
    id: "pre-founder-rotation",
    category: "2. Pre-flight Configuration",
    text: "Decide rotation strategy for the TWO founder roles (they are separate). (a) The seeded GENESIS VALIDATOR slot is derived from the COMPILED-IN const `tokenomics::FOUNDER_PUBKEY_HEX` (no env-var override exists in the source) — to change it you must edit the const + rebuild on every node, OR after launch issue TxKind::ValidatorRemove + ValidatorAdd. (b) The GOVERNOR role (the only address authorised to mutate the consensus validator set or rotate the governor itself) defaults to the founder address but can be rotated via `zebvix-node governor-change --new-governor 0x... --signer-key key.json`, capped by MAX_GOVERNOR_CHANGES = 3. NOTE: runtime params (e.g. amm_fee_bps) are NOT governor-controlled — they go through the Phase D ParamChange proposal flow (community governance).",
    ref: "tokenomics.rs:103 FOUNDER_PUBKEY_HEX  +  tokenomics.rs:122 MAX_GOVERNOR_CHANGES = 3",
    completed: false,
  },
  {
    id: "pre-evm-flag",
    category: "2. Pre-flight Configuration",
    text: "Decide if --features zvm is part of the launch binary. The flag is sticky — every validator and full-node MUST run the same feature set, otherwise blocks containing ZVM tx will fail on non-ZVM nodes.",
    ref: "Phase C.2 — gated by `cargo build --release --features zvm`",
    completed: false,
  },
  {
    id: "pre-tokenomics-review",
    category: "2. Pre-flight Configuration",
    text: "Review tokenomics constants and accept them as-is (they are compiled-in, NOT in genesis): TOTAL_SUPPLY = 150M ZBX, FOUNDER_PREMINE = 9.99M (6.66%), INITIAL_REWARD = 3 ZBX/block, HALVING_INTERVAL = 25M blocks, BLOCK_TIME = 5s, MIN_GAS_UNITS = 21 000, MIN_GAS_PRICE = 50 gwei.",
    ref: "zebvix-chain/src/tokenomics.rs",
    completed: false,
  },

  // ─────── 3. Genesis ───────
  {
    id: "gen-schema",
    category: "3. Genesis",
    text: "Understand the genesis model. genesis.json is a METADATA blob (struct GenesisFile: chain_id, chain_name \"Zebvix\", token_symbol \"ZBX\", decimals 18, max_supply_wei, block_time_secs, validator_address (singular — the address whose key was passed as --validator-key), alloc as [(address, amount_wei)], timestamp). It does NOT carry a multi-validator set. The genesis VALIDATOR SLOT is seeded DETERMINISTICALLY into RocksDB during `init` from the compiled-in const `tokenomics::FOUNDER_PUBKEY_HEX` — every node built from the same binary starts with the same {founder} validator set without needing to share genesis.json byte-for-byte.",
    ref: "main.rs:765 struct GenesisFile  +  main.rs:898 Phase B.3.1.5 deterministic founder seed",
    completed: false,
  },
  {
    id: "gen-pool-seed",
    category: "3. Genesis",
    text: "AMM pool seed is a SEPARATE post-init admin step (NOT part of genesis.json): `zebvix-node admin-pool-genesis --home /root/.zebvix` writes GENESIS_POOL_ZBX_WEI = 20M ZBX and GENESIS_POOL_ZUSD_LOAN = 10M zUSD as a borrowed liquidity loan repaid from swap fees first; admin payout begins only after the loan reaches zero.",
    ref: "main.rs:1289 cmd_admin_pool_genesis  +  tokenomics.rs:214/220 GENESIS_POOL_*",
    completed: false,
  },
  {
    id: "gen-init",
    category: "3. Genesis",
    text: "On every validator host run: `zebvix-node init --home /root/.zebvix --validator-key /root/.zebvix/key.json [--alloc addr:amount_zbx ...] [--no-default-premine]`. Behaviour: if neither --alloc nor --no-default-premine is given, FOUNDER_PREMINE_WEI (9.99M ZBX = 6.66% of max supply) is auto-credited to the validator_addr derived from --validator-key (NOT to the founder address). Pass --alloc explicitly to credit named addresses instead, or --no-default-premine to skip the premine entirely (admin then earns only via block rewards + swap fees).",
    ref: "main.rs:861 cmd_init  +  cmd: zebvix-node init --home … --validator-key …",
    completed: false,
  },
  {
    id: "gen-distribute",
    category: "3. Genesis",
    text: "Coordinate genesis across all founding validators. Two equivalent paths: (a) each validator runs `init` independently with the SAME --alloc set + the SAME compiled binary (deterministic founder seed guarantees identical initial validator set); OR (b) one canonical machine runs `init` and ships the entire /root/.zebvix directory (genesis.json + RocksDB data dir + node.json) to every other validator. Mismatched --alloc lists between nodes will diverge at block 0.",
    ref: "/root/.zebvix/{genesis.json, data/, node.json}",
    completed: false,
  },

  // ─────── 4. Validator & Key Management ───────
  {
    id: "val-keygen",
    category: "4. Validator & Key Management",
    text: "Generate a fresh secp256k1 keypair on each validator host (DO NOT share keys between validators — same key on two hosts at once is the canonical double-sign trap). The CLI writes a small JSON keyfile holding the private/public bytes.",
    ref: "zebvix-node keygen --out /root/.zebvix/key.json   (Cmd::Keygen { out: Option<PathBuf> })",
    completed: false,
  },
  {
    id: "val-derive",
    category: "4. Validator & Key Management",
    text: "Compute each validator's 20-byte address (= keccak256(uncompressed_pubkey[1..])[12..]) and 33-byte compressed pubkey. The same key works in MetaMask/MEW (Phase B.11 = ETH-compatible). Note: only the founder validator slot is auto-seeded at genesis from the compiled-in const FOUNDER_PUBKEY_HEX — every OTHER validator must be added post-genesis (next item).",
    ref: "zebvix-chain/src/crypto.rs::address_from_pubkey",
    completed: false,
  },
  {
    id: "val-add-strategy",
    category: "4. Validator & Key Management",
    text: "Understand the TWO-TIER validator model — they are NOT alternative paths, they are two different things. (a) The CONSENSUS PROPOSER SET (the addresses that produce blocks, read by consensus.rs as `state.validators()`) is mutated ONLY by governor-signed TxKind::ValidatorAdd / ValidatorEdit / ValidatorRemove (CLI: `zebvix-node validator-add --pubkey <hex33> --power <u64> --signer-key <governor_key.json>`). No self-bond involved. (b) The STAKING-MODULE VALIDATOR RECORD (delegations, commission, self-bond, reward distribution) is created by any user via TxKind::Staking(StakeOp::CreateValidator) (CLI: `zebvix-node validator-create --pubkey <hex33> --commission-bps <0..10000> --self-bond <amount> --signer-key key.json`), requiring self_bond ≥ MIN_SELF_BOND_WEI = 100 ZBX. CreateValidator does NOT seat a block-producer. The Phase B.4 production seating flow is BOTH: user submits CreateValidator first (locks self-bond + opens to delegations), THEN governor submits ValidatorAdd to grant proposer rights.",
    ref: "state.rs:727 CreateValidator (staking only)  +  main.rs:1403 ValidatorAdd (consensus set)  +  consensus.rs uses state.validators()",
    completed: false,
  },
  {
    id: "val-cold-backup",
    category: "4. Validator & Key Management",
    text: "Back up every validator's key.json offline (cold storage / HSM / air-gapped USB). Loss of key.json = loss of validator slot until governor re-seats.",
    ref: "/root/.zebvix/key.json",
    completed: false,
  },

  // ─────── 5. Network / Servers ───────
  {
    id: "net-hosts",
    category: "5. Network / Servers",
    text: "Provision validator hosts (recommended: 8+ cores, 32GB RAM, 1TB NVMe; RocksDB is the dominant disk consumer)",
    ref: "",
    completed: false,
  },
  {
    id: "net-ports-libp2p",
    category: "5. Network / Servers",
    text: "Open inbound TCP 30333 on every validator (libp2p Noise+Yamux). This is the P2P port — gossipsub, vote diffusion, and request_response sync all flow through it.",
    ref: "zebvix-chain/src/p2p.rs  default listen /ip4/0.0.0.0/tcp/30333",
    completed: false,
  },
  {
    id: "net-ports-rpc",
    category: "5. Network / Servers",
    text: "Open inbound TCP 8545 only behind a reverse-proxy (nginx/caddy) with rate limiting. JSON-RPC carries BOTH zbx_* and eth_* methods; some are governor-only and some can drain rewards if abused.",
    ref: "zebvix-chain/src/rpc.rs  +  zebvix-chain/src/evm_rpc.rs",
    completed: false,
  },
  {
    id: "net-no-mdns",
    category: "5. Network / Servers",
    text: "Disable mDNS LAN discovery in production (it is on by default for dev convenience). Validators should only learn each other through explicit --peer multiaddrs.",
    ref: "zebvix-node start --no-mdns   (Cmd::Start { no_mdns: bool })",
    completed: false,
  },
  {
    id: "net-seeds",
    category: "5. Network / Servers",
    text: "Configure bootstrap peers via REPEATABLE `--peer` flag on `zebvix-node start` (each value is a libp2p multiaddr like /ip4/1.2.3.4/tcp/30333/p2p/12D3KooW...). NOTE: node.json is NOT a peer list — it only stores `validator_key_file`. Persist the `--peer` flags via your systemd unit's ExecStart line. CAVEAT: peer-id rotates on every restart today — see the trust-model section below.",
    ref: "main.rs:97 #[arg(long = \"peer\")] peers: Vec<String>",
    completed: false,
  },
  {
    id: "net-rpc-smoke",
    category: "5. Network / Servers",
    text: "Smoke-test the JSON-RPC. Use `eth_chainId` (returns \"0x1ec6\" = 7878 hex) or `net_version` (returns \"7878\"): `curl -s http://<host>:8545 -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"method\":\"eth_chainId\",\"id\":1}'`. For a richer payload use `zbx_chainInfo` which returns chain_id + chain_name + token_symbol + decimals.",
    ref: "rpc.rs:119 \"eth_chainId\"  +  rpc.rs:120 \"net_version\"  +  rpc.rs:926 \"zbx_chainInfo\"",
    completed: false,
  },

  // ─────── 6. Security Hardening ───────
  {
    id: "sec-keys-cold",
    category: "6. Security Hardening",
    text: "Validator key.json files live ONLY on the validator host plus offline backup. Never copy them to laptops, CI, or cloud buckets.",
    ref: "",
    completed: false,
  },
  {
    id: "sec-private-p2p",
    category: "6. Security Hardening",
    text: "Validator P2P (TCP 30333) ideally behind VPN / private subnet between validators; only public full-nodes terminate connections from the open internet.",
    ref: "",
    completed: false,
  },
  {
    id: "sec-rpc-auth",
    category: "6. Security Hardening",
    text: "Restrict governor-sensitive RPCs (anything routed via TxKind::ValidatorAdd / ValidatorRemove / ValidatorEdit / GovernorChange) to an internal network or a token-authed reverse proxy. The chain refuses these tx unless signed by the current governor — but you still don't want them spammed onto the mempool.",
    ref: "zebvix-chain/src/state.rs::apply_tx governor checks",
    completed: false,
  },
  {
    id: "sec-rate-limit",
    category: "6. Security Hardening",
    text: "Rate-limit JSON-RPC at the reverse-proxy layer (req/sec/IP). The chain itself has no per-method quota.",
    ref: "",
    completed: false,
  },
  {
    id: "sec-double-sign",
    category: "6. Security Hardening",
    text: "Operational rule: each key.json runs on exactly ONE host at a time. Hot-spare must use a DIFFERENT key. Phase B.2 vote pool detects identical (height, round, vote_type) with different content as DoubleSign — slashing primitive is in staking.rs (5%) but auto-enforcement is on the planned list.",
    ref: "zebvix-chain/src/vote.rs::AddVoteResult::DoubleSign",
    completed: false,
  },

  // ─────── 7. Test on a Separate chain_id ───────
  {
    id: "test-fresh-chain",
    category: "7. Test on a Separate chain_id",
    text: "Bring up a parallel test chain by overriding CHAIN_ID at build/genesis time (e.g. 7879). Identical binary, fresh data dir. This isolates the test traffic from mainnet at the gossip-topic level.",
    ref: "zebvix/<CHAIN_ID>/{blocks,txs,heartbeat,votes}/v1",
    completed: false,
  },
  {
    id: "test-staking-cycle",
    category: "7. Test on a Separate chain_id",
    text: "Run a full staking cycle dry: StakeOp::CreateValidator → ValidatorAdd → Stake delegation → Unstake → wait UNBONDING_EPOCHS (7 epochs ≈ 7 days at 17 280 blocks/epoch) → confirm matured payout",
    ref: "zebvix-chain/src/staking.rs  EPOCH_BLOCKS=17280  UNBONDING_EPOCHS=7",
    completed: false,
  },
  {
    id: "test-governance",
    category: "7. Test on a Separate chain_id",
    text: "Submit a Phase D ParamChange proposal, vote it through the 14-day Testing + 76-day Voting phases (or shrink the constants on the test build), confirm auto-activation flips the flag at the activation block. Use zbx_proposalShadowExec to preview before activation.",
    ref: "zebvix-chain/src/proposal.rs",
    completed: false,
  },
  {
    id: "test-bridge",
    category: "7. Test on a Separate chain_id",
    text: "Exercise Phase B.12 bridge: admin BridgeRegisterNetwork + BridgeRegisterAsset, user BridgeOut, admin BridgeIn with a source_tx_hash, then re-submit the same source_tx_hash and confirm replay-rejection",
    ref: "zebvix-chain/src/bridge.rs  +  CLI: bridge-register-network / bridge-out / bridge-in",
    completed: false,
  },
  {
    id: "test-evm",
    category: "7. Test on a Separate chain_id",
    text: "(If --features zvm is on) Deploy a Solidity 0.8.24 contract via eth_sendRawTransaction, call a state-mutating method, verify by RE-READING state (e.g. balanceOf). Phase C.2.1: `eth_getTransactionByHash` + `eth_getTransactionReceipt` are wired for NATIVE ZBX tx (resolved via the recent-tx ring buffer's hash side-index, synthetic Ethereum-shape JSON, status=0x1 by construction). ZVM (Solidity) tx are NOT yet pushed into the ring buffer — for ZVM tx these RPCs return null (C.3 work). `eth_getLogs` returns [] for ZVM tx because store_logs has zero callers from the ZVM path. Verify Solidity-contract correctness by re-reading state — do not depend on getLogs or per-execution receipts until C.3 wires the producers + ZVM-tx ring-buffer indexing.",
    ref: "zvm_rpc.rs eth_getTransactionByHash + eth_getTransactionReceipt (C.2.1, native ring buffer)  +  state.rs:find_tx_by_hash + META_RTX_HASH_PREFIX  +  evm_rpc.rs eth_getLogs  +  evm_state.rs store_logs (no ZVM callers)",
    completed: false,
  },

  // ─────── 8. Operational Wiring ───────
  {
    id: "ops-systemd",
    category: "8. Operational Wiring",
    text: "Install a systemd unit for `zebvix-node start` with Restart=on-failure and a high RestartSec. Persist all runtime flags here (the binary takes them as CLI args, not a config file). Wrap inside `screen`/`tmux` only for ad-hoc debugging — production = systemd.",
    ref: "ExecStart=/usr/local/bin/zebvix-node start --home /root/.zebvix --rpc 0.0.0.0:8545 --p2p-port 30333 --no-mdns --peer /ip4/<seed1>/tcp/30333/p2p/<peer1> --peer /ip4/<seed2>/tcp/30333/p2p/<peer2>",
    completed: false,
  },
  {
    id: "ops-logs",
    category: "8. Operational Wiring",
    text: "Configure log rotation (logrotate / journald SystemMaxUse) — RocksDB compaction logs alone can fill a small disk in days",
    ref: "/var/log/journal/  +  /etc/logrotate.d/",
    completed: false,
  },
  {
    id: "ops-rocksdb-backup",
    category: "8. Operational Wiring",
    text: "Schedule periodic offline backup of /root/.zebvix/data (the RocksDB directory created by `init` via home.join(\"data\")). Column families actually opened by State::open() today: \"accounts\", \"blocks\", \"meta\" — that is the complete on-disk set in both the base build AND the --features zvm build. NOTE: evm_state.rs defines a helper evm_column_families() that would add \"evm\" and \"evm_logs\", but it is NOT called by State::open() (only used by an in-crate test helper), so those CFs do not exist on disk in production today. Use the RocksDB checkpoint API for a consistent snapshot, or stop the node before a plain rsync.",
    ref: "main.rs:866 home.join(\"data\")  +  state.rs:183-186 CF descriptor list  +  evm_state.rs:88 evm_column_families (not wired)",
    completed: false,
  },
  {
    id: "ops-monitor-supply",
    category: "8. Operational Wiring",
    text: "Cron a 60-second poll of zbx_supply, zbx_voteStats (per-validator vote rate), and zbx_recentBridgeOutEvents fill (4096-event ring) — alert if vote rate per validator drops or the ring crosses ~3000 (oracle backlog)",
    ref: "RPC: zbx_supply / zbx_voteStats / zbx_recentBridgeOutEvents",
    completed: false,
  },
  {
    id: "ops-bridge-oracle",
    category: "8. Operational Wiring",
    text: "(Bridge ops) Stand up the off-chain oracle service (operator-supplied — no reference oracle in repo) that polls zbx_recentBridgeOutEvents, mints wrapped tokens on the foreign chain, watches the foreign vault, and submits BridgeIn { source_tx_hash } back to Zebvix",
    ref: "Cross-Chain Bridge page — oracle pseudocode",
    completed: false,
  },

  // ─────── 9. Mainnet Cutover ───────
  {
    id: "main-final-genesis",
    category: "9. Mainnet Cutover",
    text: "Final genesis sign-off: every validator runs the SAME compiled binary (this is what guarantees the deterministic founder validator slot matches), and every validator's `init` uses the SAME --alloc list (or all use --no-default-premine). Note: genesis.json itself will NOT be byte-identical across nodes because it embeds the local `validator_address` and a current timestamp — what must match is the seeded validator set + the alloc map, not the JSON bytes. The AMM pool seed is a SEPARATE post-init step — schedule `admin-pool-genesis` after the chain is producing blocks.",
    ref: "main.rs:919 GenesisFile { validator_address, timestamp, … }",
    completed: false,
  },
  {
    id: "main-rotate-governor",
    category: "9. Mainnet Cutover",
    text: "Submit the FIRST post-genesis tx: rotate the GOVERNOR role to a fresh production key with `zebvix-node governor-change --new-governor 0x<prod_addr> --signer-key <current_governor_key.json>`. The default initial governor is the founder address, so this first call must be signed by the founder key. After this, only the production governor key can mutate the validator set / register validators / rotate again. Capped at MAX_GOVERNOR_CHANGES = 3 — plan rotations carefully.",
    ref: "main.rs:2400 cmd_governor_change  +  TxKind::GovernorChange  +  MAX_GOVERNOR_CHANGES = 3",
    completed: false,
  },
  {
    id: "main-bridge-preregister",
    category: "9. Mainnet Cutover",
    text: "Pre-register the bridge networks (BSC, ETH, …) and assets (wZBX, zUSD-BEP20, …) BEFORE opening BridgeOut to users, so the first user-facing bridge tx isn't blocked by a missing registry entry",
    ref: "BridgeOp::RegisterNetwork  +  RegisterAsset",
    completed: false,
  },
  {
    id: "main-public-docs",
    category: "9. Mainnet Cutover",
    text: "Publish the public RPC URL, chain_id (7878), ZVM JSON-RPC endpoint, MetaMask add-network instructions, and explorer URL. MetaMask: Network Name = Zebvix, RPC = https://…, Chain ID = 7878, Symbol = ZBX, Decimals = 18.",
    ref: "",
    completed: false,
  },
  {
    id: "main-dashboard-prod",
    category: "9. Mainnet Cutover",
    text: "Point this dashboard's RPC base URL at the production endpoint (currently default points at the dev VPS). Live Chain Status, Tokenomics, ZVM Explorer, Bridge, Pool Explorer, and Mission Control will then reflect mainnet.",
    ref: "artifacts/sui-fork-dashboard/.env  VITE_RPC_URL",
    completed: false,
  },

  // ─────── 10. Trust-Model Sign-off ───────
  {
    id: "trust-evm-partial",
    category: "10. Trust-Model Sign-off (must read)",
    text: "ACCEPT: ZVM (Phase C.2 + C.2.1) is PARTIAL — gated behind --features zvm. C.2.1 wired eth_getTransactionByHash + eth_getTransactionReceipt for NATIVE ZBX tx (synthetic from recent-tx ring buffer), but ZVM (Solidity) tx are NOT yet ring-indexed so those RPCs return null for ZVM tx. eth_getLogs returns [] for ZVM tx because store_logs has zero callers from the ZVM path (C.3 work). Custom Zebvix precompiles 0x80–0x83 return preview values but do NOT commit native side-effects on eth_sendRawTransaction; EIP-2929/3529 warm/cold gas not modelled. Production Solidity flows MUST verify by re-reading state, and any feature requiring committed bridge/swap/multisig from inside Solidity must wait for Phase C.3.",
    ref: "Smart Contracts (ZVM) page — full caveat list",
    completed: false,
  },
  {
    id: "trust-bridge-oracle",
    category: "10. Trust-Model Sign-off (must read)",
    text: "ACCEPT: Phase B.12 bridge is a single-trusted-oracle MVP. Admin = oracle = single drain vector for inbound BridgeIn. There is no on-chain proof of the foreign deposit — only 32-byte source_tx_hash replay protection. Multisig oracle and SPV proof are tracked in the planned-hardening list.",
    ref: "Cross-Chain Bridge page — trust callout",
    completed: false,
  },
  {
    id: "trust-slashing",
    category: "10. Trust-Model Sign-off (must read)",
    text: "ACCEPT: Slashing PRIMITIVES exist (slash_double_sign 5%, slash_downtime 0.10%) in staking.rs but auto-enforcement is NOT yet wired into apply_block. Operators are responsible for not running the same key on two hosts; vote-pool DoubleSign evidence is collected but no automatic stake reduction fires today.",
    ref: "zebvix-chain/src/staking.rs  +  zebvix-chain/src/vote.rs",
    completed: false,
  },
  {
    id: "trust-peer-id",
    category: "10. Trust-Model Sign-off (must read)",
    text: "ACCEPT: libp2p peer-id rotates on every restart (with_new_identity). Any seed-peer multiaddr containing /p2p/<peer-id> becomes stale across restarts. Operators must use IP-only seed entries OR re-publish peer-ids after each restart until the planned with_existing_identity migration lands.",
    ref: "zebvix-chain/src/p2p.rs SwarmBuilder::with_new_identity",
    completed: false,
  },
  {
    id: "trust-block-stm",
    category: "10. Trust-Model Sign-off (must read)",
    text: "ACCEPT: Block execution is single-threaded today. block_stm.rs ships only as a design sketch. At current load this is a non-issue; will be revisited after Phase C.3 stabilises.",
    ref: "zebvix-chain/src/block_stm.rs",
    completed: false,
  },
  {
    id: "trust-founder-premine",
    category: "10. Trust-Model Sign-off (must read)",
    text: "ACCEPT: FOUNDER_PREMINE_WEI = 9.99M ZBX (6.66% of max supply) is auto-credited at genesis to the validator_addr derived from whichever key was passed as `--validator-key` to `init` — NOT to the FOUNDER_PUBKEY_HEX-derived address. Whoever ran `init` controls the premine. Use `--alloc` to redirect, or `--no-default-premine` to skip entirely. This is counted in circulating supply.",
    ref: "tokenomics.rs:21 FOUNDER_PREMINE_ZBX = 9_990_000  +  main.rs:885 cmd_init premine path",
    completed: false,
  },
];

const STORAGE_KEY = "zebvix-launch-checklist-v2";

export function useChecklist() {
  const [items, setItems] = useState<ChecklistItem[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ChecklistItem[];
        const completedMap: Record<string, boolean> = {};
        parsed.forEach((i) => {
          completedMap[i.id] = i.completed;
        });
        return defaultItems.map((item) => ({
          ...item,
          completed: completedMap[item.id] ?? false,
        }));
      }
    } catch (_e) {
      /* ignore */
    }
    return defaultItems;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (_e) {
      /* ignore */
    }
  }, [items]);

  const toggleItem = (id: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, completed: !item.completed } : item))
    );
  };

  const resetAll = () => {
    setItems((prev) => prev.map((item) => ({ ...item, completed: false })));
  };

  const progress =
    items.length === 0
      ? 0
      : Math.round((items.filter((i) => i.completed).length / items.length) * 100);

  return { items, toggleItem, progress, resetAll, categoriesOrdered };
}
