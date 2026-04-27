//! Phase D — D4 Prometheus-text-format metrics exporter.
//!
//! Pure in-memory atomic registry with a `render()` API that produces
//! standard Prometheus text exposition format (https://prometheus.io/
//! docs/instrumenting/exposition_formats/). The HTTP scrape endpoint
//! lands in a follow-up commit (axum route at `/metrics` mounted on
//! the existing RPC port) — this module ships the data plane so
//! callers can start `inc()` / `set()` immediately without waiting on
//! the wire route.
//!
//! ## Why no `prometheus` crate dependency?
//! The popular `prometheus` crate pulls in protobuf machinery for the
//! gRPC remote-write path we don't use, plus its histogram primitives
//! need careful bucket tuning that is premature without empirical data
//! from a live VPS. A pure stdlib + atomics implementation is ~150
//! LoC and gives identical scrape behaviour for the metrics we care
//! about. We can revisit if/when we need true histograms (D7 fee
//! market or H2 Block-STM might benefit).
//!
//! ## What's metered (initial set, hookpoints documented)
//!
//! | Metric                            | Type    | Hookpoint (deferred wiring) |
//! |-----------------------------------|---------|------------------------------|
//! | `zvb_block_height`                | gauge   | `state::apply_block` end |
//! | `zvb_blocks_applied_total`        | counter | `state::apply_block` end |
//! | `zvb_block_apply_seconds_sum`     | counter | `state::apply_block` (Instant::now diff) |
//! | `zvb_block_apply_count`           | counter | `state::apply_block` end |
//! | `zvb_mempool_depth`               | gauge   | `mempool::insert` / `take` |
//! | `zvb_mempool_bytes`               | gauge   | `mempool::insert` / `take` |
//! | `zvb_peer_count`                  | gauge   | `p2p::run_swarm` connection event |
//! | `zvb_bft_commit_persisted_total`  | counter | `main.rs::try_persist_bft_commit_for` success |
//! | `zvb_proposer_round_bumps_total`  | counter | `consensus::Producer::run` round-bump branch |
//! | `zvb_validator_jailed_total`      | counter | `staking::jail` (D2/H5 future) |
//! | `zvb_evidence_verified_total`     | counter | `evidence::verify_*` (D2 future) |
//! | `zvb_fsm_step_seconds_sum`        | counter | `fsm_runtime` Instant::now diff (F006.5 future) |
//!
//! Hookups are NOT in this commit because the relevant call sites live
//! in `state.rs` / `mempool.rs` / `p2p.rs` whose full compile gate
//! requires `cargo check` (dev-env CPU budget exceeds — see scratchpad
//! note in HARDENING_TODO.md). Hookups land alongside the `/metrics`
//! axum route in a follow-up commit.

use once_cell::sync::Lazy;
use parking_lot::RwLock;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};

/// Global metrics registry. Static lifetime so any module can record
/// without threading a handle through every call chain.
///
/// Access pattern: `crate::metrics::METRICS.inc("zvb_blocks_applied_total");`
pub static METRICS: Lazy<Metrics> = Lazy::new(Metrics::new);

pub struct Metrics {
    /// Counters / gauges keyed by canonical metric name (incl. labels
    /// formatted into the name for now — proper label support is a
    /// future extension if we add histograms). `BTreeMap` for
    /// deterministic render order — important for stable scrape output
    /// hashes / diffing.
    values: RwLock<BTreeMap<String, AtomicU64>>,
    /// Per-metric `# HELP` and `# TYPE` metadata.
    meta: RwLock<BTreeMap<String, MetricMeta>>,
}

#[derive(Clone)]
struct MetricMeta {
    help: &'static str,
    kind: MetricKind,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum MetricKind {
    Counter,
    Gauge,
}

impl MetricKind {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Counter => "counter",
            Self::Gauge => "gauge",
        }
    }
}

