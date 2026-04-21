# Zebvix Node — Complete Installation Guide
**VPS pe Zebvix chain launch karne ke liye full step-by-step guide**

---

## Prerequisites (VPS pe install karo)

```bash
# Rust install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
rustup default stable
rustup update

# Dependencies
apt-get update && apt-get install -y \
    git clang libssl-dev pkg-config \
    build-essential cmake protobuf-compiler \
    libclang-dev libudev-dev
```

---

## Step 1: Sui Repo Clone

```bash
# Sirf ek baar karo
git clone --branch mainnet-v1.69.2 \
    https://github.com/MystenLabs/sui \
    ~/zebvix-node

cd ~/zebvix-node
```

---

## Step 2: Patch System Clone

```bash
# Yeh patches repo clone karo
git clone https://github.com/<YOUR_ORG>/zebvix-node-patches \
    ~/zebvix-node-patches

# Ya directly copy karo
scp -r zebvix-node-patches root@<YOUR_VPS>:~/
```

---

## Step 3: Apply All Patches

```bash
cd ~/zebvix-node
bash ~/zebvix-node-patches/apply_all.sh
```

Yeh automatically karega:
- ✅ SUI → ZBX rename + binary name
- ✅ 20-byte EVM address
- ✅ Tokenomics constants + burn cap
- ✅ MultiSig rules
- ✅ Move modules copy (Pay ID, Staking Pool, AMM)
- ✅ Config templates

---

## Step 4: Build

```bash
cd ~/zebvix-node

# Full build (30-60 min first time)
cargo build --release -p sui-node --bin zebvix-node 2>&1 | tee build.log

# Binary check
ls -la target/release/zebvix-node

# Install
sudo cp target/release/zebvix-node /usr/local/bin/
zebvix-node --version
```

---

## Step 5: Genesis Setup

```bash
mkdir -p ~/zebvix-data

# Config copy
cp ~/zebvix-node-patches/config/validator.yaml ~/.zebvix/
cp ~/zebvix-node-patches/config/fullnode.yaml  ~/.zebvix/

# Keypair generate karo
zebvix-node generate-keys \
    --output-dir ~/.zebvix/

# Genesis create karo
zebvix-node genesis \
    --config ~/zebvix-node-patches/config/genesis_template.yaml \
    --output-dir ~/zebvix-data/
```

---

## Step 6: Move Modules Deploy (after node start)

```bash
# Sui CLI ya zebvix CLI se
sui client publish \
    --path ~/zebvix-node/crates/sui-framework/packages/zebvix \
    --gas-budget 100000000
```

---

## Step 7: Start Node

```bash
# Validator mode
zebvix-node run \
    --config-path ~/.zebvix/validator.yaml \
    --genesis-path ~/zebvix-data/genesis.blob

# Ya systemd service
cat > /etc/systemd/system/zebvix.service << 'EOF'
[Unit]
Description=Zebvix Node
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/zebvix-node run \
    --config-path /root/.zebvix/validator.yaml \
    --genesis-path /root/zebvix-data/genesis.blob
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl enable zebvix
systemctl start zebvix
systemctl status zebvix
```

---

## Step 8: Check Logs

```bash
journalctl -u zebvix -f
# Ya
zebvix-node --log-level info run ...
```

---

## Founder Wallet Setup (After Node Start)

```bash
# 1. Admin MultiSig wallet create karo (4/6 threshold)
sui keytool generate-multisig \
    --pks <PK1> <PK2> <PK3> <PK4> <PK5> <PK6> \
    --weights 1 1 1 1 1 1 \
    --threshold 4

# 2. FounderAdminCap transfer karo MultiSig address pe
sui client call \
    --package <ZEBVIX_PKG_ID> \
    --module founder_admin \
    --function transfer_to_multisig \
    --args <FOUNDER_ADMIN_CAP_ID> <MULTISIG_ADDRESS> \
    --gas-budget 10000000
```

---

## What Each Module Does

| Module | Address | Purpose |
|--------|---------|---------|
| `zebvix::zbx` | 0x... | Native ZBX token |
| `zebvix::pay_id` | 0x... | Pay ID (name@zbx) |
| `zebvix::staking_pool` | 0x... | Validator + Delegator staking |
| `zebvix::master_pool` | 0x... | ZBX base AMM pool |
| `zebvix::sub_pool` | 0x... | Token pair pools |
| `zebvix::founder_admin` | 0x... | Admin capability |

---

## Chain Parameters Summary

| Parameter | Value |
|-----------|-------|
| Chain ID | `zebvix-mainnet-1` |
| Token | ZBX |
| Max Supply | 150,000,000 ZBX |
| Genesis Supply | 2,000,000 ZBX |
| Address Length | 20 bytes (EVM-compatible) |
| Block Time | 400ms |
| Validator Slots | 41 |
| Min Validator Stake | 10,000 ZBX |
| Max Stake/Slot | 5,000,000 ZBX |
| Validator APR | 120% |
| Delegator APR | 80% |
| Delegation Bonus | +40% for validator |
| Node Daily Reward | 5 ZBX/day |
| Burn Cap | 75,000,000 ZBX (50%) |
| Gas Burn | 10% of each txn fee |
| Gas Validator | 72% |
| Gas Treasury | 18% |
