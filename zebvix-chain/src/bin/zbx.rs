use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use zebvix_node::crypto::{address_from_pubkey, generate_keypair, keypair_from_secret, sign_tx};
use zebvix_node::tokenomics::{
    CHAIN_ID, MIN_GAS_PRICE_WEI, MIN_GAS_UNITS, MIN_TX_FEE_WEI, STANDARD_TX_FEE_WEI, WEI_PER_ZBX,
};
use zebvix_node::types::{Address, TxBody};

const C_RESET: &str = "\x1b[0m";
const C_BOLD: &str = "\x1b[1m";
const C_GREEN: &str = "\x1b[32m";
const C_CYAN: &str = "\x1b[36m";
const C_YELLOW: &str = "\x1b[33m";
const C_RED: &str = "\x1b[31m";
const C_DIM: &str = "\x1b[2m";
const C_MAGENTA: &str = "\x1b[35m";

#[derive(Parser)]
#[command(
    name = "zbx",
    version,
    about = "Zebvix wallet & explorer CLI — talk to a Zebvix L1 node",
    long_about = "zbx — friendly wallet/explorer CLI for Zebvix L1.\n\nDefault RPC: http://127.0.0.1:8545 (override with --rpc or env ZBX_RPC)"
)]
struct Cli {
    /// JSON-RPC endpoint of a running Zebvix node.
    #[arg(long, global = true, env = "ZBX_RPC", default_value = "http://127.0.0.1:8545")]
    rpc: String,

    /// Quiet output — JSON only, no colors or banners.
    #[arg(long, short, global = true)]
    quiet: bool,

    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Create a brand new wallet (keypair) and save to file.
    New {
        /// Output keyfile path. Default: ./wallet.key
        #[arg(long, short, default_value = "./wallet.key")]
        out: PathBuf,
        /// Overwrite if file exists.
        #[arg(long, short)]
        force: bool,
    },
    /// Show address & pubkey of an existing keyfile.
    Show {
        /// Path to keyfile.
        keyfile: PathBuf,
    },
    /// Print just the address of a keyfile (alias of `show`, address only).
    Address {
        /// Path to keyfile.
        keyfile: PathBuf,
    },
    /// Import a wallet from a raw 64-char hex secret key.
    Import {
        /// 64-char hex secret key (with or without 0x prefix).
        secret_hex: String,
        /// Output keyfile path.
        #[arg(long, short, default_value = "./wallet.key")]
        out: PathBuf,
    },
    /// Get ZBX balance of an address.
    Balance {
        /// 0x-prefixed 20-byte address.
        address: String,
    },
    /// Get current pending nonce of an address.
    Nonce {
        address: String,
    },
    /// Send ZBX from a wallet to an address.
    Send {
        /// Sender keyfile.
        #[arg(long, short)]
        from: PathBuf,
        /// Recipient address.
        #[arg(long, short)]
        to: String,
        /// Amount in ZBX (decimals OK, e.g. 1.5).
        #[arg(long, short)]
        amount: String,
        /// Gas fee in ZBX (default: 0.001 ZBX = minimum). Goes to block proposer.
        #[arg(long)]
        fee: Option<String>,
        /// Skip the confirmation prompt.
        #[arg(long, short)]
        yes: bool,
    },
    /// Show chain tip (latest block height & hash).
    Tip,
    /// Show node info: chain id, block time, supply.
    Info,
    /// Get a block by height.
    Block {
        height: u64,
    },
    /// Show ZBX supply summary (total / circulating / pre-mine).
    Supply,
    /// Show node sync/peer status.
    Status,
    /// Show on-chain AMM pool state (ZBX/zUSD reserves, price, fee, loan, fees).
    Pool,
    /// Swap ZBX → zUSD by sending to the pool address (one-shot helper).
    /// Equivalent to `zbx send --to <POOL_ADDRESS> --amount <N>`.
    Swap {
        #[arg(long)]
        from: PathBuf,
        /// Amount of ZBX to swap (decimals allowed).
        #[arg(long)]
        amount: String,
        #[arg(long, default_value = "0")]
        fee: String,
        #[arg(long)]
        yes: bool,
    },
    /// Show current ZBX/USD price (from on-chain pool oracle).
    Price,
    /// Show network's current dynamic gas price + fee per standard transfer.
    Gas,
    /// Show zUSD balance of an address.
    Zusd {
        address: String,
    },
    /// Show LP (liquidity-provider) token balance of an address.
    Lp {
        address: String,
    },
    /// Faucet-style helper: print common testnet info.
    Help,
}

