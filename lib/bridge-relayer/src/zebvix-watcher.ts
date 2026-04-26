import type { Logger } from "pino";
import type { RelayerConfig } from "./config.ts";
import type { RelayerDB } from "./db.ts";
import type { BscClient } from "./bsc-client.ts";
import { collectSignatures } from "./signer-client.ts";
import { zebvixRpc, type ZebvixBridgeOutEvent } from "./zebvix-rpc.ts";

/** Mirrors `zebvix-chain/src/bridge.rs::MAX_OUT_EVENTS`. Backfill caps at this
 *  many seqs below `lastChainSeq` — anything older is irrecoverable. */
const ZEBVIX_RING_CAP = 4096;
/** Cursor name (in `cursors` table) tracking the highest GLOBAL bridge-out
 *  seq we've ever observed, regardless of asset filter. Used as the gap
 *  detector baseline so non-target-asset events don't trigger spurious
 *  backfill or false eviction alerts. */
const GLOBAL_SEQ_CURSOR = "zebvix_global_max_seq";

/** Normalize a Zebvix tx_hash to a bytes32 0x-string. */
function toBytes32Hex(hash: string): string {
  let h = hash.startsWith("0x") ? hash.slice(2) : hash;
  if (h.length !== 64) {
    throw new Error(`bad zebvix tx hash length: ${h.length} (expected 64): ${hash}`);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(h)) {
    throw new Error(`bad zebvix tx hash chars: ${hash}`);
  }
  return "0x" + h.toLowerCase();
}

function normalizeDestAddress(addr: string): string {
  const a = addr.startsWith("0x") || addr.startsWith("0X") ? addr.slice(2) : addr;
  if (!/^[0-9a-fA-F]{40}$/.test(a)) {
    throw new Error(`bad EVM dest_address: ${addr}`);
  }
  return "0x" + a.toLowerCase();
}

/**
 * Poll Zebvix for new BridgeOut events (filtered by ZBX asset_id targeting BSC),
 * persist them, request validator signatures, and submit aggregated mintFromZebvix
 * txs on BSC.
 *
 * Two-tier discovery to guarantee no missed events:
 *  1. Cheap path: poll `zbx_recentBridgeOutEvents` (cap 500) every tick.
 *  2. Backfill path: if `total > max_seen_seq + recent_batch.length`, fetch
 *     each missing seq in `[max_seen_seq+1, total-1)` via `zbx_getBridgeOutBySeq`
 *     until we either catch up or hit the chain's ring-buffer eviction
 *     (`MAX_OUT_EVENTS = 4096`). Permanently-evicted seqs are logged at FATAL
 *     so an operator gets paged.
 */
export class ZebvixWatcher {
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  /** Single-flight guard: prevents two ticks from running concurrently (e.g.
   *  when discoverNewEvents takes longer than ZEBVIX_POLL_MS during a
   *  long backfill). Without it, two backfill loops could race on the same
   *  seq range and double-process events / double-advance the cursor. */
  private inFlight = false;

  constructor(
    private readonly cfg: RelayerConfig,
    private readonly db: RelayerDB,
    private readonly bsc: BscClient,
    private readonly log: Logger,
  ) {}

