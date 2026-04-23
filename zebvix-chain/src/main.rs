use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use zebvix_node::consensus::Producer;
use zebvix_node::crypto::{address_from_pubkey, generate_keypair, keypair_from_secret, sign_tx};
use zebvix_node::mempool::Mempool;
use zebvix_node::rpc;
use zebvix_node::state::State;
use zebvix_node::tokenomics::{self, CHAIN_ID, FOUNDER_PREMINE_WEI, TOTAL_SUPPLY_WEI, WEI_PER_ZBX};
use zebvix_node::types::{Address, TxBody, TxKind, Validator};
use zebvix_node::vote::{sign_vote, AddVoteResult, Vote, VoteData, VotePool, VoteType};

#[derive(Parser)]
#[command(name = "zebvix-node", version, about = "Zebvix L1 blockchain node (ZBX, EVM-style)")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Generate a new keypair and print address.
    Keygen {
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// Initialize a new chain: writes genesis.json and creates data dir.
    Init {
        #[arg(long, default_value = "./.zebvix")]
        home: PathBuf,
        /// Validator key file from `keygen --out`. Becomes the founder/proposer.
        #[arg(long)]
        validator_key: PathBuf,
        /// Pre-mine allocation: `addr:amount_zbx` (repeatable).
        /// If empty, the validator address gets the default founder pre-mine (10,000,000 ZBX).
        #[arg(long)]
        alloc: Vec<String>,
        /// Disable the default 10M ZBX founder pre-mine when no --alloc is given.
        #[arg(long)]
        no_default_premine: bool,
    },
    /// Start the node (block producer + JSON-RPC + P2P gossip).
    Start {
        #[arg(long, default_value = "./.zebvix")]
        home: PathBuf,
        #[arg(long, default_value = "0.0.0.0:8545")]
        rpc: String,
        /// TCP port for libp2p (0 = OS-assigned). Set to e.g. 30333 for VPS.
        #[arg(long, default_value_t = 30333)]
        p2p_port: u16,
        /// Bootstrap peer multiaddrs (repeatable).
        /// Example: --peer /ip4/1.2.3.4/tcp/30333/p2p/12D3KooW...
        #[arg(long = "peer")]
        peers: Vec<String>,
        /// Disable the P2P stack entirely (legacy single-node mode).
        #[arg(long)]
        no_p2p: bool,
        /// Disable mDNS LAN discovery (recommended on production VPS).
        #[arg(long)]
        no_mdns: bool,
        /// Follower mode: do NOT produce blocks, only receive from peers via P2P.
        /// Use this for secondary nodes during Phase A testing (single-validator chain).
        /// Multi-validator BFT (where every node may propose) arrives in Phase B.
        #[arg(long)]
        follower: bool,
    },
    /// Build, sign, and submit a transfer to a running node's RPC.
    Send {
        #[arg(long)]
        from_key: PathBuf,
        #[arg(long)]
        to: String,
        /// Amount in ZBX (decimals allowed, e.g. 1.5).
        #[arg(long)]
        amount: String,
        #[arg(long, default_value = "0")]
        fee: String,
        #[arg(long, default_value = "http://127.0.0.1:8545")]
        rpc: String,
    },
    /// Admin: testnet faucet — mint zUSD to an address (direct DB write; node must be stopped).
    AdminFaucet {
        #[arg(long, default_value = "./.zebvix")]
        home: PathBuf,
        #[arg(long)]
        to: String,
        /// Amount of zUSD (decimals allowed). 1 zUSD = $1.
        #[arg(long)]
        amount: String,
    },
    /// Admin: initialize the AMM pool with **genesis liquidity** (node must be stopped).
    /// Mints 10M ZBX + 10M zUSD directly into pool reserves (no admin debit).
    /// LP tokens are locked permanently to POOL_ADDRESS — nobody can withdraw.
    /// The 10M zUSD is a "loan" repaid via accumulated swap fees.
    AdminPoolGenesis {
        #[arg(long, default_value = "./.zebvix")]
        home: PathBuf,
    },
    /// Admin: add liquidity to the pool (node must be stopped).
    AdminPoolAdd {
        #[arg(long, default_value = "./.zebvix")]
        home: PathBuf,
        #[arg(long)]
        from: String,
        #[arg(long)]
        zbx: String,
        #[arg(long)]
        zusd: String,
    },
    /// Admin: swap ZBX→zUSD or zUSD→ZBX directly (node must be stopped).
    AdminSwap {
        #[arg(long, default_value = "./.zebvix")]
        home: PathBuf,
        #[arg(long)]
        from: String,
        /// "zbx" to sell ZBX for zUSD, or "zusd" to sell zUSD for ZBX.
        #[arg(long)]
        sell: String,
        /// Input amount (in the token being sold).
        #[arg(long)]
        amount: String,
        /// Slippage protection: minimum acceptable output.
        #[arg(long, default_value = "0")]
        min_out: String,
    },
    /// Print pool state (read-only; works while node is running).
    PoolInfo {
        #[arg(long, default_value = "./.zebvix")]
        home: PathBuf,
    },
    /// Admin: rotate the admin/founder address (max 3 times, ever).
    /// Must be run with the CURRENT admin's keyfile. Node must be stopped.
    AdminChangeAddress {
        #[arg(long, default_value = "./.zebvix")]
        home: PathBuf,
        /// Current admin's keyfile (must match the live admin address).
        #[arg(long)]
        signer_key: PathBuf,
        /// New admin address (0x… 20-byte hex).
        #[arg(long)]
        new_admin: String,
    },
    /// Print current admin info (live address, rotations used, remaining).
    AdminInfo {
        #[arg(long, default_value = "./.zebvix")]
        home: PathBuf,
    },
    // ─────────── Phase B.1 — Validator-set management ───────────
    /// List all on-chain validators with voting power.
    ///
    /// By default queries via RPC (no DB lock conflict with a running node).
    /// Pass `--offline` to read RocksDB directly (only safe when node is stopped).
    ValidatorList {
        /// RPC endpoint to query (ignored if `--offline` is set).
        #[arg(long, default_value = "http://127.0.0.1:8545")]
        rpc_url: String,
        /// Read directly from RocksDB at `--home` (requires node to be stopped).
        #[arg(long, default_value_t = false)]
        offline: bool,
        /// Home dir (only used with `--offline`).
        #[arg(long, default_value = "./.zebvix")]
        home: PathBuf,
    },
    /// Admin: add or update a validator. Submits an on-chain transaction
    /// (B.3.1+); the change replicates to all nodes via block apply.
    /// **Node MUST be running** (this is now an RPC client command).
    ValidatorAdd {
        /// Current admin's keyfile (transaction signer).
        #[arg(long)]
        signer_key: PathBuf,
        /// Validator's ed25519 public key (0x… 32-byte hex).
        #[arg(long)]
        pubkey: String,
        /// Voting power (positive integer; typical: 1 per validator for equal weight).
        #[arg(long, default_value_t = 1)]
        power: u64,
        /// JSON-RPC endpoint of a running node.
        #[arg(long, default_value = "http://127.0.0.1:8545")]
        rpc_url: String,
        /// Fee in ZBX (must be ≥ 0.00105). Default 0.002 stays safely above min.
        #[arg(long, default_value = "0.002")]
        fee: String,
    },
    /// Admin: remove a validator via on-chain tx. Node must be running.
    ValidatorRemove {
        #[arg(long)]
        signer_key: PathBuf,
        /// Validator address (0x… 20-byte hex).
        #[arg(long)]
        address: String,
        #[arg(long, default_value = "http://127.0.0.1:8545")]
        rpc_url: String,
        #[arg(long, default_value = "0.002")]
        fee: String,
    },
    /// Show a single validator's details (address, pubkey, voting_power).
    /// Queries the running node via RPC (`zbx_getValidator`).
    ShowValidator {
        /// Validator address (0x… 20-byte hex).
        #[arg(long)]
        address: String,
        #[arg(long, default_value = "http://127.0.0.1:8545")]
        rpc_url: String,
    },
    /// Show current chain tip (height, hash, timestamp, proposer).
    /// Queries the running node via RPC (`zbx_blockNumber`).
    BlockNumber {
        #[arg(long, default_value = "http://127.0.0.1:8545")]
        rpc_url: String,
    },

    // ─────────── Phase B.3.2 — Governor (validator-set authority) ───────────
    /// Show current governor (validator-set authority), distinct from economic admin.
    GovernorInfo {
        #[arg(long, default_value = "http://127.0.0.1:8545")]
        rpc_url: String,
    },
    /// Rotate governor address (max 3 times). Signer must be CURRENT governor.
    GovernorChange {
        #[arg(long)]
        signer_key: PathBuf,
        #[arg(long)]
        new_governor: String,
        #[arg(long, default_value = "http://127.0.0.1:8545")]
        rpc_url: String,
        #[arg(long, default_value = "0.002")]
        fee: String,
    },

    // ─────────── Phase B.4 — Sui-style PoS Staking ───────────
    /// Show full staking module state (validators, epoch, rewards, unbonding queue).
    StakingInfo {
        #[arg(long, default_value = "http://127.0.0.1:8545")]
        rpc_url: String,
    },
    /// Show one staking validator (PoS — distinct from B.1 validator-set entry).
    StakingValidator {
        #[arg(long)]
        address: String,
        #[arg(long, default_value = "http://127.0.0.1:8545")]
        rpc_url: String,
    },
    /// Show a single delegation: shares + current ZBX value.
    Delegation {
        #[arg(long)]
        delegator: String,
        #[arg(long)]
        validator: String,
        #[arg(long, default_value = "http://127.0.0.1:8545")]
        rpc_url: String,
    },
    /// Register a new staking validator (self-bonds + sets commission).
    /// Signer becomes the operator and earns commission on delegator rewards.
    ValidatorCreate {
        #[arg(long)]
        signer_key: PathBuf,
        /// Validator's ed25519 public key (0x… 32-byte hex).
        #[arg(long)]
        pubkey: String,
        /// Commission in basis points (100 = 1%, max 10000 = 100%).
        #[arg(long)]
        commission_bps: u64,
        /// Self-bond amount in ZBX (must meet MIN_SELF_BOND).
        #[arg(long)]
        self_bond: String,
        #[arg(long, default_value = "http://127.0.0.1:8545")]
        rpc_url: String,
        #[arg(long, default_value = "0.002")]
        fee: String,
    },
    /// Edit commission for a validator you operate (capped 1% delta per epoch).
    ValidatorEditCommission {
        #[arg(long)]
        signer_key: PathBuf,
        #[arg(long)]
        validator: String,
        #[arg(long)]
        new_commission_bps: u64,
        #[arg(long, default_value = "http://127.0.0.1:8545")]
        rpc_url: String,
        #[arg(long, default_value = "0.002")]
        fee: String,
    },
    /// Delegate ZBX to a validator. Mints delegation shares.
    Stake {
        #[arg(long)]
        signer_key: PathBuf,
        #[arg(long)]
        validator: String,
        /// Amount in ZBX (must meet MIN_DELEGATION).
        #[arg(long)]
        amount: String,
        #[arg(long, default_value = "http://127.0.0.1:8545")]
        rpc_url: String,
        #[arg(long, default_value = "0.002")]
        fee: String,
    },
    /// Unstake by burning shares. Funds mature after UNBONDING_EPOCHS.
    Unstake {
        #[arg(long)]
        signer_key: PathBuf,
        #[arg(long)]
        validator: String,
        /// Number of shares to unbond.
        #[arg(long)]
        shares: String,
        #[arg(long, default_value = "http://127.0.0.1:8545")]
        rpc_url: String,
        #[arg(long, default_value = "0.002")]
        fee: String,
    },
    /// Atomically move stake from one validator to another (no cooldown).
    Redelegate {
        #[arg(long)]
        signer_key: PathBuf,
        #[arg(long)]
        from: String,
        #[arg(long)]
        to: String,
        #[arg(long)]
        shares: String,
        #[arg(long, default_value = "http://127.0.0.1:8545")]
        rpc_url: String,
        #[arg(long, default_value = "0.002")]
        fee: String,
    },
    /// Operator: claim accumulated commission from your validator's pool.
    ClaimRewards {
        #[arg(long)]
        signer_key: PathBuf,
        #[arg(long)]
        validator: String,
        #[arg(long, default_value = "http://127.0.0.1:8545")]
        rpc_url: String,
        #[arg(long, default_value = "0.002")]
        fee: String,
    },
}