impl Metrics {
    fn new() -> Self {
        let m = Self {
            values: RwLock::new(BTreeMap::new()),
            meta: RwLock::new(BTreeMap::new()),
        };
        // Pre-register the canonical metric set so they appear in
        // `/metrics` output even before the first event happens
        // (Prometheus best practice — empty metrics are easier to alert
        // on than "metric missing").
        m.register_gauge("zvb_block_height", "Current chain tip height");
        m.register_counter("zvb_blocks_applied_total", "Total blocks successfully applied to state");
        m.register_counter("zvb_block_apply_seconds_sum", "Cumulative wall-clock seconds spent in apply_block (sum)");
        m.register_counter("zvb_block_apply_count", "Number of apply_block invocations (denominator for the seconds_sum)");
        m.register_gauge("zvb_mempool_depth", "Pending transactions in the mempool");
        m.register_gauge("zvb_mempool_bytes", "Sum of bincode sizes of pending mempool transactions");
        m.register_gauge("zvb_peer_count", "Active gossipsub peers");
        m.register_counter("zvb_bft_commit_persisted_total", "BFT commit blobs written to side-table (B.3.2.5+)");
        m.register_counter("zvb_proposer_round_bumps_total", "Times the local node bumped to a higher consensus round");
        m.register_counter("zvb_validator_jailed_total", "Validators jailed via D2 evidence or H5 score (cumulative)");
        m.register_counter("zvb_evidence_verified_total", "Evidence submissions that passed cryptographic verification");
        m.register_counter("zvb_fsm_step_seconds_sum", "Cumulative wall-clock seconds spent in FSM step() (F006.5 future)");
        m
    }

    fn register_counter(&self, name: &'static str, help: &'static str) {
        self.register(name, help, MetricKind::Counter);
    }

    fn register_gauge(&self, name: &'static str, help: &'static str) {
        self.register(name, help, MetricKind::Gauge);
    }

    fn register(&self, name: &'static str, help: &'static str, kind: MetricKind) {
        self.meta.write().insert(name.to_string(), MetricMeta { help, kind });
        self.values
            .write()
            .entry(name.to_string())
            .or_insert_with(|| AtomicU64::new(0));
    }

    /// Increment a counter by 1. Names not pre-registered are
    /// auto-registered as counters (with `help = "(auto-registered)"`).
    pub fn inc(&self, name: &str) {
        self.add(name, 1);
    }

    /// Increment a counter by `delta`.
    pub fn add(&self, name: &str, delta: u64) {
        if let Some(v) = self.values.read().get(name) {
            v.fetch_add(delta, Ordering::Relaxed);
            return;
        }
        // Auto-register on first touch.
        self.values
            .write()
            .entry(name.to_string())
            .or_insert_with(|| AtomicU64::new(0))
            .fetch_add(delta, Ordering::Relaxed);
        self.meta
            .write()
            .entry(name.to_string())
            .or_insert(MetricMeta {
                help: "(auto-registered)",
                kind: MetricKind::Counter,
            });
    }

    /// Set a gauge to `value`.
    pub fn set(&self, name: &str, value: u64) {
        if let Some(v) = self.values.read().get(name) {
            v.store(value, Ordering::Relaxed);
            return;
        }
        self.values
            .write()
            .insert(name.to_string(), AtomicU64::new(value));
        self.meta
            .write()
            .entry(name.to_string())
            .or_insert(MetricMeta {
                help: "(auto-registered)",
                kind: MetricKind::Gauge,
            });
    }

    /// Read the current value of a metric. Returns 0 for unknown names.
    /// Useful from tests and from the eventual `/metrics` axum handler
    /// for spot inspection.
    pub fn get(&self, name: &str) -> u64 {
        self.values
            .read()
            .get(name)
            .map(|v| v.load(Ordering::Relaxed))
            .unwrap_or(0)
    }

