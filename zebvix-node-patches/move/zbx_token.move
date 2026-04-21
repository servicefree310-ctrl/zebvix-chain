// ================================================================
// Module: zebvix::zbx
// ZBX Native Token — Zebvix Chain
// ================================================================
module zebvix::zbx {
    use sui::coin::{Self, Coin, TreasuryCap};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::object::{Self, UID};
    use std::option;

    // ── Token struct ──
    public struct ZBX has drop {}

    // ── Constants ──
    const DECIMALS:     u8      = 9;
    const SYMBOL:       vector<u8> = b"ZBX";
    const NAME:         vector<u8> = b"Zebvix";
    const DESCRIPTION:  vector<u8> = b"Native token of Zebvix Chain — Zebvix Technologies Pvt Ltd";
    const ICON_URL:     vector<u8> = b"https://zebvix.io/logo.png";

    const MAX_SUPPLY_MIST: u64 = 150_000_000_000_000_000; // 150M ZBX in MIST
    const GENESIS_SUPPLY_MIST: u64 = 2_000_000_000_000_000; // 2M ZBX

    // ── Errors ──
    const E_MAX_SUPPLY_EXCEEDED: u64 = 1;

    // ── MintCap: held by staking pool for block rewards ──
    public struct MintAuthority has key, store {
        id: UID,
        total_minted_mist: u64,
    }

    // ── One-time witness: initialize token ──
    fun init(witness: ZBX, ctx: &mut TxContext) {
        let (mut treasury_cap, metadata) = coin::create_currency(
            witness,
            DECIMALS,
            SYMBOL,
            NAME,
            DESCRIPTION,
            option::some(sui::url::new_unsafe_from_bytes(ICON_URL)),
            ctx,
        );

        // Mint genesis supply → founder treasury
        let genesis_coin = coin::mint(&mut treasury_cap, GENESIS_SUPPLY_MIST, ctx);
        transfer::public_transfer(genesis_coin, tx_context::sender(ctx));

        // Freeze metadata (immutable)
        transfer::public_freeze_object(metadata);

        // Share treasury cap (used for block reward minting by protocol)
        let mint_auth = MintAuthority {
            id: object::new(ctx),
            total_minted_mist: GENESIS_SUPPLY_MIST,
        };
        transfer::share_object(mint_auth);

        // Transfer treasury cap to founder
        transfer::public_transfer(treasury_cap, tx_context::sender(ctx));
    }

    // ── Mint block reward (called by staking pool only) ──
    public fun mint_block_reward(
        treasury_cap: &mut TreasuryCap<ZBX>,
        mint_auth: &mut MintAuthority,
        amount_mist: u64,
        ctx: &mut TxContext,
    ): Coin<ZBX> {
        assert!(
            mint_auth.total_minted_mist + amount_mist <= MAX_SUPPLY_MIST,
            E_MAX_SUPPLY_EXCEEDED
        );
        mint_auth.total_minted_mist = mint_auth.total_minted_mist + amount_mist;
        coin::mint(treasury_cap, amount_mist, ctx)
    }

    // ── View functions ──
    public fun total_minted(mint_auth: &MintAuthority): u64 {
        mint_auth.total_minted_mist
    }

    public fun total_minted_zbx(mint_auth: &MintAuthority): u64 {
        mint_auth.total_minted_mist / 1_000_000_000
    }

    public fun remaining_mintable(mint_auth: &MintAuthority): u64 {
        MAX_SUPPLY_MIST - mint_auth.total_minted_mist
    }
}