#[derive(Serialize, Deserialize)]
struct KeyFile {
    secret_hex: String,
    pubkey_hex: String,
    address: String,
}

#[derive(Serialize, Deserialize)]
struct GenesisFile {
    chain_id: u64,
    chain_name: String,
    token_symbol: String,
    decimals: u32,
    max_supply_wei: String,
    block_time_secs: u64,
    validator_address: String,
    alloc: Vec<(String, String)>, // (address, amount_wei)
    timestamp: i64,
}

fn parse_zbx_amount(s: &str) -> Result<u128> {
    let s = s.trim();
    if let Some(dot) = s.find('.') {
        let (whole, frac) = s.split_at(dot);
        let frac = &frac[1..];
        if frac.len() > 18 { return Err(anyhow!("max 18 decimals")); }
        let whole: u128 = whole.parse().map_err(|_| anyhow!("bad integer part"))?;
        let mut frac_padded = frac.to_string();
        while frac_padded.len() < 18 { frac_padded.push('0'); }
        let frac_n: u128 = frac_padded.parse().map_err(|_| anyhow!("bad fractional part"))?;
        whole.checked_mul(WEI_PER_ZBX).and_then(|v| v.checked_add(frac_n))
            .ok_or_else(|| anyhow!("overflow"))
    } else {
        let whole: u128 = s.parse().map_err(|_| anyhow!("bad integer"))?;
        whole.checked_mul(WEI_PER_ZBX).ok_or_else(|| anyhow!("overflow"))
    }
}

fn write_keyfile(path: &PathBuf, secret: &[u8; 32], pubkey: &[u8; 32]) -> Result<()> {
    let addr = address_from_pubkey(pubkey);
    let kf = KeyFile {
        secret_hex: hex::encode(secret),
        pubkey_hex: hex::encode(pubkey),
        address: addr.to_hex(),
    };
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).ok(); }
    std::fs::write(path, serde_json::to_string_pretty(&kf)?)?;
    Ok(())
}

fn read_keyfile(path: &PathBuf) -> Result<([u8; 32], [u8; 32])> {
    let s = std::fs::read_to_string(path)?;
    let kf: KeyFile = serde_json::from_str(&s)?;
    let sk = hex::decode(&kf.secret_hex)?;
    if sk.len() != 32 { return Err(anyhow!("bad secret length")); }
    let mut sec = [0u8; 32];
    sec.copy_from_slice(&sk);
    let (sk_b, pk) = keypair_from_secret(&sec);
    Ok((sk_b, pk))
}

fn cmd_keygen(out: Option<PathBuf>) -> Result<()> {
    let (sk, pk) = generate_keypair();
    let addr = address_from_pubkey(&pk);
    println!("Address    : {}", addr);
    println!("Public Key : 0x{}", hex::encode(pk));
    if let Some(p) = out {
        write_keyfile(&p, &sk, &pk)?;
        println!("Saved key  : {}", p.display());
    } else {
        println!("Secret Key : 0x{}  (save this securely!)", hex::encode(sk));
    }
    Ok(())
}