#[derive(Serialize, Deserialize)]
struct KeyFile {
    secret_hex: String,
    pubkey_hex: String,
    address: String,
}

fn parse_zbx_amount(s: &str) -> Result<u128> {
    let s = s.trim();
    if let Some(dot) = s.find('.') {
        let (whole, frac) = s.split_at(dot);
        let frac = &frac[1..];
        if frac.len() > 18 { return Err(anyhow!("max 18 decimals allowed")); }
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

fn format_zbx(wei: u128) -> String {
    let whole = wei / WEI_PER_ZBX;
    let frac = wei % WEI_PER_ZBX;
    if frac == 0 {
        format!("{}", whole)
    } else {
        let frac_str = format!("{:018}", frac);
        let trimmed = frac_str.trim_end_matches('0');
        format!("{}.{}", whole, trimmed)
    }
}

fn write_keyfile(path: &PathBuf, secret: &[u8; 32], pubkey: &[u8; 32], force: bool) -> Result<Address> {
    if path.exists() && !force {
        return Err(anyhow!("{} already exists. Use --force to overwrite.", path.display()));
    }
    let addr = address_from_pubkey(pubkey);
    let kf = KeyFile {
        secret_hex: hex::encode(secret),
        pubkey_hex: hex::encode(pubkey),
        address: addr.to_hex(),
    };
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() { std::fs::create_dir_all(parent).ok(); }
    }
    std::fs::write(path, serde_json::to_string_pretty(&kf)?)?;
    Ok(addr)
}

fn read_keyfile(path: &PathBuf) -> Result<([u8; 32], [u8; 32])> {
    let s = std::fs::read_to_string(path)
        .map_err(|e| anyhow!("can't read {}: {}", path.display(), e))?;
    let kf: KeyFile = serde_json::from_str(&s)?;
    let sk = hex::decode(kf.secret_hex.trim_start_matches("0x"))?;
    if sk.len() != 32 { return Err(anyhow!("bad secret length")); }
    let mut sec = [0u8; 32];
    sec.copy_from_slice(&sk);
    let (sk_b, pk) = keypair_from_secret(&sec);
    Ok((sk_b, pk))
}

async fn rpc_call(url: &str, method: &str, params: serde_json::Value) -> Result<serde_json::Value> {
    let url = url.trim_end_matches('/');
    let parsed = url.strip_prefix("http://").ok_or_else(|| anyhow!("only http:// urls supported"))?;
    let (host_port, path) = match parsed.find('/') {
        Some(i) => (&parsed[..i], &parsed[i..]),
        None => (parsed, "/"),
    };
    let body = serde_json::json!({
        "jsonrpc":"2.0","id":1,"method":method,"params":params
    });
    let body_str = serde_json::to_string(&body)?;
    let req = format!(
        "POST {path} HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n{body}",
        path = path, host = host_port, len = body_str.len(), body = body_str
    );
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut sock = tokio::net::TcpStream::connect(host_port).await
        .map_err(|e| anyhow!("can't reach node at {}: {}", host_port, e))?;
    sock.write_all(req.as_bytes()).await?;
    let mut buf = Vec::new();
    sock.read_to_end(&mut buf).await?;
    let s = String::from_utf8_lossy(&buf);
    let body_start = s.find("\r\n\r\n").ok_or_else(|| anyhow!("malformed http response"))?;
    let json_str = &s[body_start + 4..];
    let v: serde_json::Value = serde_json::from_str(json_str.trim())
        .map_err(|e| anyhow!("bad json from node: {} | raw: {}", e, json_str))?;
    if let Some(err) = v.get("error") {
        return Err(anyhow!("rpc error: {}", err));
    }
    Ok(v["result"].clone())
}

fn hex_to_u128(s: &str) -> Result<u128> {
    let s = s.trim_start_matches("0x");
    if s.is_empty() { return Ok(0); }
    u128::from_str_radix(s, 16).map_err(|e| anyhow!("bad hex: {}", e))
}

fn print_banner(quiet: bool) {
    if quiet { return; }
    println!("{}{}╔══════════════════════════════════╗{}", C_BOLD, C_CYAN, C_RESET);
    println!("{}{}║   Zebvix L1 — zbx wallet CLI    ║{}", C_BOLD, C_CYAN, C_RESET);
    println!("{}{}╚══════════════════════════════════╝{}", C_BOLD, C_CYAN, C_RESET);
}

async fn cmd_new(out: PathBuf, force: bool, quiet: bool) -> Result<()> {
    let (sk, pk) = generate_keypair();
    let addr = write_keyfile(&out, &sk, &pk, force)?;
    if quiet {
        println!("{}", serde_json::json!({
            "address": addr.to_hex(),
            "pubkey": format!("0x{}", hex::encode(pk)),
            "keyfile": out.display().to_string(),
        }));
    } else {
        print_banner(quiet);
        println!();
        println!("{}{}✓ New wallet created!{}", C_BOLD, C_GREEN, C_RESET);
        println!();
        println!("  {}Address  :{} {}{}{}", C_DIM, C_RESET, C_CYAN, addr.to_hex(), C_RESET);
        println!("  {}Pubkey   :{} 0x{}", C_DIM, C_RESET, hex::encode(pk));
        println!("  {}Keyfile  :{} {}", C_DIM, C_RESET, out.display());
        println!();
        println!("  {}{}⚠  Backup the keyfile! Anyone with it controls your ZBX.{}", C_BOLD, C_YELLOW, C_RESET);
    }
    Ok(())
}

fn cmd_show(keyfile: PathBuf, quiet: bool) -> Result<()> {
    let (_, pk) = read_keyfile(&keyfile)?;
    let addr = address_from_pubkey(&pk);
    if quiet {
        println!("{}", serde_json::json!({
            "address": addr.to_hex(),
            "pubkey": format!("0x{}", hex::encode(pk)),
        }));
    } else {
        println!("  {}Address :{} {}{}{}", C_DIM, C_RESET, C_CYAN, addr.to_hex(), C_RESET);
        println!("  {}Pubkey  :{} 0x{}", C_DIM, C_RESET, hex::encode(pk));
        println!("  {}Keyfile :{} {}", C_DIM, C_RESET, keyfile.display());
    }
    Ok(())
}

fn cmd_import(secret_hex: String, out: PathBuf, quiet: bool) -> Result<()> {
    let s = secret_hex.trim_start_matches("0x");
    let bytes = hex::decode(s).map_err(|_| anyhow!("invalid hex"))?;
    if bytes.len() != 32 { return Err(anyhow!("secret must be 32 bytes (64 hex chars)")); }
    let mut sec = [0u8; 32];
    sec.copy_from_slice(&bytes);
    let (sk, pk) = keypair_from_secret(&sec);
    let addr = write_keyfile(&out, &sk, &pk, false)?;
    if quiet {
        println!("{}", serde_json::json!({"address": addr.to_hex(), "keyfile": out.display().to_string()}));
    } else {
        println!("  {}{}✓ Imported wallet → {}{}", C_BOLD, C_GREEN, addr.to_hex(), C_RESET);
        println!("  Saved to {}", out.display());
    }
    Ok(())
}

async fn cmd_balance(rpc: &str, address: String, quiet: bool) -> Result<()> {
    let addr = Address::from_hex(&address)?;
    let result = rpc_call(rpc, "eth_getBalance", serde_json::json!([addr.to_hex(), "latest"])).await?;
    let hex_str = result.as_str().ok_or_else(|| anyhow!("expected hex string"))?;
    let wei = hex_to_u128(hex_str)?;
    // zUSD balance (best-effort: older nodes may not expose this RPC)
    let zusd_wei: u128 = match rpc_call(rpc, "zbx_getZusdBalance", serde_json::json!([addr.to_hex()])).await {
        Ok(v) => v.as_str().unwrap_or("0").parse::<u128>().unwrap_or(0),
        Err(_) => 0,
    };
    if quiet {
        println!("{}", serde_json::json!({
            "address": addr.to_hex(),
            "wei": wei.to_string(),
            "zbx": format_zbx(wei),
            "zusd_wei": zusd_wei.to_string(),
            "zusd": format_zbx(zusd_wei),
        }));
    } else {
        println!("  {}Address :{} {}", C_DIM, C_RESET, addr.to_hex());
        println!("  {}ZBX     :{} {}{} ZBX{}", C_DIM, C_RESET, C_BOLD, format_zbx(wei), C_RESET);
        println!("  {}zUSD    :{} {}{} zUSD{}", C_DIM, C_RESET, C_BOLD, format_zbx(zusd_wei), C_RESET);
        println!("  {}Wei     :{} {}", C_DIM, C_RESET, wei);
    }
    Ok(())
}

async fn cmd_nonce(rpc: &str, address: String, quiet: bool) -> Result<()> {
    let addr = Address::from_hex(&address)?;
    let result = rpc_call(rpc, "zbx_getNonce", serde_json::json!([addr.to_hex()])).await?;
    let n = result.as_u64().unwrap_or(0);
    if quiet {
        println!("{}", serde_json::json!({"address": addr.to_hex(), "nonce": n}));
    } else {
        println!("  {}Address :{} {}", C_DIM, C_RESET, addr.to_hex());
        println!("  {}Nonce   :{} {}{}{}", C_DIM, C_RESET, C_BOLD, n, C_RESET);
    }
    Ok(())
}

async fn cmd_send(rpc: &str, from: PathBuf, to: String, amount: String, fee: Option<String>, yes: bool, quiet: bool) -> Result<()> {
    let (sk, pk) = read_keyfile(&from)?;
    let from_addr = address_from_pubkey(&pk);
    let to_addr = Address::from_hex(&to)?;
    let amount_wei = parse_zbx_amount(&amount)?;
    let fee_wei = match fee {
        Some(s) => {
            let f = parse_zbx_amount(&s)?;
            if f < MIN_TX_FEE_WEI {
                return Err(anyhow!(
                    "fee {} ZBX is below network minimum {} ZBX (21000 gas × 50 gwei)",
                    format_zbx(f),
                    format_zbx(MIN_TX_FEE_WEI)
                ));
            }
            f
        }
        None => STANDARD_TX_FEE_WEI,
    };

    if !quiet {
        println!();
        println!("{}{}─── Transaction preview ───{}", C_BOLD, C_MAGENTA, C_RESET);
        println!("  {}From   :{} {}", C_DIM, C_RESET, from_addr.to_hex());
        println!("  {}To     :{} {}", C_DIM, C_RESET, to_addr.to_hex());
        println!("  {}Amount :{} {}{} ZBX{}", C_DIM, C_RESET, C_BOLD, format_zbx(amount_wei), C_RESET);
        println!("  {}Fee    :{} {} ZBX", C_DIM, C_RESET, format_zbx(fee_wei));
        println!("  {}Chain  :{} {}", C_DIM, C_RESET, CHAIN_ID);
        println!();
    }

    if !yes && !quiet {
        use std::io::{self, Write};
        print!("{}Confirm? [y/N]: {}", C_YELLOW, C_RESET);
        io::stdout().flush().ok();
        let mut input = String::new();
        io::stdin().read_line(&mut input)?;
        let t = input.trim().to_lowercase();
        if t != "y" && t != "yes" {
            println!("{}cancelled.{}", C_RED, C_RESET);
            return Ok(());
        }
    }

    let nonce_v = rpc_call(rpc, "zbx_getNonce", serde_json::json!([from_addr.to_hex()])).await?;
    let nonce = nonce_v.as_u64().unwrap_or(0);

    let body = TxBody {
        from: from_addr, to: to_addr,
        amount: amount_wei, nonce, fee: fee_wei, chain_id: CHAIN_ID,
    };
    let tx = sign_tx(&sk, body);

    let result = rpc_call(rpc, "zbx_sendTransaction", serde_json::json!([tx])).await?;
    let hash = result.as_str().unwrap_or("?");

    if quiet {
        println!("{}", serde_json::json!({
            "tx_hash": hash, "from": from_addr.to_hex(), "to": to_addr.to_hex(),
            "amount_zbx": format_zbx(amount_wei), "nonce": nonce,
        }));
    } else {
        println!();
        println!("  {}{}✓ Submitted!{}", C_BOLD, C_GREEN, C_RESET);
        println!("  {}Tx hash :{} {}{}{}", C_DIM, C_RESET, C_CYAN, hash, C_RESET);
        println!("  {}Nonce   :{} {}", C_DIM, C_RESET, nonce);
        println!();
        println!("  {}Wait ~5 sec for next block, then:{}", C_DIM, C_RESET);
        println!("    zbx balance {}", to_addr.to_hex());
    }
    Ok(())
}

async fn cmd_tip(rpc: &str, quiet: bool) -> Result<()> {
    let h = rpc_call(rpc, "eth_blockNumber", serde_json::json!([])).await?;
    let height = hex_to_u128(h.as_str().unwrap_or("0x0"))?;
    let block = rpc_call(rpc, "zbx_getBlockByNumber",
        serde_json::json!([height as u64])).await.unwrap_or(serde_json::Value::Null);
    let hash = block.get("hash").and_then(|x| x.as_str()).unwrap_or("?");
    if quiet {
        println!("{}", serde_json::json!({"height": height.to_string(), "hash": hash}));
    } else {
        println!("  {}Tip height :{} {}{}{}", C_DIM, C_RESET, C_BOLD, height, C_RESET);
        println!("  {}Tip hash   :{} {}", C_DIM, C_RESET, hash);
    }
    Ok(())
}

async fn cmd_info(rpc: &str, quiet: bool) -> Result<()> {
    let chain_id_v = rpc_call(rpc, "eth_chainId", serde_json::json!([])).await
        .unwrap_or(serde_json::json!(format!("0x{:x}", CHAIN_ID)));
    let chain_id = hex_to_u128(chain_id_v.as_str().unwrap_or("0x1ece"))?;
    let h = rpc_call(rpc, "eth_blockNumber", serde_json::json!([])).await?;
    let height = hex_to_u128(h.as_str().unwrap_or("0x0"))?;

    if quiet {
        println!("{}", serde_json::json!({
            "chain_id": chain_id, "chain_name": "Zebvix", "token": "ZBX",
            "block_time_secs": 5, "tip_height": height.to_string(),
            "rpc": rpc,
        }));
    } else {
        print_banner(quiet);
        println!();
        println!("  {}Chain      :{} Zebvix L1", C_DIM, C_RESET);
        println!("  {}Token      :{} {}ZBX{}", C_DIM, C_RESET, C_BOLD, C_RESET);
        println!("  {}Chain ID   :{} {}", C_DIM, C_RESET, chain_id);
        println!("  {}Block time :{} 5 sec", C_DIM, C_RESET);
        println!("  {}Gas units  :{} {} (per transfer, ETH-compatible)", C_DIM, C_RESET, MIN_GAS_UNITS);
        println!("  {}Gas price  :{} {} gwei (min)", C_DIM, C_RESET, MIN_GAS_PRICE_WEI / 1_000_000_000);
        println!("  {}Min fee    :{} {} ZBX", C_DIM, C_RESET, format_zbx(MIN_TX_FEE_WEI));
        println!("  {}Tip height :{} {}", C_DIM, C_RESET, height);
        println!("  {}RPC        :{} {}", C_DIM, C_RESET, rpc);
    }
    Ok(())
}

async fn cmd_block(rpc: &str, height: u64, quiet: bool) -> Result<()> {
    let block = rpc_call(rpc, "zbx_getBlockByNumber", serde_json::json!([height])).await?;
    if quiet {
        println!("{}", serde_json::to_string_pretty(&block)?);
    } else {
        let hash = block.get("hash").and_then(|x| x.as_str()).unwrap_or("?");
        let parent = block.get("parentHash").and_then(|x| x.as_str()).unwrap_or("?");
        let ts = block.get("timestamp").and_then(|x| x.as_str()).unwrap_or("0x0");
        let txs = block.get("transactions").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0);
        println!("  {}Block #{}{}", C_BOLD, height, C_RESET);
        println!("  {}Hash       :{} {}", C_DIM, C_RESET, hash);
        println!("  {}Parent     :{} {}", C_DIM, C_RESET, parent);
        println!("  {}Timestamp  :{} {} ({})", C_DIM, C_RESET, ts, hex_to_u128(ts).unwrap_or(0));
        println!("  {}Tx count   :{} {}", C_DIM, C_RESET, txs);
    }
    Ok(())
}

