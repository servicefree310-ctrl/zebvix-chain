// ================================================================
// Module: zebvix::founder_admin
// Founder Admin Capability
// Rules:
//   - FounderAdminCap: can add NEW features only
//   - CANNOT change: chain consensus, supply cap, address format,
//     tokenomics constants, block rewards, AMM rules, Pay ID rules
//   - Admin = MultiSig wallet (4/6 threshold)
//   - Chain core = IMMUTABLE even for founder
// ================================================================
module zebvix::founder_admin {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::event;
    use std::string::{Self, String};
    use std::vector;

    // ── Errors ──
    const E_NOT_ADMIN:             u64 = 1;
    const E_FEATURE_ALREADY_EXISTS: u64 = 2;
    const E_INVALID_FEATURE:       u64 = 3;

    // ── FounderAdminCap — held by admin MultiSig wallet ──
    public struct FounderAdminCap has key, store {
        id:         UID,
        admin_addr: address,  // MultiSig wallet address
        features_added: u64,  // counter
    }

    // ── FeatureRecord — on-chain log of added features ──
    public struct FeatureRecord has key {
        id:           UID,
        feature_name: String,
        feature_desc: String,
        added_by:     address,
        added_epoch:  u64,
        feature_id:   u64,
    }

    // ── Event: new feature added ──
    public struct FeatureAdded has copy, drop {
        feature_name: String,
        added_by:     address,
        epoch:        u64,
        feature_id:   u64,
    }

    // ── IMMUTABLE CORE — these constants can NEVER be changed via AdminCap ──
    // (These are defined in gas_coin.rs as Rust constants)
    // MAX_TOTAL_SUPPLY_ZBX = 150_000_000          ← IMMUTABLE
    // MAX_BURN_SUPPLY_ZBX  = 75_000_000           ← IMMUTABLE
    // MAX_VALIDATORS       = 41                   ← IMMUTABLE
    // SUI_ADDRESS_LENGTH   = 20                   ← IMMUTABLE
    // GAS_BURN_BPS         = 1000                 ← IMMUTABLE
    // GAS_VALIDATOR_BPS    = 7200                 ← IMMUTABLE
    // GAS_TREASURY_BPS     = 1800                 ← IMMUTABLE
    // MANUAL_LIQUIDITY     = DISABLED             ← IMMUTABLE

    // ── Initialize (genesis) ──
    fun init(ctx: &mut TxContext) {
        let cap = FounderAdminCap {
            id:             object::new(ctx),
            admin_addr:     tx_context::sender(ctx),
            features_added: 0,
        };
        transfer::transfer(cap, tx_context::sender(ctx));
    }

    // ── Transfer AdminCap to MultiSig wallet ──
    // Call this ONCE to move cap to your 4/6 MultiSig wallet
    public fun transfer_to_multisig(
        cap:          FounderAdminCap,
        multisig_addr: address,
    ) {
        transfer::transfer(cap, multisig_addr);
    }

    // ── Add a new feature (only what AdminCap holder can do) ──
    // This creates an on-chain record — actual feature is a new Move module
    // deployed separately via protocol upgrade
    public fun add_feature(
        cap:          &mut FounderAdminCap,
        feature_name: vector<u8>,
        feature_desc: vector<u8>,
        ctx:          &mut TxContext,
    ) {
        assert!(
            tx_context::sender(ctx) == cap.admin_addr,
            E_NOT_ADMIN
        );

        cap.features_added = cap.features_added + 1;
        let feature_id = cap.features_added;

        let record = FeatureRecord {
            id:           object::new(ctx),
            feature_name: string::utf8(feature_name),
            feature_desc: string::utf8(feature_desc),
            added_by:     tx_context::sender(ctx),
            added_epoch:  tx_context::epoch(ctx),
            feature_id:   feature_id,
        };

        event::emit(FeatureAdded {
            feature_name: string::utf8(feature_name),
            added_by:     tx_context::sender(ctx),
            epoch:        tx_context::epoch(ctx),
            feature_id:   feature_id,
        });

        transfer::share_object(record);
    }

    // ── Update admin address (requires current admin) ──
    // Use for MultiSig key rotation
    public fun update_admin(
        cap:      &mut FounderAdminCap,
        new_addr: address,
        ctx:      &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == cap.admin_addr, E_NOT_ADMIN);
        cap.admin_addr = new_addr;
    }

    // ── View functions ──
    public fun admin_addr(cap: &FounderAdminCap): address { cap.admin_addr }
    public fun features_added(cap: &FounderAdminCap): u64 { cap.features_added }

    // ── Feature record view ──
    public fun feature_name(r: &FeatureRecord): String  { r.feature_name }
    public fun feature_desc(r: &FeatureRecord): String  { r.feature_desc }
    public fun added_by(r: &FeatureRecord): address     { r.added_by }
    public fun added_epoch(r: &FeatureRecord): u64      { r.added_epoch }
    public fun feature_id(r: &FeatureRecord): u64       { r.feature_id }
}