fn cmd_init(home: PathBuf, validator_key: PathBuf, alloc: Vec<String>, no_default_premine: bool) -> Result<()> {
    let (_, pk) = read_keyfile(&validator_key)?;
    let validator_addr = address_from_pubkey(&pk);

    std::fs::create_dir_all(&home)?;
    let data_dir = home.join("data");
    std::fs::create_dir_all(&data_dir)?;

    // Parse alloc entries "addr:amount_zbx"
    let mut alloc_pairs: Vec<(Address, u128)> = Vec::new();
    let mut alloc_serialized: Vec<(String, String)> = Vec::new();
    for entry in &alloc {
        let (a, amt) = entry.split_once(':').ok_or_else(|| anyhow!("alloc must be addr:amount"))?;
        let address = Address::from_hex(a.trim())?;
        let wei = parse_zbx_amount(amt.trim())?;
        alloc_pairs.push((address, wei));
        alloc_serialized.push((address.to_hex(), wei.to_string()));
    }

    // Founder pre-mine is now 0 by default — admin earns only via block rewards & swap fees.
    // Honor explicit `--alloc` entries (already collected above). The legacy
    // `--no_default_premine` flag is now redundant (default is 0) but preserved
    // for compatibility.
    if alloc_pairs.is_empty() && !no_default_premine && FOUNDER_PREMINE_WEI > 0 {
        alloc_pairs.push((validator_addr, FOUNDER_PREMINE_WEI));
        alloc_serialized.push((validator_addr.to_hex(), FOUNDER_PREMINE_WEI.to_string()));
        println!("ℹ️  Default founder pre-mine: {} ZBX → {}",
            FOUNDER_PREMINE_WEI / WEI_PER_ZBX, validator_addr);
    } else {
        println!("ℹ️  No founder pre-mine — admin earns ZBX only via block rewards & swap fees.");
    }

    // Init state with allocations
    let state = State::open(&data_dir)?;
    if state.tip().0 == 0 {
        state.genesis_credit(&alloc_pairs)?;
        // Phase B.3.1.5: seed genesis validator set DETERMINISTICALLY with the
        // hardcoded founder pubkey — every node, regardless of its own
        // `--validator-key`, starts with the same {founder} validator set.
        // This eliminates the prior "genesis validator divergence" bug where
        // each node's genesis registry had its own local key.
        // Post-genesis additions (e.g., Node-2's own key) come via
        // `validator-add` txs, which replicate via block-apply (B.3.1).
        let founder_pk = parse_pubkey_hex(tokenomics::FOUNDER_PUBKEY_HEX)
            .expect("FOUNDER_PUBKEY_HEX must be valid 32-byte hex");
        let founder_val = Validator::new(founder_pk, 1);
        let founder_addr = founder_val.address;
        state.put_validator(&founder_val)?;
        println!("ℹ️  Genesis validator (founder, deterministic): {} (power=1)", founder_addr);
        if pk != founder_pk {
            println!(
                "ℹ️  Local validator key {} is NOT the founder — it must be added post-genesis via `validator-add` tx (admin-signed).",
                validator_addr
            );
        }
    }

    let genesis = GenesisFile {
        chain_id: CHAIN_ID,
        chain_name: "Zebvix".to_string(),
        token_symbol: "ZBX".to_string(),
        decimals: 18,
        max_supply_wei: TOTAL_SUPPLY_WEI.to_string(),
        block_time_secs: tokenomics::BLOCK_TIME_SECS,
        validator_address: validator_addr.to_hex(),
        alloc: alloc_serialized,
        timestamp: chrono::Utc::now().timestamp(),
    };
    let g_path = home.join("genesis.json");
    std::fs::write(&g_path, serde_json::to_string_pretty(&genesis)?)?;

    // Save validator key path
    let cfg = serde_json::json!({
        "validator_key_file": validator_key.canonicalize().unwrap_or(validator_key.clone()),
    });
    std::fs::write(home.join("node.json"), serde_json::to_string_pretty(&cfg)?)?;

    println!("✅ Initialized Zebvix chain at {}", home.display());
    println!("   chain_id          : {}", CHAIN_ID);
    println!("   validator address : {}", validator_addr);
    println!("   genesis           : {}", g_path.display());
    println!("   data dir          : {}", data_dir.display());
    Ok(())
}