async fn cmd_supply(rpc: &str, quiet: bool) -> Result<()> {
    let total: u128 = 150_000_000;
    let premine: u128 = 10_000_000;
    let h = rpc_call(rpc, "eth_blockNumber", serde_json::json!([])).await?;
    let height = hex_to_u128(h.as_str().unwrap_or("0x0"))? as u64;
    // Bitcoin-style halving every ~210k blocks; initial reward 50 ZBX/block.
    let mut reward: u128 = 50;
    let mut mined: u128 = 0;
    let mut h_left = height;
    let halving_interval: u64 = 210_000;
    while h_left > 0 && reward > 0 {
        let chunk = h_left.min(halving_interval);
        mined += reward * chunk as u128;
        h_left -= chunk;
        reward /= 2;
    }
    let circulating = premine + mined;
    if quiet {
        println!("{}", serde_json::json!({
            "total_supply_zbx": total, "premine_zbx": premine,
            "mined_zbx": mined, "circulating_zbx": circulating,
            "remaining_zbx": total.saturating_sub(circulating),
            "tip_height": height,
        }));
    } else {
        println!("  {}Total supply  :{} {}{} ZBX{}", C_DIM, C_RESET, C_BOLD, total, C_RESET);
        println!("  {}Founder mine  :{} {} ZBX", C_DIM, C_RESET, premine);
        println!("  {}Mined so far  :{} {} ZBX (over {} blocks)", C_DIM, C_RESET, mined, height);
        println!("  {}Circulating   :{} {}{} ZBX{}", C_DIM, C_RESET, C_GREEN, circulating, C_RESET);
        println!("  {}Remaining     :{} {} ZBX", C_DIM, C_RESET, total.saturating_sub(circulating));
    }
    Ok(())
}

