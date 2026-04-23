# Zebvix Wallet (Flutter)

Non-custodial mobile wallet for the **Zebvix (ZBX)** L1 blockchain.

Features:
- Create / import HD wallet (BIP-39 mnemonic, secp256k1)
- Local encrypted key storage (flutter_secure_storage + biometric / PIN)
- Live balance: liquid ZBX, staked, locked rewards, zUSD
- Send / Transfer ZBX with USD-pegged dynamic fee
- Receive: QR + Pay-ID
- Swap (DEX): ZBX ↔ zUSD via on-chain AMM pool
- Buy / Sell tab — currently routes to DEX swap (fiat on-ramp wiring left as TODO)
- Multisig: create M-of-N wallets, propose & approve txs
- Pay-ID register / resolve
- Activity / tx scan
- **QR Pairing** with web dashboard — scan the QR shown on `/connect-wallet`,
  approve sign requests pushed from the dashboard (transfer / swap / multisig approve)
- Settings: RPC endpoint switcher (default: `https://93.127.213.192:8545`), theme,
  biometric lock toggle, sign-out (clears keys)

## Build & run

This Flutter project lives at `mobile/zebvix-wallet/` in the monorepo. Replit's
web preview cannot render Flutter — build it on your local machine or in CI.

```bash
cd mobile/zebvix-wallet

# 1) bootstrap platform folders (android/, ios/, etc.)
flutter create --project-name zebvix_wallet --platforms=android,ios,web .

# 2) install deps
flutter pub get

# 3) run (Android emulator / device)
flutter run -d android

# Or build release APK
flutter build apk --release
```

The `lib/` source committed here will override anything `flutter create` wrote
to `lib/main.dart`.

## Configuration

Default RPC URL is `https://93.127.213.192:8545` and the relay base is
`https://<your-replit-url>/api`. Change either inside the app's **Settings**
tab — both are persisted via `shared_preferences`.

To pair with the web dashboard:

1. Open dashboard → **Connect Mobile Wallet**
2. In the app, tap the **Connect** tab → **Scan QR**
3. Approve the connection on the phone

The dashboard can then push signing requests; each one shows a confirmation
sheet on the phone and your secp256k1 signature is returned via the relay.

## Security notes

- Mnemonic + raw private key never leave the device (encrypted at rest by
  `flutter_secure_storage`, gated by `local_auth`).
- The QR pairing payload contains only an ephemeral session ID + secret.
- The relay (`/api/pair/*`) is a thin store-and-forward; it sees no keys.
- Tx signing format: secp256k1 ECDSA over `keccak256(canonical_json(body))`.
  Adjust `lib/services/wallet_service.dart` if your chain uses a different
  serializer.
