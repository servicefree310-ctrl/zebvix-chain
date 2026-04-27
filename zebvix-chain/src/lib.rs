pub mod block_stm;
pub mod bridge;
pub mod consensus;
pub mod crypto;
pub mod evidence;
pub mod fsm;
pub mod fsm_runtime;
pub mod mempool;
pub mod metrics;
pub mod multisig;
pub mod p2p;
pub mod pool;
pub mod proposal;
pub mod rpc;
pub mod staking;
pub mod state;
pub mod token_pool;
pub mod tokenomics;
pub mod transaction;
pub mod types;
pub mod vote;

// Phase C — ZVM (Zebvix Virtual Machine). Gated behind the `zvm` cargo
// feature so existing operators are not forced to rebuild with revm-style
// deps until they want to enable Solidity execution on their node. With
// the feature off, these modules compile to nothing and the chain behaves
// exactly like the pre-Phase-C release. ZVM is fully EVM-bytecode
// compatible — the same Solidity contracts, ABI, and signing flow.
#[cfg(feature = "zvm")]
pub mod zvm;
#[cfg(feature = "zvm")]
pub mod zvm_interp;
#[cfg(feature = "zvm")]
pub mod zvm_state;
#[cfg(feature = "zvm")]
pub mod zvm_precompiles;
#[cfg(feature = "zvm")]
pub mod zvm_rpc;
#[cfg(feature = "zvm")]
pub mod zvm_rlp;