async fn cmd_status(rpc: &str, quiet: bool) -> Result<()> {
    let h = rpc_call(rpc, "eth_blockNumber", serde_json::json!([])).await;
    let alive = h.is_ok();
    let height = h.ok().and_then(|v| v.as_str().map(|s| s.to_string()))
        .and_then(|s| hex_to_u128(&s).ok()).unwrap_or(0);
    if quiet {
        println!("{}", serde_json::json!({"alive": alive, "tip_height": height.to_string(), "rpc": rpc}));
    } else {
        let dot = if alive { format!("{}● ONLINE{}", C_GREEN, C_RESET) } else { format!("{}● OFFLINE{}", C_RED, C_RESET) };
        println!("  {}Status :{} {}", C_DIM, C_RESET, dot);
        println!("  {}RPC    :{} {}", C_DIM, C_RESET, rpc);
        if alive {
            println!("  {}Height :{} {}", C_DIM, C_RESET, height);
        }
    }
    Ok(())
}

fn cmd_help_extra() {
    println!("{}{}Common workflows:{}", C_BOLD, C_CYAN, C_RESET);
    println!();
    println!("  {}# Create a new wallet{}", C_DIM, C_RESET);
    println!("  zbx new --out alice.key");
    println!();
    println!("  {}# Check chain status{}", C_DIM, C_RESET);
    println!("  zbx status");
    println!("  zbx info");
    println!();
    println!("  {}# Check balance{}", C_DIM, C_RESET);
    println!("  zbx balance 0xe381e1d0d8da56a984a6e65cbdd0a3932050fecc");
    println!();
    println!("  {}# Send ZBX{}", C_DIM, C_RESET);
    println!("  zbx send --from validator.key --to 0x000...001 --amount 100");
    println!();
    println!("  {}# Use remote node{}", C_DIM, C_RESET);
    println!("  zbx --rpc http://node.zebvix.io:8545 status");
    println!("  export ZBX_RPC=http://node.zebvix.io:8545");
    println!();
    println!("  {}# Quiet/JSON output for scripting{}", C_DIM, C_RESET);
    println!("  zbx -q balance 0xe381e1d0d8da56a984a6e65cbdd0a3932050fecc");
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let rpc = cli.rpc.clone();
    let q = cli.quiet;
    match cli.cmd {
        Cmd::New { out, force } => cmd_new(out, force, q).await?,
        Cmd::Show { keyfile } => cmd_show(keyfile, q)?,
        Cmd::Address { keyfile } => {
            let (_, pk) = read_keyfile(&keyfile)?;
            let addr = address_from_pubkey(&pk);
            println!("{}", addr.to_hex());
        }
        Cmd::Import { secret_hex, out } => cmd_import(secret_hex, out, q)?,
        Cmd::Balance { address } => cmd_balance(&rpc, address, q).await?,
        Cmd::Nonce { address } => cmd_nonce(&rpc, address, q).await?,
        Cmd::Send { from, to, amount, fee, yes } => cmd_send(&rpc, from, to, amount, fee, yes, q).await?,
        Cmd::Tip => cmd_tip(&rpc, q).await?,
        Cmd::Info => cmd_info(&rpc, q).await?,
        Cmd::Block { height } => cmd_block(&rpc, height, q).await?,
        Cmd::Supply => cmd_supply(&rpc, q).await?,
        Cmd::Status => cmd_status(&rpc, q).await?,
        Cmd::Pool => cmd_pool(&rpc, q).await?,
        Cmd::Swap { from, amount, fee, yes } => cmd_swap(&rpc, from, amount, fee, yes, q).await?,
        Cmd::Price => cmd_price(&rpc, q).await?,
        Cmd::Gas => cmd_gas(&rpc, q).await?,
        Cmd::Zusd { address } => cmd_zusd(&rpc, address, q).await?,
        Cmd::Lp { address } => cmd_lp(&rpc, address, q).await?,
        Cmd::Help => cmd_help_extra(),
    }
    Ok(())
}

