#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# genkeys.sh — generate N validator keypairs OFFLINE.
#
# RUN THIS ON YOUR LOCAL MACHINE, NOT ON THE VPS.
# Ideally on an air-gapped machine. The output file contains private keys
# that hold authority over real-money mints — treat it like a seed phrase:
# encrypt it, back it up to multiple locations, never paste the private
# keys into chat / email / git.
#
# Requirements: Node.js 18+ and internet (to fetch ethers into a temp dir).
#
# Usage:
#   N=5 bash genkeys.sh > validators.json
#   cat validators.json | node -e 'JSON.parse(require("fs").readFileSync(0)).forEach(v => console.log(v.address))'
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

N="${N:-5}"

if ! command -v node >/dev/null 2>&1; then
  echo "node not found. Install Node.js 18+ first." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Install Node.js (which includes npm)." >&2
  exit 1
fi

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

cd "$TMPDIR"
npm init -y >/dev/null 2>&1
npm install --silent --no-audit --no-fund ethers@6.16.0 >&2

N="$N" node -e '
  const { Wallet } = require("ethers");
  const n = parseInt(process.env.N || "5", 10);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const w = Wallet.createRandom();
    out.push({
      index: i,
      address: w.address,
      private_key: w.privateKey,
      mnemonic: w.mnemonic ? w.mnemonic.phrase : null,
    });
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
'
