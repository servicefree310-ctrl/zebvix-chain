# Zebvix Chain (ZBX)

**Zebvix Technologies Pvt Ltd** — production L1 blockchain.

## Specs

| | |
|--|--|
| Chain ID | 7878 |
| Token | ZBX (18 decimals) |
| Address | 20-byte EVM-style (Keccak256(pubkey)[12..]) |
| Crypto | Ed25519 signatures |
| Block time | 5 seconds |
| Total supply cap | 150,000,000 ZBX |
| Foundation pre-mine | 9,990,000 ZBX (6.66% — development & operations) |
| AMM pool genesis seed | 20,000,000 ZBX (13.33% — liquidity) |
| Block-mined supply | 120,010,000 ZBX over time (80.01%) |
| Initial block reward | 3 ZBX |
| Halving interval | 25,000,000 blocks (~3.96 years) |
| Consensus (v0.1) | Single-validator PoA |
| Consensus (v0.2) | Multi-validator BFT |
| Smart contracts (v0.2) | EVM-compatible (revm) |
| Storage | RocksDB |
| RPC | JSON-RPC HTTP (Ethereum-style) |

## Build

```bash
# On VPS (Ubuntu/Debian):
apt-get install -y build-essential clang pkg-config libssl-dev librocksdb-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env

cd zebvix-chain
cargo build --release
sudo cp target/release/zebvix-node /usr/local/bin/
zebvix-node --version
```

## Quick Start (single validator on VPS)

```bash
# 1. Generate validator key
zebvix-node keygen --out ~/.zebvix/validator.key

# 2. Initialize chain (optional: pre-allocate ZBX to founder)
#    Format: <address>:<amount_in_zbx>
zebvix-node init \
  --home ~/.zebvix \
  --validator-key ~/.zebvix/validator.key \
  --alloc 0xVALIDATOR_ADDR:1000000

# 3. Start the node (block production + JSON-RPC on :8545)
zebvix-node start --home ~/.zebvix --rpc 0.0.0.0:8545
```

## Send a transaction

```bash
# Generate a user key
zebvix-node keygen --out ~/.zebvix/alice.key

# Send 5 ZBX from alice to a recipient
zebvix-node send \
  --from-key ~/.zebvix/alice.key \
  --to       0xRECIPIENT_ADDR \
  --amount   5 \
  --fee      0.001 \
  --rpc      http://127.0.0.1:8545
```

## JSON-RPC methods

```bash
# Chain info
curl -s -X POST http://127.0.0.1:8545 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_chainInfo","params":[]}'

# Latest block height
curl -s -X POST http://127.0.0.1:8545 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'

# Balance (returns wei in hex)
curl -s -X POST http://127.0.0.1:8545 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0xYOUR_ADDR"]}'

# Supply / minting status
curl -s -X POST http://127.0.0.1:8545 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_supply","params":[]}'

# Get block by height
curl -s -X POST http://127.0.0.1:8545 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"zbx_getBlockByNumber","params":[1]}'
```

## Roadmap

- ✅ **v0.1** (this release): single-validator PoA, ZBX transfers, halving, JSON-RPC, RocksDB
- 🔜 **v0.2**: EVM smart contracts via `revm`, multi-validator BFT (HotStuff/Tendermint-style), p2p gossip
- 🔜 **v0.3**: validator staking & slashing, governance, light clients