async fn cmd_swap(rpc: &str, from: PathBuf, amount: String, fee: String, yes: bool, quiet: bool) -> Result<()> {
    // Resolve pool address from the chain.
    let r = rpc_call(rpc, "zbx_getPool", serde_json::json!([])).await?;
    let pool_addr = r["pool_address"].as_str().unwrap_or("").to_string();
    if pool_addr.is_empty() {
        anyhow::bail!("could not fetch pool address from RPC");
    }
    if !quiet {
        println!("{}🔄 Auto-swap: ZBX → zUSD via pool {}{}{}", C_CYAN, C_BOLD, pool_addr, C_RESET);
        println!("{}   You'll receive zUSD at current pool rate, returned to your wallet.{}", C_DIM, C_RESET);
    }
    cmd_send(rpc, from, pool_addr, amount, Some(fee), yes, quiet).await
}

async fn cmd_pool(rpc: &str, quiet: bool) -> Result<()> {
    let r = rpc_call(rpc, "zbx_getPool", serde_json::json!([])).await?;
    if quiet { println!("{}", r); return Ok(()); }
    let init = r["initialized"].as_bool().unwrap_or(false);
    if !init {
        println!("  {}❌ Pool not initialized yet.{}", C_YELLOW, C_RESET);
        println!("  Founder must run on the node:");
        println!("    {}zebvix-node admin-pool-genesis{}", C_DIM, C_RESET);
        return Ok(());
    }
    let zbx_r = r["zbx_reserve_wei"].as_str().unwrap_or("0").parse::<u128>().unwrap_or(0);
    let zusd_r = r["zusd_reserve"].as_str().unwrap_or("0").parse::<u128>().unwrap_or(0);
    let lp = r["lp_supply"].as_str().unwrap_or("0");
    let price = r["spot_price_usd_per_zbx"].as_str().unwrap_or("?");
    let pool_addr = r["pool_address"].as_str().unwrap_or("?");
    let loan = r["loan_outstanding_zusd"].as_str().unwrap_or("0").parse::<u128>().unwrap_or(0);
    let loan_repaid = r["loan_repaid"].as_bool().unwrap_or(false);
    let fee_zbx = r["fee_acc_zbx"].as_str().unwrap_or("0").parse::<u128>().unwrap_or(0);
    let fee_zusd = r["fee_acc_zusd"].as_str().unwrap_or("0").parse::<u128>().unwrap_or(0);
    let life_fees = r["lifetime_fees_zusd"].as_str().unwrap_or("0").parse::<u128>().unwrap_or(0);
    let life_admin = r["lifetime_admin_paid_zusd"].as_str().unwrap_or("0").parse::<u128>().unwrap_or(0);
    println!("  {}{}📊 zSwap AMM Pool — ZBX / zUSD  (permissionless){}", C_BOLD, C_MAGENTA, C_RESET);
    println!("  {}Pool addr    :{} {}{}{}", C_DIM, C_RESET, C_CYAN, pool_addr, C_RESET);
    println!("  {}ZBX reserve  :{} {}{} ZBX{}", C_DIM, C_RESET, C_BOLD, format_zbx(zbx_r), C_RESET);
    println!("  {}zUSD reserve :{} {}{} zUSD{}", C_DIM, C_RESET, C_BOLD, format_zbx(zusd_r), C_RESET);
    println!("  {}LP supply    :{} {} {}(locked to pool){}", C_DIM, C_RESET, lp, C_DIM, C_RESET);
    println!("  {}Spot price   :{} {}1 ZBX = ${}{}", C_DIM, C_RESET, C_GREEN, price, C_RESET);
    println!("  {}Pool fee     :{} 0.30% (input-deducted, sequestered)", C_DIM, C_RESET);
    println!("  {}Max per swap :{} {}{} ZBX{} or {}{} zUSD{}  {}(anti-whale){}",
        C_DIM, C_RESET, C_BOLD, r["max_swap_zbx"].as_str().unwrap_or("?"), C_RESET,
        C_BOLD, r["max_swap_zusd_display"].as_str().unwrap_or("?"), C_RESET,
        C_DIM, C_RESET);
    println!();
    if loan_repaid {
        println!("  {}💰 Loan       :{} {}✅ REPAID{} — admin earning 50% of fees",
            C_DIM, C_RESET, C_GREEN, C_RESET);
    } else {
        println!("  {}💰 Loan       :{} {}{} zUSD{} outstanding {}(repaid via fees){}",
            C_DIM, C_RESET, C_YELLOW, format_zbx(loan), C_RESET, C_DIM, C_RESET);
    }
    println!("  {}Fee bucket   :{} {} ZBX  +  {} zUSD  {}(pending settle){}",
        C_DIM, C_RESET, format_zbx(fee_zbx), format_zbx(fee_zusd), C_DIM, C_RESET);
    println!("  {}Lifetime fees:{} {} zUSD", C_DIM, C_RESET, format_zbx(life_fees));
    println!("  {}Admin earned :{} {} zUSD", C_DIM, C_RESET, format_zbx(life_admin));
    println!("  {}Init height  :{} {}", C_DIM, C_RESET, r["init_height"]);
    Ok(())
}