async fn cmd_start(
    home: PathBuf,
    rpc_addr: String,
    p2p_port: u16,
    peer_strs: Vec<String>,
    no_p2p: bool,
    no_mdns: bool,
    follower: bool,
) -> Result<()> {
    let cfg_path = home.join("node.json");
    let cfg: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&cfg_path)?)?;
    let key_path = PathBuf::from(
        cfg["validator_key_file"].as_str().ok_or_else(|| anyhow!("validator_key_file missing"))?
    );
    let (sk, pk) = read_keyfile(&key_path)?;
    let proposer = address_from_pubkey(&pk);

    let state = Arc::new(State::open(&home.join("data"))?);
    let mempool = Arc::new(Mempool::new(state.clone(), 50_000));

    tracing::info!("🚀 Zebvix node starting");
    tracing::info!("   chain_id  : {}", CHAIN_ID);
    tracing::info!("   proposer  : {}", proposer);
    tracing::info!("   tip       : height={} hash={}", state.tip().0, state.tip().1);
    tracing::info!("   rpc       : http://{}", rpc_addr);
    if follower { tracing::info!("   mode      : FOLLOWER (block production DISABLED)"); }

    // ── Phase A: spawn P2P gossip layer ────────────────────────────────
    let producer = if no_p2p {
        tracing::warn!("   p2p       : DISABLED (--no-p2p)");
        Arc::new(Producer::new(sk, state.clone(), mempool.clone()))
    } else {
        // Parse bootstrap peer multiaddrs
        let mut bootstrap = Vec::new();
        for p in &peer_strs {
            match p.parse::<libp2p::Multiaddr>() {
                Ok(ma) => bootstrap.push(ma),
                Err(e) => tracing::warn!("ignoring bad --peer {p}: {e}"),
            }
        }

        let handle = zebvix_node::p2p::spawn_p2p(
            CHAIN_ID, p2p_port, bootstrap, no_mdns, state.clone(),
        )
        .map_err(|e| anyhow!("p2p init failed: {e}"))?;
        tracing::info!("   p2p       : tcp/{p2p_port}  peer_id={}", handle.local_peer_id);
        if no_mdns { tracing::info!("   mdns      : DISABLED (--no-mdns)"); }

        // Producer broadcasts every mined block.
        let out_tx = handle.out_tx.clone();
        let block_tx = out_tx.clone();
        let producer_send: tokio::sync::mpsc::UnboundedSender<Vec<u8>> = {
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
            // Forward producer block bytes → P2P out channel.
            tokio::spawn(async move {
                while let Some(bytes) = rx.recv().await {
                    let _ = block_tx.send(zebvix_node::p2p::P2PMsg::Block(bytes));
                }
            });
            tx
        };
        let producer = Arc::new(
            Producer::new(sk, state.clone(), mempool.clone()).with_broadcast(producer_send),
        );

        // ── Phase B.2: shared vote pool + auto-emit votes after each new block ──
        let vote_pool = Arc::new(VotePool::new(CHAIN_ID));

        // Background task: poll the chain tip; whenever it advances, this node's
        // validator (if registered) signs a Prevote AND a Precommit for the new
        // tip and gossips both. Phase B.3 will drive votes from the actual
        // Tendermint round state machine; here we just exercise the wire so
        // votes are observable in `zbx_voteStats` and operators can see the
        // pool filling. NOTE: a follower with no validator entry will skip.
        let st_vote = state.clone();
        let pool_vote = vote_pool.clone();
        let out_vote = out_tx.clone();
        let vote_secret = sk;
        let vote_pubkey = pk;
        let self_addr = proposer;
        tokio::spawn(async move {
            let mut last_emitted: u64 = st_vote.tip().0;
            let mut tick = tokio::time::interval(tokio::time::Duration::from_millis(500));
            loop {
                tick.tick().await;
                let (h, hash) = st_vote.tip();
                if h <= last_emitted { continue; }
                // Check this node is in the active validator set.
                let vset = st_vote.validators();
                if !vset.iter().any(|v| v.address == self_addr) {
                    last_emitted = h;
                    continue;
                }
                for vt in [VoteType::Prevote, VoteType::Precommit] {
                    let data = VoteData {
                        chain_id: CHAIN_ID, height: h, round: 0,
                        vote_type: vt, block_hash: Some(hash),
                    };
                    let v = sign_vote(&vote_secret, vote_pubkey, data);
                    // Add to local pool first (so it shows up immediately on this node).
                    match pool_vote.add(v.clone(), &vset) {
                        AddVoteResult::Inserted { reached_quorum } => {
                            tracing::info!("🗳  emitted {} h={} block={}{}",
                                vt.as_str(), h, hash,
                                if reached_quorum { "  ✅ QUORUM" } else { "" });
                        }
                        other => tracing::debug!("local vote add: {:?}", other),
                    }
                    // Gossip to peers.
                    if let Ok(bytes) = bincode::serialize(&v) {
                        let _ = out_vote.send(zebvix_node::p2p::P2PMsg::Vote(bytes));
                    }
                }
                // Periodic GC: keep last 50 heights.
                if h > 50 {
                    let dropped = pool_vote.gc_below(h - 50);
                    if dropped > 0 {
                        tracing::debug!("vote pool GC: dropped {dropped} stale slots below h={}", h - 50);
                    }
                }
                last_emitted = h;
            }
        });

        // Spawn inbound consumer: route received blocks to state, txs to mempool, votes to pool.
        let st = state.clone();
        let mp = mempool.clone();
        let pool_in = vote_pool.clone();
        let mut inbound = handle.inbound_rx;
        tokio::spawn(async move {
            while let Some(msg) = inbound.recv().await {
                match msg {
                    zebvix_node::p2p::P2PMsg::Block(bytes) => {
                        match bincode::deserialize::<zebvix_node::types::Block>(&bytes) {
                            Ok(block) => {
                                let h = block.header.height;
                                let (tip_h, _) = st.tip();
                                if h <= tip_h {
                                    tracing::debug!("p2p stale block #{h} (tip={tip_h}), skipped");
                                    continue;
                                }
                                if h != tip_h + 1 {
                                    // Out-of-order: sync protocol in p2p.rs has already triggered a request.
                                    tracing::debug!(
                                        "p2p out-of-order block #{h} (tip={tip_h}); awaiting sync response"
                                    );
                                    continue;
                                }
                                match st.apply_block(&block) {
                                    Ok(_)  => tracing::info!("📦 p2p applied block #{h} ({} txs)", block.txs.len()),
                                    Err(e) => tracing::warn!("p2p apply_block #{h} failed: {e}"),
                                }
                            }
                            Err(e) => tracing::warn!("p2p block deserialize failed: {e}"),
                        }
                    }
                    zebvix_node::p2p::P2PMsg::Tx(bytes) => {
                        match bincode::deserialize::<zebvix_node::types::SignedTx>(&bytes) {
                            Ok(tx) => match mp.add(tx) {
                                Ok(_)  => tracing::debug!("p2p added gossiped tx to mempool"),
                                Err(e) => tracing::debug!("p2p tx rejected: {e}"),
                            },
                            Err(e) => tracing::warn!("p2p tx deserialize failed: {e}"),
                        }
                    }
                    zebvix_node::p2p::P2PMsg::Vote(bytes) => {
                        match bincode::deserialize::<Vote>(&bytes) {
                            Ok(vote) => {
                                let vset = st.validators();
                                let h = vote.data.height;
                                let r = vote.data.round;
                                let vt = vote.data.vote_type;
                                let voter = vote.validator_address;
                                match pool_in.add(vote, &vset) {
                                    AddVoteResult::Inserted { reached_quorum } => {
                                        tracing::info!("🗳  vote {} h={} r={} from {}{}",
                                            vt.as_str(), h, r, voter,
                                            if reached_quorum { "  ✅ QUORUM" } else { "" });
                                    }
                                    AddVoteResult::Duplicate => {
                                        tracing::debug!("vote dup from {voter}");
                                    }
                                    AddVoteResult::DoubleSign { .. } => {
                                        tracing::warn!("⚠️  DOUBLE-SIGN by {voter} at h={h} r={r} {} (slashable in B.3+)", vt.as_str());
                                    }
                                    AddVoteResult::BadSignature => {
                                        tracing::warn!("vote bad signature from {voter}");
                                    }
                                    AddVoteResult::UnknownValidator => {
                                        tracing::debug!("vote from non-validator {voter} ignored");
                                    }
                                    AddVoteResult::WrongChain => {
                                        tracing::debug!("vote wrong chain from {voter} ignored");
                                    }
                                }
                            }
                            Err(e) => tracing::warn!("p2p vote deserialize failed: {e}"),
                        }
                    }
                }
            }
        });

        // Phase A.5: RPC-submitted txs are immediately gossiped to peers.
        let rpc_out = Some(out_tx.clone());
        // Spawn producer (skip in follower mode — node only receives blocks from peers).
        if !follower {
            tokio::spawn(producer.clone().run());
        } else {
            tracing::warn!("follower mode: producer DISABLED, this node will only sync from peers");
        }
        // RPC server with P2P tx gossip + vote pool enabled.
        let ctx = rpc::RpcCtx {
            state: state.clone(),
            mempool: mempool.clone(),
            p2p_out: rpc_out,
            votes: Some(vote_pool.clone()),
        };
        let app = rpc::router(ctx);
        let listener = tokio::net::TcpListener::bind(&rpc_addr).await?;
        return Ok(axum::serve(listener, app).await?);
    };

    // ── Legacy --no-p2p path ──────────────────────────────────────────
    if !follower {
        tokio::spawn(producer.clone().run());
    }
    let ctx = rpc::RpcCtx {
        state: state.clone(), mempool: mempool.clone(),
        p2p_out: None, votes: None,
    };
    let app = rpc::router(ctx);
    let listener = tokio::net::TcpListener::bind(&rpc_addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn cmd_send(from_key: PathBuf, to: String, amount: String, fee: String, rpc_url: String) -> Result<()> {
    let (sk, pk) = read_keyfile(&from_key)?;
    let from = address_from_pubkey(&pk);
    let to = Address::from_hex(&to)?;
    let amount_wei = parse_zbx_amount(&amount)?;
    let fee_wei = parse_zbx_amount(&fee)?;

    // Get nonce from RPC
    let client = reqwest_get_nonce(&rpc_url, &from).await?;
    let body = TxBody {
        from, to, amount: amount_wei, nonce: client, fee: fee_wei,
        chain_id: CHAIN_ID, kind: TxKind::Transfer,
    };
    let tx = sign_tx(&sk, body);

    // Submit
    let req = serde_json::json!({
        "jsonrpc":"2.0","id":1,"method":"zbx_sendTransaction",
        "params":[tx]
    });
    let resp = http_post(&rpc_url, &req).await?;
    println!("{}", serde_json::to_string_pretty(&resp)?);
    Ok(())
}

async fn http_post(url: &str, body: &serde_json::Value) -> Result<serde_json::Value> {
    let url = url.trim_end_matches('/');
    let parsed = url.strip_prefix("http://").ok_or_else(|| anyhow!("only http:// urls"))?;
    let (host_port, path) = match parsed.find('/') {
        Some(i) => (&parsed[..i], &parsed[i..]),
        None => (parsed, "/"),
    };
    let body_str = serde_json::to_string(body)?;
    let req = format!(
        "POST {path} HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n{body}",
        path = path, host = host_port, len = body_str.len(), body = body_str
    );
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut sock = tokio::net::TcpStream::connect(host_port).await?;
    sock.write_all(req.as_bytes()).await?;
    let mut buf = Vec::new();
    sock.read_to_end(&mut buf).await?;
    let s = String::from_utf8_lossy(&buf);
    let body_start = s.find("\r\n\r\n").ok_or_else(|| anyhow!("malformed http response"))?;
    let json_str = &s[body_start + 4..];
    let v: serde_json::Value = serde_json::from_str(json_str.trim())?;
    Ok(v)
}

async fn reqwest_get_nonce(url: &str, addr: &Address) -> Result<u64> {
    let req = serde_json::json!({
        "jsonrpc":"2.0","id":1,"method":"zbx_getNonce","params":[addr.to_hex()]
    });
    let resp = http_post(url, &req).await?;
    Ok(resp["result"].as_u64().unwrap_or(0))
}

// ───────── Admin pool / faucet commands (Phase 1) ─────────
//
// These bypass the mempool and write directly to the on-disk state.
// They MUST be run while the node binary is stopped to avoid RocksDB lock
// conflicts. Phase 2 will replace these with proper signed transactions
// flowing through consensus.

fn fmt_zbx(wei: u128) -> String {
    let whole = wei / WEI_PER_ZBX;
    let frac = wei % WEI_PER_ZBX;
    if frac == 0 { return format!("{}", whole); }
    let frac_str = format!("{:018}", frac);
    let trimmed = frac_str.trim_end_matches('0');
    format!("{}.{}", whole, trimmed)
}

fn cmd_admin_faucet(home: PathBuf, to: String, amount: String) -> Result<()> {
    let to_addr = Address::from_hex(&to)?;
    let amt = parse_zbx_amount(&amount)?; // zUSD uses same 18-decimal scale
    let state = State::open(&home.join("data"))?;
    state.faucet_mint_zusd(&to_addr, amt)?;
    let acc = state.account(&to_addr);
    println!("✅ Minted {} zUSD → {}", fmt_zbx(amt), to_addr);
    println!("   New zUSD balance: {} zUSD", fmt_zbx(acc.zusd));
    Ok(())
}

fn cmd_admin_pool_genesis(home: PathBuf) -> Result<()> {
    let state = State::open(&home.join("data"))?;
    let lp = state.pool_init_genesis()?;
    let p = state.pool();
    let pool_addr = zebvix_node::state::pool_address();
    let admin_addr = zebvix_node::state::admin_address();
    println!("✅ Pool genesis complete — permissionless AMM is LIVE!");
    println!();
    println!("   Pool address  : {}  ⚠️  no private key — controlled by chain logic", pool_addr);
    println!("   Admin address : {}", admin_addr);
    println!();
    println!("   ZBX reserve   : {} ZBX  (minted to pool, not admin)", fmt_zbx(p.zbx_reserve));
    println!("   zUSD reserve  : {} zUSD (minted as liquidity loan)", fmt_zbx(p.zusd_reserve));
    println!("   Loan to repay : {} zUSD ← will be repaid via 0.3% swap fees", fmt_zbx(p.loan_outstanding_zusd));
    println!("   LP locked     : {} (held by POOL_ADDRESS, permanent)", lp);
    println!();
    println!("   Spot price    : 1 ZBX = ${:.6}", p.spot_price_zusd_per_zbx() as f64 / 1e18);
    println!();
    println!("   ┌─ How users swap ─────────────────────────────────────┐");
    println!("   │  Send ZBX → {}  │", pool_addr);
    println!("   │  → auto-swapped to zUSD, returned to your wallet     │");
    println!("   └──────────────────────────────────────────────────────┘");
    Ok(())
}

fn cmd_admin_pool_add(home: PathBuf, from: String, zbx: String, zusd: String) -> Result<()> {
    let from_addr = Address::from_hex(&from)?;
    let zbx_w = parse_zbx_amount(&zbx)?;
    let zusd_w = parse_zbx_amount(&zusd)?;
    let state = State::open(&home.join("data"))?;
    let (zbx_in, zusd_in, lp) = state.pool_add_liquidity(&from_addr, zbx_w, zusd_w)?;
    let p = state.pool();
    println!("✅ Liquidity added!");
    println!("   Used ZBX  : {} ZBX", fmt_zbx(zbx_in));
    println!("   Used zUSD : {} zUSD", fmt_zbx(zusd_in));
    println!("   LP minted : {}", lp);
    println!("   New reserves: {} ZBX / {} zUSD", fmt_zbx(p.zbx_reserve), fmt_zbx(p.zusd_reserve));
    Ok(())
}

fn cmd_admin_swap(home: PathBuf, from: String, sell: String, amount: String, min_out: String) -> Result<()> {
    let from_addr = Address::from_hex(&from)?;
    let amt = parse_zbx_amount(&amount)?;
    let min = parse_zbx_amount(&min_out)?;
    let state = State::open(&home.join("data"))?;
    let (out_token, out_amt) = match sell.to_lowercase().as_str() {
        "zbx" => ("zUSD", state.pool_swap_zbx_to_zusd(&from_addr, amt, min)?),
        "zusd" => ("ZBX", state.pool_swap_zusd_to_zbx(&from_addr, amt, min)?),
        other => return Err(anyhow!("--sell must be 'zbx' or 'zusd', got '{}'", other)),
    };
    let p = state.pool();
    println!("✅ Swap executed!");
    println!("   Sold     : {} {}", fmt_zbx(amt), if sell.eq_ignore_ascii_case("zbx") {"ZBX"} else {"zUSD"});
    println!("   Received : {} {}", fmt_zbx(out_amt), out_token);
    println!("   New price: 1 ZBX = ${:.6}", p.spot_price_zusd_per_zbx() as f64 / 1e18);
    Ok(())
}

fn cmd_pool_info(home: PathBuf) -> Result<()> {
    let state = State::open(&home.join("data"))?;
    let p = state.pool();
    if !p.is_initialized() {
        println!("Pool: ❌ Not initialized yet.");
        println!("Run: zebvix-node admin-pool-genesis");
        return Ok(());
    }
    println!("📊 zSwap AMM Pool (ZBX / zUSD)  — permissionless");
    println!("   Pool address    : {}", zebvix_node::state::pool_address());
    println!("   ZBX reserve     : {} ZBX", fmt_zbx(p.zbx_reserve));
    println!("   zUSD reserve    : {} zUSD", fmt_zbx(p.zusd_reserve));
    println!("   LP supply       : {} (locked to POOL_ADDRESS)", p.lp_supply);
    println!("   Spot price      : 1 ZBX = ${:.6}", p.spot_price_zusd_per_zbx() as f64 / 1e18);
    println!("   Pool fee        : 0.30% (input-deducted)");
    println!();
    println!("   💰 Loan status  : {}",
        if p.loan_repaid() { "✅ REPAID — admin earning 50% of fees".to_string() }
        else { format!("⏳ {} zUSD outstanding", fmt_zbx(p.loan_outstanding_zusd)) });
    println!("   Fee bucket ZBX  : {} ZBX (pending settlement)", fmt_zbx(p.fee_acc_zbx));
    println!("   Fee bucket zUSD : {} zUSD", fmt_zbx(p.fee_acc_zusd));
    println!("   Lifetime fees   : {} zUSD", fmt_zbx(p.total_fees_collected_zusd));
    println!("   To admin (life) : {} zUSD", fmt_zbx(p.total_admin_paid_zusd));
    println!("   Reinvested      : {} zUSD", fmt_zbx(p.total_reinvested_zusd));
    println!("   Init height     : {}", p.init_height);
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "zebvix_node=info".into()))
        .init();
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Keygen { out } => cmd_keygen(out),
        Cmd::Init { home, validator_key, alloc, no_default_premine } => cmd_init(home, validator_key, alloc, no_default_premine),
        Cmd::Start { home, rpc, p2p_port, peers, no_p2p, no_mdns, follower } =>
            cmd_start(home, rpc, p2p_port, peers, no_p2p, no_mdns, follower).await,
        Cmd::Send { from_key, to, amount, fee, rpc } => cmd_send(from_key, to, amount, fee, rpc).await,
        Cmd::AdminFaucet { home, to, amount } => cmd_admin_faucet(home, to, amount),
        Cmd::AdminPoolGenesis { home } => cmd_admin_pool_genesis(home),
        Cmd::AdminPoolAdd { home, from, zbx, zusd } => cmd_admin_pool_add(home, from, zbx, zusd),
        Cmd::AdminSwap { home, from, sell, amount, min_out } => cmd_admin_swap(home, from, sell, amount, min_out),
        Cmd::PoolInfo { home } => cmd_pool_info(home),
        Cmd::AdminChangeAddress { home, signer_key, new_admin } => cmd_admin_change_address(home, signer_key, new_admin),
        Cmd::AdminInfo { home } => cmd_admin_info(home),
        Cmd::ValidatorList { rpc_url, offline, home } => cmd_validator_list(rpc_url, offline, home).await,
        Cmd::ShowValidator { address, rpc_url } => cmd_show_validator(address, rpc_url).await,
        Cmd::BlockNumber { rpc_url } => cmd_block_number(rpc_url).await,
        Cmd::ValidatorAdd { signer_key, pubkey, power, rpc_url, fee } =>
            cmd_validator_add(signer_key, pubkey, power, rpc_url, fee).await,
        Cmd::GovernorInfo { rpc_url } => cmd_governor_info(rpc_url).await,
        Cmd::GovernorChange { signer_key, new_governor, rpc_url, fee } =>
            cmd_governor_change(signer_key, new_governor, rpc_url, fee).await,
        Cmd::StakingInfo { rpc_url } => cmd_staking_info(rpc_url).await,
        Cmd::StakingValidator { address, rpc_url } => cmd_staking_validator(address, rpc_url).await,
        Cmd::Delegation { delegator, validator, rpc_url } =>
            cmd_delegation(delegator, validator, rpc_url).await,
        Cmd::ValidatorCreate { signer_key, pubkey, commission_bps, self_bond, rpc_url, fee } =>
            cmd_validator_create(signer_key, pubkey, commission_bps, self_bond, rpc_url, fee).await,
        Cmd::ValidatorEditCommission { signer_key, validator, new_commission_bps, rpc_url, fee } =>
            cmd_validator_edit_commission(signer_key, validator, new_commission_bps, rpc_url, fee).await,
        Cmd::Stake { signer_key, validator, amount, rpc_url, fee } =>
            cmd_stake(signer_key, validator, amount, rpc_url, fee).await,
        Cmd::Unstake { signer_key, validator, shares, rpc_url, fee } =>
            cmd_unstake(signer_key, validator, shares, rpc_url, fee).await,
        Cmd::Redelegate { signer_key, from, to, shares, rpc_url, fee } =>
            cmd_redelegate(signer_key, from, to, shares, rpc_url, fee).await,
        Cmd::ClaimRewards { signer_key, validator, rpc_url, fee } =>
            cmd_claim_rewards(signer_key, validator, rpc_url, fee).await,
        Cmd::ValidatorRemove { signer_key, address, rpc_url, fee } =>
            cmd_validator_remove(signer_key, address, rpc_url, fee).await,
    }
}

