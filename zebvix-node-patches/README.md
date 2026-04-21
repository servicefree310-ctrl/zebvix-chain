# Zebvix Node — Patch System
**Sui fork → Zebvix Chain (ZBX)**

## Prerequisites
```bash
# VPS pe yeh installed hona chahiye:
rustup, cargo, git, clang, libssl-dev, pkg-config
```

## Usage

```bash
# Step 1: Sui repo clone karo (already done ho to skip)
git clone --branch mainnet-v1.69.2 https://github.com/MystenLabs/sui ~/zebvix-node
cd ~/zebvix-node

# Step 2: Yeh patch folder bhi clone/copy karo
git clone https://github.com/<YOUR_ORG>/zebvix-node-patches ~/zebvix-node-patches

# Step 3: Master script chalaao
cd ~/zebvix-node
bash ~/zebvix-node-patches/apply_all.sh

# Step 4: Build karo
cargo build --release -p sui-node --bin zebvix-node 2>&1 | tee build.log

# Step 5: Install
sudo cp target/release/zebvix-node /usr/local/bin/
```

## What Gets Changed

| Step | File | Change |
|------|------|--------|
| 1 | Multiple Cargo.toml / .rs files | SUI → ZBX rename, binary name |
| 2 | base_types.rs | Address 32 → 20 bytes (EVM) |
| 3 | gas_coin.rs | ZBX constants + burn cap |
| 4 | multisig.rs | Thresholds + validator rules |
| 5 | Move packages | New modules deploy |

## New Move Modules

| Module | Location |
|--------|----------|
| zebvix::pay_id | packages/zebvix/sources/pay_id.move |
| zebvix::staking_pool | packages/zebvix/sources/staking_pool.move |
| zebvix::master_pool | packages/zebvix/sources/master_pool.move |
| zebvix::sub_pool | packages/zebvix/sources/sub_pool.move |
| zebvix::founder_admin | packages/zebvix/sources/founder_admin.move |

## Chain Info
- Chain ID: `zebvix-mainnet-1`
- Token: ZBX
- Address: 20 bytes (EVM-compatible)
- Max Supply: 150,000,000 ZBX
