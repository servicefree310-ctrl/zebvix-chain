import type { Logger } from "pino";
import type { RelayerConfig } from "./config.ts";
import type { RelayerDB } from "./db.ts";
import type { BscClient } from "./bsc-client.ts";
import {
  zebvixRpc,
  getZebvixFeeWei,
  getZebvixNonce,
} from "./zebvix-rpc.ts";
import { signBridgeInTx, adminAddressFromKey } from "./zebvix-tx.ts";

const CHUNK = 5_000; // BSC RPC providers limit getLogs range.

/** How long to wait after a `submitted` BridgeIn tx before resubmitting if
 *  the on-chain claim has not yet been recorded. Covers mempool eviction,
 *  fee underpayment, etc. */
const SUBMIT_RETRY_AFTER_MS = 90_000;

/**
 * Watch BSC for `BurnToZebvix` events. For each new burn (after CONFIRMATIONS),
 * persist it and submit `BridgeOp::BridgeIn` to Zebvix using `ZEBVIX_ADMIN_KEY`.
 *
 * Two-stage state machine:
 *   `pending`    → relayer signs + submits via `zbx_sendRawTransaction` → `submitted`
 *   `submitted`  → on next ticks, poll `zbx_isBridgeClaimUsed`. If true → `confirmed`.
 *                  If still false after `SUBMIT_RETRY_AFTER_MS` → revert to `pending`
 *                  for resubmission (covers tx eviction / apply-time failure).
 *   `confirmed`  → terminal success.
 *   `failed`     → after >10 attempts; needs operator action.
 *
 * NOTE: today's BridgeIn admin-attests (single chain admin). When the
 * Zebvix-side multisig oracle ships, only `submitBridgeIn` changes — collect
 * M-of-N Zebvix validator sigs and call a future `BridgeOp::BridgeInMultisig`.
 */
export class BscWatcher {
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private adminAddr: string | null = null;
  /** Single-flight guard: if a tick takes longer than the interval, skip the
   *  next firing. Without this, two concurrent `processPending()` calls would
   *  read the same on-chain nonce baseline and emit overlapping nonce ranges,
   *  re-creating the burst-load nonce collision the per-tick allocator was
   *  introduced to fix. */
  private inFlight = false;

  constructor(
    private readonly cfg: RelayerConfig,
    private readonly db: RelayerDB,
    private readonly bsc: BscClient,
    private readonly log: Logger,
  ) {}