fn cmd_admin_change_address(home: PathBuf, signer_key: PathBuf, new_admin: String) -> Result<()> {
    let (_, pk) = read_keyfile(&signer_key)?;
    let signer = address_from_pubkey(&pk);
    let new_addr = Address::from_hex(&new_admin)?;
    let state = State::open(&home.join("data"))?;
    let prev = state.current_admin();
    let used_before = state.admin_change_count();
    let new_count = state.change_admin(&signer, &new_addr)?;
    println!("✅ Admin address rotated successfully!");
    println!();
    println!("   Previous admin   : {}", prev);
    println!("   New admin        : {}", new_addr);
    println!("   Rotations used   : {} → {} (of {} max)", used_before, new_count, tokenomics::MAX_ADMIN_CHANGES);
    println!("   Remaining        : {}", tokenomics::MAX_ADMIN_CHANGES - new_count);
    if new_count >= tokenomics::MAX_ADMIN_CHANGES {
        println!();
        println!("   ⚠️  Admin address is now PERMANENTLY LOCKED — no more rotations possible.");
    }
    println!();
    println!("   ℹ️  Future swap-fee payouts (50% after loan repaid) go to the new admin.");
    Ok(())
}

// ─────────── Phase B.1 — Validator-set commands ───────────

async fn cmd_validator_list(rpc_url: String, offline: bool, home: PathBuf) -> Result<()> {
    if offline {
        // Direct DB read — only safe when no node holds the lock.
        let state = State::open(&home.join("data"))?;
        let vals = state.validators();
        let total = state.total_voting_power();
        let quorum = state.quorum_threshold();
        print_validators("offline (RocksDB direct)", vals.len(), total, quorum,
            vals.into_iter().map(|v| (v.address.to_hex(), v.voting_power, hex::encode(v.pubkey))));
        return Ok(());
    }

    // Default path: query the running node via RPC. No DB lock contention.
    let req = serde_json::json!({
        "jsonrpc":"2.0","id":1,"method":"zbx_listValidators","params":[]
    });
    let resp = http_post(&rpc_url, &req).await
        .map_err(|e| anyhow!("RPC call failed ({rpc_url}): {e}. Tip: pass --offline to read DB directly when node is stopped."))?;
    if let Some(err) = resp.get("error") {
        return Err(anyhow!("RPC error: {}", err));
    }
    let result = resp.get("result").ok_or_else(|| anyhow!("missing 'result' in RPC response"))?;
    let count = result.get("count").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    let total = result.get("total_voting_power").and_then(|v| v.as_u64()).unwrap_or(0);
    let quorum = result.get("quorum_threshold").and_then(|v| v.as_u64()).unwrap_or(0);
    let empty: Vec<serde_json::Value> = vec![];
    let arr = result.get("validators").and_then(|v| v.as_array()).unwrap_or(&empty);
    let rows = arr.iter().map(|v| {
        let addr = v.get("address").and_then(|x| x.as_str()).unwrap_or("?").to_string();
        let power = v.get("voting_power").and_then(|x| x.as_u64()).unwrap_or(0);
        let pk = v.get("pubkey").and_then(|x| x.as_str()).unwrap_or("?")
            .strip_prefix("0x").unwrap_or("?").to_string();
        (addr, power, pk)
    });
    print_validators(&format!("via RPC {rpc_url}"), count, total, quorum, rows);
    Ok(())
}