  start() {
    this.log.info(
      { interval_ms: this.cfg.ZEBVIX_POLL_MS, asset_id: this.cfg.ZEBVIX_ZBX_ASSET_ID },
      "zebvix watcher starting",
    );
    this.tick().catch((e) => this.log.error({ err: e }, "initial tick failed"));
    this.timer = setInterval(() => {
      this.tick().catch((e) => this.log.error({ err: e }, "tick failed"));
    }, this.cfg.ZEBVIX_POLL_MS);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.stopped) return;
    if (this.inFlight) {
      this.log.debug("zebvix tick skipped: previous tick still in flight");
      return;
    }
    this.inFlight = true;
    try {
      await this.discoverNewEvents();
      await this.processPending();
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Insert a single event into the DB, applying our asset-id filter.
   * Returns `true` if it matched and was queued; `false` otherwise.
   */
  private ingestEvent(e: ZebvixBridgeOutEvent): boolean {
    if (String(e.asset_id) !== this.cfg.ZEBVIX_ZBX_ASSET_ID) return false;
    try {
      this.db.recordZebvixEvent({
        source_tx_hash: toBytes32Hex(e.tx_hash),
        zebvix_seq: e.seq,
        recipient: normalizeDestAddress(e.dest_address),
        amount: e.amount,
        zebvix_block: e.height,
      });
      return true;
    } catch (err) {
      this.log.warn({ err, event: e }, "skipping malformed BridgeOut event");
      return false;
    }
  }

  private async discoverNewEvents() {
    // Step 1: cheap recent poll (chain caps at 500).
    const res = await zebvixRpc<{
      returned: number;
      total: number;
      events: ZebvixBridgeOutEvent[];
    }>(this.cfg.ZEBVIX_RPC, "zbx_recentBridgeOutEvents", [500]);

    let added = 0;
    let recentMinSeq = Number.POSITIVE_INFINITY;
    let recentMaxSeq = -1;
    for (const e of res.events ?? []) {
      if (this.ingestEvent(e)) added++;
      if (typeof e.seq === "number") {
        if (e.seq < recentMinSeq) recentMinSeq = e.seq;
        if (e.seq > recentMaxSeq) recentMaxSeq = e.seq;
      }
    }

    // Step 2: gap detection + backfill.
    //
    // Baseline must be the GLOBAL highest seq we've ever seen (cursor) — NOT
    // just our asset-filtered DB rows. Otherwise any non-target asset's
    // BridgeOut between our polls would create an artificial "gap" and we'd
    // pointlessly fetch (and possibly false-FATAL on) seqs that were never
    // for our asset.
    if (res.total > 0) {
      const lastChainSeq = res.total - 1;
      const cursorRaw = this.db.getCursor(GLOBAL_SEQ_CURSOR);
      // cursor=0 default is ambiguous (could mean "never seen" OR "seen seq 0").
      // We disambiguate by treating fresh DB (no events recorded) as -1.
      const haveAny = this.db.getMaxZebvixSeq() >= 0 || cursorRaw > 0;
      const globalMax = haveAny ? cursorRaw : -1;
      const wantFrom = globalMax + 1;

      // The recent batch already covered [recentMinSeq, recentMaxSeq] if non-empty.
      const backfillTo = Number.isFinite(recentMinSeq)
        ? (recentMinSeq as number) - 1
        : lastChainSeq;

      // Bound the backfill: anything below `lastChainSeq - RING_CAP + 1` has
      // already been evicted from the chain ring buffer and is permanently
      // unrecoverable. Don't waste RPC calls + don't falsely log every old
      // seq as FATAL. We log a SINGLE fatal alert if the gap exceeds the cap.
      const oldestRecoverable = Math.max(0, lastChainSeq - ZEBVIX_RING_CAP + 1);
      const evictedFrom = wantFrom < oldestRecoverable
        ? wantFrom
        : null;
      const cappedFrom = Math.max(wantFrom, oldestRecoverable);

      if (evictedFrom !== null) {
        this.log.fatal(
          {
            lost_from: evictedFrom,
            lost_to: oldestRecoverable - 1,
            lost_count: oldestRecoverable - evictedFrom,
            ring_cap: ZEBVIX_RING_CAP,
            last_chain_seq: lastChainSeq,
          },
          "OPERATOR ALERT: BridgeOut events permanently evicted from chain ring "
            + "buffer (relayer downtime exceeded ring cap). Manual reconciliation "
            + "required to refund or replay these locks.",
        );
      }

      if (cappedFrom <= backfillTo) {
        const gapSize = backfillTo - cappedFrom + 1;
        this.log.warn(
          { wantFrom: cappedFrom, backfillTo, gapSize, lastChainSeq, globalMax },
          "ring-buffer gap detected, backfilling missed BridgeOut events",
        );
        for (let s = cappedFrom; s <= backfillTo; s++) {
          try {
            const ev = await zebvixRpc<ZebvixBridgeOutEvent>(
              this.cfg.ZEBVIX_RPC,
              "zbx_getBridgeOutBySeq",
              [s],
            );
            if (this.ingestEvent(ev)) added++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("evicted") || msg.includes("not found")) {
              // Race: chain evicted this seq between our `total` read and the
              // per-seq fetch. Treat as a single permanent loss + continue.
              this.log.fatal(
                { seq: s, last_chain_seq: lastChainSeq, err: msg },
                "BridgeOut event evicted mid-backfill",
              );
            } else {
              this.log.error(
                { seq: s, err: msg },
                "backfill RPC failed (will retry next tick)",
              );
              // Network failure — stop early, retry next tick. Do NOT advance
              // the cursor past the failed seq.
              return;
            }
          }
        }
      }

      // Advance the global cursor to the chain's reported high-water mark.
      // We only do this AFTER backfill succeeds (or we determine the chain
      // already evicted what we need), so a transient network failure during
      // backfill leaves the cursor where it was for the next tick to retry.
      if (lastChainSeq > globalMax) {
        this.db.setCursor(GLOBAL_SEQ_CURSOR, lastChainSeq);
      }
    }

    if (added > 0) this.log.info({ added, total_known: res.total }, "discovered zebvix events");
  }

  /** Process events in 'pending' or 'signing' state: collect sigs and mint on BSC. */
  private async processPending() {
    const pending = this.db.pendingZebvixEvents(20);
    if (pending.length === 0) return;
    const threshold = await this.bsc.threshold();

    for (const ev of pending) {
      try {
        if (await this.bsc.isConsumed(ev.source_tx_hash)) {
          this.log.info({ source: ev.source_tx_hash }, "already consumed on BSC, marking confirmed");
          this.db.setZebvixEventStatus(ev.source_tx_hash, "confirmed");
          continue;
        }

        this.db.setZebvixEventStatus(ev.source_tx_hash, "signing");
        const req = {
          sourceTxHash: ev.source_tx_hash,
          recipient: ev.recipient,
          amount: BigInt(ev.amount),
          sourceChainId: BigInt(this.cfg.ZEBVIX_CHAIN_ID),
          sourceBlockHeight: BigInt(ev.zebvix_block),
        };

        const { signatures, signers } = await collectSignatures(
          this.cfg.signerEndpoints,
          req,
          threshold,
          this.cfg.SIGNER_TIMEOUT_MS,
          this.log.child({ source: ev.source_tx_hash }),
          this.cfg.SIGNER_AUTH_TOKEN,
        );
        this.log.info(
          { source: ev.source_tx_hash, signers, threshold, recipient: ev.recipient, amount: ev.amount },
          "collected signatures, submitting mint",
        );

        const { hash, block } = await this.bsc.submitMint(req, signatures);
        this.db.setZebvixEventStatus(ev.source_tx_hash, "confirmed", { bsc_mint_tx: hash });
        this.log.info({ source: ev.source_tx_hash, bsc_tx: hash, bsc_block: block }, "minted on BSC");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error({ source: ev.source_tx_hash, err: msg }, "mint flow failed");
        const newStatus = ev.attempts >= 10 ? "failed" : "pending";
        this.db.setZebvixEventStatus(ev.source_tx_hash, newStatus, { last_error: msg });
      }
    }
  }
}
