import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";

export interface ProcessedZebvixEvent {
  source_tx_hash: string;
  zebvix_seq: number;
  recipient: string;
  amount: string;
  zebvix_block: number;
  bsc_mint_tx: string | null;
  status: "pending" | "signing" | "submitted" | "confirmed" | "failed";
  attempts: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface ProcessedBscBurn {
  bsc_tx_hash: string;
  bsc_log_index: number;
  bsc_block: number;
  burn_seq: number;
  burner: string;
  zebvix_address: string;
  amount: string;
  zebvix_submit_tx: string | null;
  status: "pending" | "submitted" | "confirmed" | "failed";
  attempts: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export class RelayerDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_zebvix_events (
        source_tx_hash TEXT PRIMARY KEY,
        zebvix_seq INTEGER NOT NULL,
        recipient TEXT NOT NULL,
        amount TEXT NOT NULL,
        zebvix_block INTEGER NOT NULL,
        bsc_mint_tx TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_zebvix_status ON processed_zebvix_events(status);
      CREATE INDEX IF NOT EXISTS idx_zebvix_seq ON processed_zebvix_events(zebvix_seq);

      CREATE TABLE IF NOT EXISTS processed_bsc_burns (
        bsc_tx_hash TEXT NOT NULL,
        bsc_log_index INTEGER NOT NULL,
        bsc_block INTEGER NOT NULL,
        burn_seq INTEGER NOT NULL,
        burner TEXT NOT NULL,
        zebvix_address TEXT NOT NULL,
        amount TEXT NOT NULL,
        zebvix_submit_tx TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (bsc_tx_hash, bsc_log_index)
      );
      CREATE INDEX IF NOT EXISTS idx_bsc_status ON processed_bsc_burns(status);
      CREATE INDEX IF NOT EXISTS idx_burn_seq ON processed_bsc_burns(burn_seq);

      CREATE TABLE IF NOT EXISTS cursors (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  // ── Zebvix-side ─────────────────────────────────────────────────────────

  /**
   * Insert a freshly-discovered Zebvix BridgeOut event. Returns `true` if a new
   * row was actually written, `false` if it was already known (idempotent retry).
   * Callers use the boolean to drive accurate "newly discovered" log counters
   * and avoid log spam when the chain re-serves the same recent ring-buffer
   * entries on every poll.
   */
  recordZebvixEvent(
    e: Omit<ProcessedZebvixEvent, "status" | "attempts" | "last_error" | "bsc_mint_tx" | "created_at" | "updated_at">,
  ): boolean {
    const now = Date.now();
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO processed_zebvix_events
         (source_tx_hash, zebvix_seq, recipient, amount, zebvix_block, status, attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      )
      .run(e.source_tx_hash, e.zebvix_seq, e.recipient, e.amount, e.zebvix_block, now, now);
    return res.changes > 0;
  }

  pendingZebvixEvents(limit = 50): ProcessedZebvixEvent[] {
    return this.db
      .prepare(
        `SELECT * FROM processed_zebvix_events
         WHERE status IN ('pending', 'signing')
         ORDER BY zebvix_seq ASC
         LIMIT ?`,
      )
      .all(limit) as ProcessedZebvixEvent[];
  }

  /**
   * Highest zebvix_seq we have ever recorded (independent of status). Used by
   * the watcher to detect ring-buffer gaps after downtime so we can backfill
   * via `zbx_getBridgeOutBySeq`.
   */
  getMaxZebvixSeq(): number {
    const row = this.db
      .prepare(`SELECT COALESCE(MAX(zebvix_seq), -1) AS m FROM processed_zebvix_events`)
      .get() as { m: number };
    return Number(row.m);
  }

  setZebvixEventStatus(hash: string, status: ProcessedZebvixEvent["status"], extras?: { bsc_mint_tx?: string; last_error?: string }) {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE processed_zebvix_events
         SET status = ?, bsc_mint_tx = COALESCE(?, bsc_mint_tx),
             last_error = ?, attempts = attempts + 1, updated_at = ?
         WHERE source_tx_hash = ?`,
      )
      .run(status, extras?.bsc_mint_tx ?? null, extras?.last_error ?? null, now, hash);
  }

  // ── BSC-side ────────────────────────────────────────────────────────────

  recordBscBurn(e: Omit<ProcessedBscBurn, "status" | "attempts" | "last_error" | "zebvix_submit_tx" | "created_at" | "updated_at">) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO processed_bsc_burns
         (bsc_tx_hash, bsc_log_index, bsc_block, burn_seq, burner, zebvix_address, amount, status, attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      )
      .run(e.bsc_tx_hash, e.bsc_log_index, e.bsc_block, e.burn_seq, e.burner, e.zebvix_address, e.amount, now, now);
  }

  pendingBscBurns(limit = 50): ProcessedBscBurn[] {
    return this.db
      .prepare(
        `SELECT * FROM processed_bsc_burns
         WHERE status = 'pending'
         ORDER BY burn_seq ASC
         LIMIT ?`,
      )
      .all(limit) as ProcessedBscBurn[];
  }

  /**
   * Burns whose BridgeIn tx was submitted to mempool but for which on-chain
   * confirmation has not yet been observed. Caller polls
   * `zbx_isBridgeClaimUsed` to either (a) promote to `confirmed` or
   * (b) revert to `pending` for resubmission after the retry window.
   */
  submittedBscBurns(limit = 50): ProcessedBscBurn[] {
    return this.db
      .prepare(
        `SELECT * FROM processed_bsc_burns
         WHERE status = 'submitted'
         ORDER BY burn_seq ASC
         LIMIT ?`,
      )
      .all(limit) as ProcessedBscBurn[];
  }

  setBscBurnStatus(txHash: string, logIndex: number, status: ProcessedBscBurn["status"], extras?: { zebvix_submit_tx?: string; last_error?: string }) {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE processed_bsc_burns
         SET status = ?, zebvix_submit_tx = COALESCE(?, zebvix_submit_tx),
             last_error = ?, attempts = attempts + 1, updated_at = ?
         WHERE bsc_tx_hash = ? AND bsc_log_index = ?`,
      )
      .run(status, extras?.zebvix_submit_tx ?? null, extras?.last_error ?? null, now, txHash, logIndex);
  }

  // ── Cursors ─────────────────────────────────────────────────────────────

  getCursor(name: string): number {
    const row = this.db.prepare(`SELECT value FROM cursors WHERE name = ?`).get(name) as { value: number } | undefined;
    return row?.value ?? 0;
  }

  setCursor(name: string, value: number) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO cursors (name, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(name, value, now);
  }

  // ── Stats (for /health endpoint) ────────────────────────────────────────

  stats() {
    const z = this.db.prepare(
      `SELECT status, COUNT(*) as n FROM processed_zebvix_events GROUP BY status`,
    ).all() as { status: string; n: number }[];
    const b = this.db.prepare(
      `SELECT status, COUNT(*) as n FROM processed_bsc_burns GROUP BY status`,
    ).all() as { status: string; n: number }[];
    return {
      zebvix: Object.fromEntries(z.map((r) => [r.status, r.n])),
      bsc: Object.fromEntries(b.map((r) => [r.status, r.n])),
    };
  }

  close() {
    this.db.close();
  }
}
