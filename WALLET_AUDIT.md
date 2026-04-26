# Zebvix Wallet — Hafte-1 Audit

_Snapshot: April 2026, before Hafte-1 wallet pass._

## Two folders found — pick canonical

| Folder | Status | Notes |
|---|---|---|
| `mobile/zebvix_wallet/` (underscore) | **CANONICAL** | Newer; matches project goal. web3dart EVM, BIP32/39 HD, app_links MetaMask-style deep-link, qr_flutter + mobile_scanner, flutter_secure_storage, session_relay, Bridge/Swap/AddToken/Approve screens. |
| `mobile/zebvix-wallet/` (dash) | **ARCHIVE** | Older smaller scope. Has multisig_tab + onboarding but no bridge/swap/add-token/approve screens. Was first prototype. To be moved to `backups/` in T003. |

## Goal feature checklist (canonical folder)

| Feature | Present | File | Gap |
|---|---|---|---|
| Onboarding (create / import) | ✅ | `screens/onboarding_screen.dart` | — |
| BIP39 mnemonic + BIP32 HD | ✅ | `pubspec.yaml` deps | recovery-phrase backup-flow UI not yet audited |
| EVM secp256k1 signing | ✅ | `web3dart` | — |
| Native Send | ✅ | `screens/send_screen.dart` | — |
| Receive (QR) | ✅ | `screens/receive_screen.dart` | — |
| Multi-chain (Zebvix / BSC / ETH / Polygon / Arbitrum) | ✅ | `core/chains.dart` | — |
| Bridge UI (bidirectional ZBX↔wZBX) | ✅ | `screens/bridge_screen.dart` + `bridge/bridge_service.dart` | **Missing: bridge-paused banner (T002)** |
| Swap UI | ✅ | `screens/swap_screen.dart` + `swap/swap_service.dart` | not audited this session |
| Custom Token Add | ✅ | `screens/add_token_screen.dart` + `core/token_store.dart` | not audited this session |
| QR-Approve (dApp connect / sign) | ✅ | `screens/approve_screen.dart` + `session/session_relay.dart` | not audited this session |
| MetaMask-style deep link | ✅ | `main.dart` `_setupDeepLinks` (`zebvix://wc?...`, `zbx://wc?...`) | — |
| Secure-enclave / biometric storage | ⚠️ | `flutter_secure_storage` present | biometric prompt on every key use NOT enforced — needs `local_auth` |
| Recovery-phrase backup screen | ❓ | unclear from screens list | confirm next pass |
| Live balance refresh | ✅ | `core/balance_service.dart` | — |
| WebSocket live feed | ⚠️ | `web_socket_channel` in deps | not visibly used — investigate |

## Hafte-1 wallet scope

T002 only: ship the **bridge-paused banner** (mirrors chain H6 kill-switch).
Other ⚠️ items (biometric prompt, recovery-phrase audit, WS feed) → Hafte-2 backlog.

## Observed issues to track

1. `core/chains.dart` Zebvix RPC URL hard-codes `http://93.127.213.192:8545` (plain HTTP, IP). After T004 (Caddy + TLS) this should become `https://rpc.zebvix.example/`.
2. `core/chains.dart:62-63` BSC `wrappedToken` and `bridgeContract` addresses look truncated (38 hex chars instead of 40). Verify before mainnet.
3. No `flutter analyze` workflow registered — add later.