async fn cmd_show_validator(address: String, rpc_url: String) -> Result<()> {
    let req = serde_json::json!({
        "jsonrpc":"2.0","id":1,"method":"zbx_getValidator","params":[address.clone()]
    });
    let resp = http_post(&rpc_url, &req).await
        .map_err(|e| anyhow!("RPC call failed ({rpc_url}): {e}"))?;
    if let Some(err) = resp.get("error") {
        return Err(anyhow!("RPC error: {}", err));
    }
    let result = resp.get("result").ok_or_else(|| anyhow!("missing 'result' in RPC response"))?;
    if result.is_null() {
        println!("❌ No validator registered at address {address}");
        println!("   Tip: run `zebvix-node validator-list` to see all active validators.");
        return Ok(());
    }
    let addr = result.get("address").and_then(|v| v.as_str()).unwrap_or("?");
    let pk = result.get("pubkey").and_then(|v| v.as_str()).unwrap_or("?");
    let power = result.get("voting_power").and_then(|v| v.as_u64()).unwrap_or(0);
    println!("🛡  Validator details (via RPC {rpc_url})");
    println!("   address      : {addr}");
    println!("   pubkey       : {pk}");
    println!("   voting_power : {power}");
    Ok(())
}

async fn cmd_block_number(rpc_url: String) -> Result<()> {
    let req = serde_json::json!({
        "jsonrpc":"2.0","id":1,"method":"zbx_blockNumber","params":[]
    });
    let resp = http_post(&rpc_url, &req).await
        .map_err(|e| anyhow!("RPC call failed ({rpc_url}): {e}"))?;
    if let Some(err) = resp.get("error") {
        return Err(anyhow!("RPC error: {}", err));
    }
    let result = resp.get("result").ok_or_else(|| anyhow!("missing 'result' in RPC response"))?;
    let h = result.get("height").and_then(|v| v.as_u64()).unwrap_or(0);
    let hex = result.get("hex").and_then(|v| v.as_str()).unwrap_or("?");
    let hash = result.get("hash").and_then(|v| v.as_str()).unwrap_or("?");
    let ts = result.get("timestamp_ms").and_then(|v| v.as_u64()).unwrap_or(0);
    let prop = result.get("proposer").and_then(|v| v.as_str()).unwrap_or("?");
    println!("📦 Chain tip (via RPC {rpc_url})");
    println!("   height       : {h}  ({hex})");
    println!("   hash         : {hash}");
    println!("   timestamp_ms : {ts}");
    println!("   proposer     : {prop}");
    Ok(())
}

fn print_validators<I: Iterator<Item = (String, u64, String)>>(
    source: &str, count: usize, total: u64, quorum: u64, rows: I,
) {
    println!("🛡  Active validators: {} ({})", count, source);
    println!("   Total voting power : {}", total);
    println!("   Quorum (>2/3)      : {}", quorum);
    println!();
    let collected: Vec<_> = rows.collect();
    if collected.is_empty() {
        println!("   (no validators registered)");
    } else {
        for (i, (addr, power, pk)) in collected.iter().enumerate() {
            println!("   [{:>2}] {}  power={}  pubkey=0x{}", i + 1, addr, power, pk);
        }
    }
}

fn parse_pubkey_hex(s: &str) -> Result<[u8; 32]> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    let bytes = hex::decode(s)?;
    if bytes.len() != 32 { return Err(anyhow!("pubkey must be 32 bytes")); }
    let mut a = [0u8; 32];
    a.copy_from_slice(&bytes);
    Ok(a)
}

