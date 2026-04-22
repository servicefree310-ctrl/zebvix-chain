//! Block-STM: Aptos-style optimistic parallel execution engine.
//!
//! # Status: SCAFFOLD (v0.3 target)
//!
//! Block-STM lets a block of transactions execute concurrently across all CPU
//! cores while preserving sequential semantics. The expected speed-up is
//! **10-50x** for typical workloads (high contention reduces the gain).
//!
//! ## Algorithm sketch
//!
//! 1. **Speculative parallel execution.** Workers pick the next un-executed
//!    transaction by index and run it against a versioned multi-value store.
//!    Each tx records its read-set and write-set.
//!
//! 2. **Validation.** After execution, a tx is validated by re-checking its
//!    read-set against the latest committed versions. If any value it read has
//!    been overwritten by a *lower-indexed* tx, the tx is **aborted** and
//!    re-scheduled for re-execution.
//!
//! 3. **Commit.** Validated txs commit in index order; their writes become the
//!    new "latest" version visible to higher-indexed txs.
//!
//! ## Why not in v0.1
//!
//! - The current `apply_tx` uses a simple RocksDB read-modify-write pattern.
//!   To support speculation we need an in-memory MVCC layer over RocksDB.
//! - Conflict-free transfers (different `from`/`to`) are easy; contention
//!   patterns (DEX swaps, single-pool deposits) need careful scheduling.
//!
//! ## Files this module will touch when implemented
//!
//! - `state.rs` — split `apply_tx` into `read_set` + `write_set` builders.
//! - `consensus.rs` — replace the sequential apply loop with `BlockStm::execute`.
//! - `crypto.rs` — already provides `verify_txs_batch` (parallel + batch sigs).
//!
//! For now this module exposes a placeholder `BlockStm` type so other code can
//! reference the future API without compile errors.

use crate::types::SignedTx;

/// Placeholder Block-STM executor.
///
/// In v0.3 this will own the MVCC store, the worker thread pool (Rayon),
/// and the per-tx validation/abort/retry logic.
pub struct BlockStm {
    pub max_workers: usize,
}

impl BlockStm {
    /// Create a new Block-STM executor sized to available CPU cores.
    pub fn new() -> Self {
        Self {
            max_workers: rayon::current_num_threads(),
        }
    }

    /// Returns the planned execution mode for a given batch size.
    /// Useful for telemetry until the real engine lands.
    pub fn plan(&self, txs: &[SignedTx]) -> ExecutionPlan {
        if txs.len() < 16 {
            ExecutionPlan::Sequential
        } else {
            ExecutionPlan::Parallel {
                workers: self.max_workers.min(txs.len() / 4).max(1),
                expected_speedup: estimate_speedup(txs.len(), self.max_workers),
            }
        }
    }
}

impl Default for BlockStm {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy)]
pub enum ExecutionPlan {
    Sequential,
    Parallel { workers: usize, expected_speedup: f32 },
}

fn estimate_speedup(tx_count: usize, workers: usize) -> f32 {
    // Amdahl-style estimate assuming 85% parallelizable work.
    let p = 0.85f32;
    let n = workers.min(tx_count.max(1)) as f32;
    1.0 / ((1.0 - p) + p / n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_block_picks_sequential() {
        let stm = BlockStm::new();
        let plan = stm.plan(&[]);
        matches!(plan, ExecutionPlan::Sequential);
    }
}
