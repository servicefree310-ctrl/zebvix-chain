mod consensus;
mod crypto;
mod mempool;
mod rpc;
mod state;
mod tokenomics;
mod types;

use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};
use consensus::Producer;
use crypto::{address_from_pubkey, generate_keypair, keypair_from_secret, sign_tx};
use mempool::Mempool;
use serde::{Deserialize, Serialize};
use state::State;
use std::path::PathBuf;
use std::sync::Arc;
use tokenomics::{CHAIN_ID, TOTAL_SUPPLY_WEI, WEI_PER_ZBX};
use types::{Address, TxBody};

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
        /// Pre-mine allocation: `addr:amount_zbx` (repeatable). Default = none.
        #[arg(long)]
        alloc: Vec<String>,
    },
    /// Start the node (block producer + JSON-RPC).
    Start {
        #[arg(long, default_value = "./.zebvix")]
        home: PathBuf,
        #[arg(long, default_value = "0.0.0.0:8545")]
        rpc: String,
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

fn cmd_init(home: PathBuf, validator_key: PathBuf, alloc: Vec<String>) -> Result<()> {
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

    // Init state with allocations
    let state = State::open(&data_dir)?;
    if state.tip().0 == 0 {
        state.genesis_credit(&alloc_pairs)?;
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

async fn cmd_start(home: PathBuf, rpc_addr: String) -> Result<()> {
    let cfg_path = home.join("node.json");
    let cfg: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&cfg_path)?)?;
    let key_path = PathBuf::from(
        cfg["validator_key_file"].as_str().ok_or_else(|| anyhow!("validator_key_file missing"))?
    );
    let (sk, pk) = read_keyfile(&key_path)?;
    let proposer = address_from_pubkey(&pk);

    let state = Arc::new(State::open(&home.join("data"))?);
    let mempool = Arc::new(Mempool::new(state.clone(), 50_000));
    let producer = Arc::new(Producer::new(sk, state.clone(), mempool.clone()));

    tracing::info!("🚀 Zebvix node starting");
    tracing::info!("   chain_id  : {}", CHAIN_ID);
    tracing::info!("   proposer  : {}", proposer);
    tracing::info!("   tip       : height={} hash={}", state.tip().0, state.tip().1);
    tracing::info!("   rpc       : http://{}", rpc_addr);

    // Spawn producer
    tokio::spawn(producer.clone().run());

    // RPC server
    let ctx = rpc::RpcCtx { state: state.clone(), mempool: mempool.clone() };
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
    let body = TxBody { from, to, amount: amount_wei, nonce: client, fee: fee_wei, chain_id: CHAIN_ID };
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
    let client = std::sync::Arc::new(tokio::sync::OnceCell::new());
    let _ = client;
    // simple manual HTTP via tokio + axum? Easier: use minimal reqwest-style with hyper.
    // To avoid extra dep, use std with ureq-style? Just include reqwest? Simpler: spawn a tcp call.
    // Use a tiny TCP-based JSON-RPC POST.
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

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "zebvix_node=info".into()))
        .init();
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Keygen { out } => cmd_keygen(out),
        Cmd::Init { home, validator_key, alloc } => cmd_init(home, validator_key, alloc),
        Cmd::Start { home, rpc } => cmd_start(home, rpc).await,
        Cmd::Send { from_key, to, amount, fee, rpc } => cmd_send(from_key, to, amount, fee, rpc).await,
    }
}