/// Submit tx via RPC, return Ok(tx_hash) only on `result` field; return Err
/// (with code+message) on `error` field. Avoids the previous bug where any
/// HTTP-200 was treated as success even when the body carried a JSON-RPC error.
async fn submit_tx_strict(rpc_url: &str, tx: &zebvix_node::types::SignedTx) -> Result<String> {
    let req = serde_json::json!({
        "jsonrpc":"2.0","id":1,"method":"zbx_sendTransaction","params":[tx]
    });
    let resp = http_post(rpc_url, &req).await?;
    if let Some(err) = resp.get("error") {
        let code = err.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
        let msg = err.get("message").and_then(|m| m.as_str()).unwrap_or("(no message)");
        return Err(anyhow!("RPC error {code}: {msg}"));
    }
    Ok(resp.get("result").and_then(|r| r.as_str()).unwrap_or("?").to_string())
}

async fn cmd_validator_add(
    signer_key: PathBuf,
    pubkey_hex: String,
    power: u64,
    rpc_url: String,
    fee: String,
) -> Result<()> {
    if power == 0 { return Err(anyhow!("voting power must be > 0")); }
    let (sk, pk) = read_keyfile(&signer_key)?;
    let from = address_from_pubkey(&pk);
    let val_pk = parse_pubkey_hex(&pubkey_hex)?;
    let val_addr = address_from_pubkey(&val_pk);
    let fee_wei = parse_zbx_amount(&fee)?;
    if fee_wei < tokenomics::MIN_TX_FEE_WEI {
        return Err(anyhow!(
            "fee {} wei below MIN_TX_FEE_WEI {} wei (≈0.00105 ZBX) — pass --fee 0.002 or higher",
            fee_wei, tokenomics::MIN_TX_FEE_WEI
        ));
    }

    let nonce = reqwest_get_nonce(&rpc_url, &from).await?;
    let body = TxBody {
        from, to: Address::ZERO, amount: 0, nonce, fee: fee_wei,
        chain_id: CHAIN_ID,
        kind: TxKind::ValidatorAdd { pubkey: val_pk, power },
    };
    let tx = sign_tx(&sk, body);
    println!("📝 Submitting validator-add tx for {} (power={})", val_addr, power);
    println!("   signer (must be admin) : {}", from);
    println!("   nonce / fee            : {} / {} wei", nonce, fee_wei);
    let tx_hash = submit_tx_strict(&rpc_url, &tx).await?;
    println!("   ✓ tx hash              : {}", tx_hash);
    println!();
    println!("✓ Tx accepted into mempool. Once next block is committed,");
    println!("  every node applies the change → registry converges chain-wide.");
    Ok(())
}

async fn cmd_validator_remove(
    signer_key: PathBuf,
    address_hex: String,
    rpc_url: String,
    fee: String,
) -> Result<()> {
    let (sk, pk) = read_keyfile(&signer_key)?;
    let from = address_from_pubkey(&pk);
    let target = Address::from_hex(&address_hex)?;
    let fee_wei = parse_zbx_amount(&fee)?;
    if fee_wei < tokenomics::MIN_TX_FEE_WEI {
        return Err(anyhow!(
            "fee {} wei below MIN_TX_FEE_WEI {} wei (≈0.00105 ZBX) — pass --fee 0.002 or higher",
            fee_wei, tokenomics::MIN_TX_FEE_WEI
        ));
    }

    let nonce = reqwest_get_nonce(&rpc_url, &from).await?;
    let body = TxBody {
        from, to: Address::ZERO, amount: 0, nonce, fee: fee_wei,
        chain_id: CHAIN_ID,
        kind: TxKind::ValidatorRemove { address: target },
    };
    let tx = sign_tx(&sk, body);
    println!("📝 Submitting validator-remove tx for {}", target);
    println!("   signer (must be admin) : {}", from);
    let tx_hash = submit_tx_strict(&rpc_url, &tx).await?;
    println!("   ✓ tx hash              : {}", tx_hash);
    Ok(())
}

fn cmd_admin_info(home: PathBuf) -> Result<()> {
    let state = State::open(&home.join("data"))?;
    let current = state.current_admin();
    let genesis = zebvix_node::state::admin_address();
    let used = state.admin_change_count();
    let remaining = state.admin_changes_remaining();
    println!("👑 Admin / Founder address info");
    println!();
    println!("   Current admin    : {}", current);
    println!("   Genesis admin    : {}{}", genesis,
        if current == genesis { "  (unchanged)" } else { "" });
    println!("   Rotations used   : {} of {} max", used, tokenomics::MAX_ADMIN_CHANGES);
    println!("   Rotations left   : {}", remaining);
    if remaining == 0 {
        println!("   Status           : 🔒 LOCKED — cannot rotate further");
    } else {
        println!("   Status           : ✅ rotatable ({} remaining)", remaining);
    }
    Ok(())
}

// ─────────────────────── Phase B.3.2 / B.4 — Governor + Staking CLI ───────────────────────

fn parse_u128_amount(s: &str) -> Result<u128> { parse_zbx_amount(s) }

fn check_fee(fee_wei: u128) -> Result<()> {
    if fee_wei < tokenomics::MIN_TX_FEE_WEI {
        return Err(anyhow!(
            "fee {} wei below MIN_TX_FEE_WEI {} wei (≈0.00105 ZBX) — pass --fee 0.002 or higher",
            fee_wei, tokenomics::MIN_TX_FEE_WEI
        ));
    }
    Ok(())
}

async fn rpc_call(rpc_url: &str, method: &str, params: serde_json::Value) -> Result<serde_json::Value> {
    let req = serde_json::json!({ "jsonrpc":"2.0","id":1,"method":method,"params":params });
    let resp = http_post(rpc_url, &req).await?;
    if let Some(e) = resp.get("error") {
        return Err(anyhow!("RPC error: {}", e));
    }
    Ok(resp.get("result").cloned().unwrap_or(serde_json::Value::Null))
}

async fn cmd_governor_info(rpc_url: String) -> Result<()> {
    let r = rpc_call(&rpc_url, "zbx_getGovernor", serde_json::json!([])).await?;
    println!("🏛️  Governor (validator-set authority) info");
    println!();
    println!("   Current governor : {}", r["current_governor"].as_str().unwrap_or("?"));
    println!("   Genesis governor : {}", r["genesis_governor"].as_str().unwrap_or("?"));
    println!("   Rotations used   : {} of {}",
        r["changes_used"].as_u64().unwrap_or(0),
        r["max_changes"].as_u64().unwrap_or(0));
    println!("   Rotations left   : {}", r["changes_remaining"].as_u64().unwrap_or(0));
    println!("   Status           : {}", if r["locked"].as_bool().unwrap_or(false) { "🔒 LOCKED" } else { "✅ rotatable" });
    Ok(())
}

async fn cmd_governor_change(signer_key: PathBuf, new_governor: String, rpc_url: String, fee: String) -> Result<()> {
    let (sk, pk) = read_keyfile(&signer_key)?;
    let from = address_from_pubkey(&pk);
    let new_gov = Address::from_hex(&new_governor)?;
    let fee_wei = parse_zbx_amount(&fee)?;
    check_fee(fee_wei)?;
    let nonce = reqwest_get_nonce(&rpc_url, &from).await?;
    let body = TxBody {
        from, to: Address::ZERO, amount: 0, nonce, fee: fee_wei,
        chain_id: CHAIN_ID,
        kind: TxKind::GovernorChange { new_governor: new_gov },
    };
    let tx = sign_tx(&sk, body);
    println!("📝 Governor change → {} (signer: {})", new_gov, from);
    let h = submit_tx_strict(&rpc_url, &tx).await?;
    println!("   ✓ tx hash : {}", h);
    Ok(())
}