async fn cmd_price(rpc: &str, quiet: bool) -> Result<()> {
    let r = rpc_call(rpc, "zbx_getPriceUSD", serde_json::json!([])).await?;
    if quiet { println!("{}", r); return Ok(()); }
    let p = r["zbx_usd"].as_str().unwrap_or("0");
    let src = r["source"].as_str().unwrap_or("?");
    println!("  {}{}💰 ZBX Price (on-chain oracle){}", C_BOLD, C_GREEN, C_RESET);
    println!("  {}1 ZBX :{} {}${}{} USD", C_DIM, C_RESET, C_BOLD, p, C_RESET);
    println!("  {}Source:{} {}", C_DIM, C_RESET, src);
    Ok(())
}

async fn cmd_gas(rpc: &str, quiet: bool) -> Result<()> {
    let r = rpc_call(rpc, "zbx_estimateGas", serde_json::json!([])).await?;
    if quiet { println!("{}", r); return Ok(()); }
    let units = r["gas_units"].as_u64().unwrap_or(0);
    let gwei = r["gas_price_gwei"].as_str().unwrap_or("?");
    let fee_zbx = r["fee_zbx"].as_str().unwrap_or("?");
    let target_usd = r["target_usd"].as_str().unwrap_or("?");
    let pool_ok = r["pool_initialized"].as_bool().unwrap_or(false);
    println!("  {}{}⛽ Network Gas (dynamic){}", C_BOLD, C_CYAN, C_RESET);
    println!("  {}Gas units    :{} {}", C_DIM, C_RESET, units);
    println!("  {}Gas price    :{} {} gwei", C_DIM, C_RESET, gwei);
    println!("  {}Fee per tx   :{} {}{} ZBX{}  (target: ${} USD)", C_DIM, C_RESET, C_BOLD, fee_zbx, C_RESET, target_usd);
    if !pool_ok {
        println!("  {}⚠ Pool not yet initialized — using floor (1 gwei).{}", C_YELLOW, C_RESET);
    }
    Ok(())
}

