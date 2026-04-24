pub mod block_stm;
pub mod bridge;
pub mod consensus;
pub mod crypto;
pub mod mempool;
pub mod multisig;
pub mod p2p;
pub mod pool;
pub mod proposal;
pub mod rpc;
pub mod staking;
pub mod state;
pub mod tokenomics;
pub mod transaction;
pub mod types;
pub mod vote;

// Phase C — Native EVM layer. Gated behind the `evm` cargo feature so
// existing operators are not forced to rebuild with revm-style deps until
// they want to enable Solidity execution on their node. With the feature
// off, these modules compile to nothing and the chain behaves exactly
// like the pre-Phase-C release.
#[cfg(feature = "evm")]
pub mod evm;
#[cfg(feature = "evm")]
pub mod evm_interp;
#[cfg(feature = "evm")]
pub mod evm_state;
#[cfg(feature = "evm")]
pub mod evm_precompiles;
#[cfg(feature = "evm")]
pub mod evm_rpc;
#[cfg(feature = "evm")]
pub mod evm_rlp;