async fn cmd_staking_info(rpc_url: String) -> Result<()> {
    let r = rpc_call(&rpc_url, "zbx_getStaking", serde_json::json!([])).await?;
    println!("🥩 Staking module state");
    println!();
    println!("   Current epoch         : {}", r["current_epoch"].as_u64().unwrap_or(0));
    println!("   Epoch length          : {} blocks", r["epoch_blocks"].as_u64().unwrap_or(0));
    println!("   Epoch reward          : {} wei", r["epoch_reward_wei"].as_str().unwrap_or("0"));
    println!("   Unbonding epochs      : {}", r["unbonding_epochs"].as_u64().unwrap_or(0));
    println!("   Min self-bond (fallback): {} wei", r["min_self_bond_wei"].as_str().unwrap_or("0"));
    println!("   Min self-bond (target USD): ${:.2}",
        r["min_self_bond_usd_micro"].as_u64().unwrap_or(0) as f64 / 1e6);
    println!("   Min self-bond (live $50≡): {} wei", r["min_self_bond_dynamic_wei"].as_str().unwrap_or("0"));
    println!("   Min delegation        : {} wei", r["min_delegation_wei"].as_str().unwrap_or("0"));
    println!("   Max commission        : {} bps", r["max_commission_bps"].as_u64().unwrap_or(0));
    println!("   Max commission Δ/epoch: {} bps", r["max_commission_delta_bps"].as_u64().unwrap_or(0));
    println!("   Total slashed         : {} wei", r["total_slashed_wei"].as_str().unwrap_or("0"));
    println!();
    println!("   Validators            : {}", r["validator_count"].as_u64().unwrap_or(0));
    println!("   Delegations           : {}", r["delegation_count"].as_u64().unwrap_or(0));
    println!("   Unbonding entries     : {}", r["unbonding_count"].as_u64().unwrap_or(0));
    if let Some(arr) = r["validators"].as_array() {
        for v in arr {
            println!();
            println!("   • Validator {}", v["address"].as_str().unwrap_or("?"));
            println!("       operator       : {}", v["operator"].as_str().unwrap_or("?"));
            println!("       total stake    : {} wei", v["total_stake_wei"].as_str().unwrap_or("0"));
            println!("       total shares   : {}", v["total_shares"].as_str().unwrap_or("0"));
            println!("       commission     : {} bps", v["commission_bps"].as_u64().unwrap_or(0));
            println!("       commission pool: {} wei", v["commission_pool_wei"].as_str().unwrap_or("0"));
            println!("       jailed         : {}", v["jailed"].as_bool().unwrap_or(false));
        }
    }
    if let Some(arr) = r["unbonding_queue"].as_array() {
        if !arr.is_empty() {
            println!();
            println!("   Unbonding queue:");
            for u in arr {
                println!("     - {} → {}: {} wei (matures epoch {})",
                    u["delegator"].as_str().unwrap_or("?"),
                    u["validator"].as_str().unwrap_or("?"),
                    u["amount_wei"].as_str().unwrap_or("0"),
                    u["mature_at_epoch"].as_u64().unwrap_or(0));
            }
        }
    }
    Ok(())
}

async fn cmd_staking_validator(address: String, rpc_url: String) -> Result<()> {
    let r = rpc_call(&rpc_url, "zbx_getStakingValidator", serde_json::json!([address])).await?;
    if r.is_null() {
        println!("(no staking validator at {})", address);
        return Ok(());
    }
    println!("🥩 Staking validator");
    println!("   address        : {}", r["address"].as_str().unwrap_or("?"));
    println!("   operator       : {}", r["operator"].as_str().unwrap_or("?"));
    println!("   pubkey         : {}", r["pubkey"].as_str().unwrap_or("?"));
    println!("   total stake    : {} wei", r["total_stake_wei"].as_str().unwrap_or("0"));
    println!("   total shares   : {}", r["total_shares"].as_str().unwrap_or("0"));
    println!("   commission     : {} bps", r["commission_bps"].as_u64().unwrap_or(0));
    println!("   commission pool: {} wei", r["commission_pool_wei"].as_str().unwrap_or("0"));
    println!("   jailed         : {} (until epoch {})",
        r["jailed"].as_bool().unwrap_or(false),
        r["jailed_until_epoch"].as_u64().unwrap_or(0));
    Ok(())
}

async fn cmd_delegation(delegator: String, validator: String, rpc_url: String) -> Result<()> {
    let r = rpc_call(&rpc_url, "zbx_getDelegation", serde_json::json!([delegator, validator])).await?;
    println!("🤝 Delegation");
    println!("   delegator : {}", r["delegator"].as_str().unwrap_or("?"));
    println!("   validator : {}", r["validator"].as_str().unwrap_or("?"));
    println!("   shares    : {}", r["shares"].as_str().unwrap_or("0"));
    println!("   value     : {} wei", r["value_wei"].as_str().unwrap_or("0"));
    Ok(())
}

fn parse_u128_raw(s: &str) -> Result<u128> {
    s.trim().parse::<u128>().map_err(|e| anyhow!("invalid integer: {e}"))
}

async fn submit_staking(
    signer_key: &PathBuf,
    rpc_url: &str,
    fee_str: &str,
    op: zebvix_node::staking::StakeOp,
    label: &str,
) -> Result<()> {
    let (sk, pk) = read_keyfile(signer_key)?;
    let from = address_from_pubkey(&pk);
    let fee_wei = parse_zbx_amount(fee_str)?;
    check_fee(fee_wei)?;
    let nonce = reqwest_get_nonce(rpc_url, &from).await?;
    let body = TxBody {
        from, to: Address::ZERO, amount: 0, nonce, fee: fee_wei,
        chain_id: CHAIN_ID, kind: TxKind::Staking(op),
    };
    let tx = sign_tx(&sk, body);
    println!("📝 {} (signer: {}, nonce: {})", label, from, nonce);
    let h = submit_tx_strict(rpc_url, &tx).await?;
    println!("   ✓ tx hash : {}", h);
    Ok(())
}

async fn cmd_validator_create(
    signer_key: PathBuf, pubkey: String, commission_bps: u64,
    self_bond: String, rpc_url: String, fee: String,
) -> Result<()> {
    let pk = parse_pubkey_hex(&pubkey)?;
    let bond = parse_u128_amount(&self_bond)?;
    submit_staking(&signer_key, &rpc_url, &fee,
        zebvix_node::staking::StakeOp::CreateValidator { pubkey: pk, commission_bps, self_bond: bond },
        &format!("CreateValidator (commission={}bps, self_bond={} wei)", commission_bps, bond)).await
}

async fn cmd_validator_edit_commission(
    signer_key: PathBuf, validator: String, new_commission_bps: u64,
    rpc_url: String, fee: String,
) -> Result<()> {
    let v = Address::from_hex(&validator)?;
    submit_staking(&signer_key, &rpc_url, &fee,
        zebvix_node::staking::StakeOp::EditValidator { validator: v, new_commission_bps: Some(new_commission_bps) },
        &format!("EditValidator(commission={}bps) for {}", new_commission_bps, v)).await
}

async fn cmd_stake(
    signer_key: PathBuf, validator: String, amount: String,
    rpc_url: String, fee: String,
) -> Result<()> {
    let v = Address::from_hex(&validator)?;
    let amt = parse_u128_amount(&amount)?;
    submit_staking(&signer_key, &rpc_url, &fee,
        zebvix_node::staking::StakeOp::Stake { validator: v, amount: amt },
        &format!("Stake {} wei → {}", amt, v)).await
}

async fn cmd_unstake(
    signer_key: PathBuf, validator: String, shares: String,
    rpc_url: String, fee: String,
) -> Result<()> {
    let v = Address::from_hex(&validator)?;
    let s = parse_u128_raw(&shares)?;
    submit_staking(&signer_key, &rpc_url, &fee,
        zebvix_node::staking::StakeOp::Unstake { validator: v, shares: s },
        &format!("Unstake {} shares from {}", s, v)).await
}

async fn cmd_redelegate(
    signer_key: PathBuf, from: String, to: String, shares: String,
    rpc_url: String, fee: String,
) -> Result<()> {
    let f = Address::from_hex(&from)?;
    let t = Address::from_hex(&to)?;
    let s = parse_u128_raw(&shares)?;
    submit_staking(&signer_key, &rpc_url, &fee,
        zebvix_node::staking::StakeOp::Redelegate { from: f, to: t, shares: s },
        &format!("Redelegate {} shares: {} → {}", s, f, t)).await
}

async fn cmd_claim_rewards(
    signer_key: PathBuf, validator: String, rpc_url: String, fee: String,
) -> Result<()> {
    let v = Address::from_hex(&validator)?;
    submit_staking(&signer_key, &rpc_url, &fee,
        zebvix_node::staking::StakeOp::ClaimRewards { validator: v },
        &format!("ClaimRewards from {}", v)).await
}