async fn cmd_zusd(rpc: &str, address: String, quiet: bool) -> Result<()> {
    let addr = Address::from_hex(&address)?;
    let r = rpc_call(rpc, "zbx_getZusdBalance", serde_json::json!([addr.to_hex()])).await?;
    let bal: u128 = r.as_str().unwrap_or("0").parse().unwrap_or(0);
    if quiet {
        println!("{}", serde_json::json!({"address": addr.to_hex(), "zusd": format_zbx(bal), "raw": bal.to_string()}));
    } else {
        println!("  {}Address :{} {}", C_DIM, C_RESET, addr.to_hex());
        println!("  {}zUSD    :{} {}{} zUSD{}  ($ {})", C_DIM, C_RESET, C_BOLD, format_zbx(bal), C_RESET, format_zbx(bal));
    }
    Ok(())
}

async fn cmd_lp(rpc: &str, address: String, quiet: bool) -> Result<()> {
    let addr = Address::from_hex(&address)?;
    let r = rpc_call(rpc, "zbx_getLpBalance", serde_json::json!([addr.to_hex()])).await?;
    let bal: u128 = r.as_str().unwrap_or("0").parse().unwrap_or(0);
    if quiet {
        println!("{}", serde_json::json!({"address": addr.to_hex(), "lp": bal.to_string()}));
    } else {
        println!("  {}Address :{} {}", C_DIM, C_RESET, addr.to_hex());
        println!("  {}LP tokens:{} {}{}{}", C_DIM, C_RESET, C_BOLD, bal, C_RESET);
    }
    Ok(())
}