  start() {
    if (this.cfg.ZEBVIX_ADMIN_KEY) {
      try {
        this.adminAddr = adminAddressFromKey(this.cfg.ZEBVIX_ADMIN_KEY);
        this.log.info({ admin: this.adminAddr }, "loaded zebvix admin signing key");
      } catch (e) {
        this.log.error({ err: e }, "failed to derive admin address from ZEBVIX_ADMIN_KEY");
      }
    }
    const startBlock = Math.max(this.db.getCursor("bsc_burn_cursor"), this.cfg.BSC_START_BLOCK);
    this.db.setCursor("bsc_burn_cursor", startBlock);
    this.log.info({ start_block: startBlock, confirmations: this.cfg.BSC_BURN_CONFIRMATIONS }, "bsc watcher starting");
    this.tick().catch((e) => this.log.error({ err: e }, "initial tick failed"));
    this.timer = setInterval(() => {
      this.tick().catch((e) => this.log.error({ err: e }, "tick failed"));
    }, this.cfg.ZEBVIX_POLL_MS * 2);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.stopped) return;
    if (this.inFlight) {
      this.log.debug("bsc tick skipped: previous tick still in flight");
      return;
    }
    this.inFlight = true;
    try {
      await this.discoverBurns();
      await this.confirmSubmitted();
      await this.processPending();
    } finally {
      this.inFlight = false;
    }
  }

  private async discoverBurns() {
    const head = await this.bsc.getBlockNumber();
    const safe = head - this.cfg.BSC_BURN_CONFIRMATIONS;
    if (safe < 0) return;
    let cursor = this.db.getCursor("bsc_burn_cursor");
    if (cursor === 0) cursor = this.cfg.BSC_START_BLOCK;
    while (cursor <= safe) {
      const to = Math.min(cursor + CHUNK - 1, safe);
      const burns = await this.bsc.fetchBurns(cursor, to);
      for (const b of burns) {
        this.db.recordBscBurn({
          bsc_tx_hash: b.bsc_tx_hash,
          bsc_log_index: b.bsc_log_index,
          bsc_block: b.bsc_block,
          burn_seq: b.burn_seq,
          burner: b.burner,
          zebvix_address: b.zebvix_address,
          amount: b.amount,
        });
      }
      if (burns.length > 0) this.log.info({ from: cursor, to, count: burns.length }, "discovered bsc burns");
      this.db.setCursor("bsc_burn_cursor", to + 1);
      cursor = to + 1;
    }
  }

  /**
   * For each `submitted` burn, ask the chain whether the BridgeIn claim was
   * actually consumed. This is the ONLY authoritative success signal — the
   * `zbx_sendRawTransaction` return value only proves mempool acceptance,
   * not block inclusion or apply-time success.
   */
  private async confirmSubmitted() {
    const subs = this.db.submittedBscBurns(50);
    if (subs.length === 0) return;
    const now = Date.now();
    for (const burn of subs) {
      try {
        const claimed = await zebvixRpc<{ claimed: boolean }>(
          this.cfg.ZEBVIX_RPC,
          "zbx_isBridgeClaimUsed",
          [burn.bsc_tx_hash],
        );
        if (claimed?.claimed) {
          this.db.setBscBurnStatus(burn.bsc_tx_hash, burn.bsc_log_index, "confirmed");
          this.log.info(
            { bsc_tx: burn.bsc_tx_hash, zebvix_tx: burn.zebvix_submit_tx },
            "BridgeIn confirmed on Zebvix",
          );
          continue;
        }
        // Not yet on-chain. If our last submit is older than the retry window,
        // demote back to `pending` so processPending() resubmits with a fresh
        // nonce + fee. Otherwise leave it; it may still be in the mempool.
        const ageMs = now - burn.updated_at;
        if (ageMs > SUBMIT_RETRY_AFTER_MS) {
          this.log.warn(
            {
              bsc_tx: burn.bsc_tx_hash,
              age_ms: ageMs,
              prev_submit_tx: burn.zebvix_submit_tx,
            },
            "submitted BridgeIn not consumed within retry window, requeuing",
          );
          this.db.setBscBurnStatus(burn.bsc_tx_hash, burn.bsc_log_index, "pending", {
            last_error: `submitted tx ${burn.zebvix_submit_tx} not consumed within ${SUBMIT_RETRY_AFTER_MS}ms`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn({ bsc_tx: burn.bsc_tx_hash, err: msg }, "claim-status check failed");
      }
    }
  }

  private async processPending() {
    const pending = this.db.pendingBscBurns(20);
    if (pending.length === 0) return;

    if (!this.cfg.ZEBVIX_ADMIN_KEY || !this.adminAddr) {
      this.log.warn(
        { pending: pending.length },
        "ZEBVIX_ADMIN_KEY not configured; bsc burns queued but cannot submit BridgeIn",
      );
      return;
    }

    // Nonce + fee are fetched ONCE per batch. The chain enforces strict
    // `from.nonce == tx.body.nonce` at apply-time (state.rs), so submitting
    // every burn in this tick with a fresh on-chain nonce would give them all
    // the SAME nonce — only one would apply, the rest would churn through
    // the 90s retry cycle. Instead we allocate monotonically from a single
    // base nonce per tick. If the chain advances mid-tick (because an earlier
    // submission applied), our locally-tracked higher nonces are still valid
    // for the mempool. If a tick fails mid-batch, the next tick re-reads the
    // on-chain nonce and skips the slots already accepted.
    let nextNonce: number;
    let feeWei: bigint;
    try {
      nextNonce = await getZebvixNonce(this.cfg.ZEBVIX_RPC, this.adminAddr);
      feeWei = await getZebvixFeeWei(this.cfg.ZEBVIX_RPC);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error({ err: msg }, "could not load nonce/fee for BridgeIn batch; will retry next tick");
      return;
    }

    for (const burn of pending) {
      try {
        // Pre-check: if the chain already has the claim (e.g. another relayer
        // beat us, or this is a re-submission after we crashed mid-flight),
        // mark confirmed and move on. Does NOT consume a nonce.
        const claimed = await zebvixRpc<{ claimed: boolean }>(
          this.cfg.ZEBVIX_RPC,
          "zbx_isBridgeClaimUsed",
          [burn.bsc_tx_hash],
        );
        if (claimed?.claimed) {
          this.log.info(
            { bsc_tx: burn.bsc_tx_hash },
            "claim already used on Zebvix, marking confirmed",
          );
          this.db.setBscBurnStatus(burn.bsc_tx_hash, burn.bsc_log_index, "confirmed");
          continue;
        }

        const nonce = nextNonce;
        const signed = signBridgeInTx({
          privateKeyHex: this.cfg.ZEBVIX_ADMIN_KEY,
          feeWei,
          nonce,
          chainId: this.cfg.ZEBVIX_CHAIN_ID,
          assetId: BigInt(this.cfg.ZEBVIX_ZBX_ASSET_ID),
          sourceTxHash: burn.bsc_tx_hash,
          recipient: burn.zebvix_address,
          amount: BigInt(burn.amount),
        });

        const txHash = await zebvixRpc<string>(
          this.cfg.ZEBVIX_RPC,
          "zbx_sendRawTransaction",
          [signed.rawHex],
        );

        // Only consume the nonce slot AFTER mempool ack. If submit threw
        // (network error, fee-too-low, etc.) the slot stays free and the
        // next burn in this batch reuses it.
        nextNonce = nonce + 1;

        this.log.info(
          {
            bsc_tx: burn.bsc_tx_hash,
            recipient: burn.zebvix_address,
            amount: burn.amount,
            zebvix_tx: txHash,
            nonce,
            admin: signed.from,
          },
          "submitted BridgeIn to mempool (awaiting on-chain confirmation)",
        );

        // IMPORTANT: mark as `submitted` (NOT confirmed). confirmSubmitted()
        // will promote to `confirmed` only after the on-chain claim flag flips.
        this.db.setBscBurnStatus(burn.bsc_tx_hash, burn.bsc_log_index, "submitted", {
          zebvix_submit_tx: typeof txHash === "string" ? txHash : "",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error({ bsc_tx: burn.bsc_tx_hash, err: msg }, "BridgeIn submission failed");
        const next: "pending" | "failed" =
          burn.attempts >= 10 ? "failed" : "pending";
        this.db.setBscBurnStatus(burn.bsc_tx_hash, burn.bsc_log_index, next, {
          last_error: msg,
        });
        // Do NOT advance nextNonce — let the next burn in this batch reuse
        // the slot we just failed on.
      }
    }
  }
}