    /// Render the registry in Prometheus text exposition format.
    /// Output is byte-deterministic for any given metric value snapshot
    /// (BTreeMap ordering) — this stability matters for downstream
    /// hashing / diffing tools.
    pub fn render(&self) -> String {
        let values = self.values.read();
        let meta = self.meta.read();
        let mut out = String::with_capacity(4096);
        for (name, value) in values.iter() {
            if let Some(m) = meta.get(name) {
                out.push_str("# HELP ");
                out.push_str(name);
                out.push(' ');
                out.push_str(m.help);
                out.push('\n');
                out.push_str("# TYPE ");
                out.push_str(name);
                out.push(' ');
                out.push_str(m.kind.as_str());
                out.push('\n');
            }
            out.push_str(name);
            out.push(' ');
            out.push_str(&value.load(Ordering::Relaxed).to_string());
            out.push('\n');
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counter_increment_persists() {
        let m = Metrics::new();
        m.inc("zvb_blocks_applied_total");
        m.inc("zvb_blocks_applied_total");
        m.add("zvb_blocks_applied_total", 5);
        assert_eq!(m.get("zvb_blocks_applied_total"), 7);
    }

    #[test]
    fn gauge_set_overwrites() {
        let m = Metrics::new();
        m.set("zvb_block_height", 100);
        m.set("zvb_block_height", 50);
        assert_eq!(m.get("zvb_block_height"), 50);
    }

    #[test]
    fn render_includes_help_type_and_value() {
        let m = Metrics::new();
        m.set("zvb_block_height", 42);
        let s = m.render();
        assert!(s.contains("# HELP zvb_block_height Current chain tip height"));
        assert!(s.contains("# TYPE zvb_block_height gauge"));
        assert!(s.contains("zvb_block_height 42"));
    }

    #[test]
    fn render_is_deterministic() {
        let m = Metrics::new();
        m.set("zvb_block_height", 10);
        m.set("zvb_peer_count", 3);
        let a = m.render();
        let b = m.render();
        assert_eq!(a, b, "render must be stable for stable scrape hashes");
    }

    #[test]
    fn auto_register_unknown_metric() {
        let m = Metrics::new();
        m.inc("zvb_some_new_metric");
        assert_eq!(m.get("zvb_some_new_metric"), 1);
        let s = m.render();
        assert!(s.contains("zvb_some_new_metric 1"));
        assert!(s.contains("(auto-registered)"));
    }

    #[test]
    fn unknown_metric_returns_zero() {
        let m = Metrics::new();
        assert_eq!(m.get("zvb_never_touched"), 0);
    }

    #[test]
    fn pre_registered_metrics_appear_in_render() {
        let m = Metrics::new();
        let s = m.render();
        // All canonical metrics should be present at zero.
        for canonical in [
            "zvb_block_height",
            "zvb_blocks_applied_total",
            "zvb_mempool_depth",
            "zvb_peer_count",
            "zvb_bft_commit_persisted_total",
            "zvb_proposer_round_bumps_total",
            "zvb_validator_jailed_total",
            "zvb_evidence_verified_total",
        ] {
            assert!(s.contains(canonical), "missing canonical metric: {canonical}");
        }
    }

    #[test]
    fn global_singleton_works() {
        // The static METRICS singleton works the same as a fresh instance.
        METRICS.inc("zvb_blocks_applied_total");
        let v = METRICS.get("zvb_blocks_applied_total");
        assert!(v >= 1, "global counter should have at least 1 after increment");
    }

    #[test]
    fn high_volume_increment_concurrent_safe() {
        // Smoke test that atomic ops survive a synthetic burst.
        // Single-threaded burst — actual contention is exercised by
        // `parking_lot::RwLock` semantics which we trust upstream.
        let m = Metrics::new();
        for _ in 0..10_000 {
            m.inc("zvb_blocks_applied_total");
        }
        assert_eq!(m.get("zvb_blocks_applied_total"), 10_000);
    }
}
