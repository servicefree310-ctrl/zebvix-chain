// ================================================================
// Module: zebvix::pay_id
// ZBX Pay ID System — UPI-style human-readable address
// Rules:
//   - pay_id globally unique, display_name NOT unique
//   - full_id = pay_id + "@zbx" (auto-appended)
//   - PayId has key only (no store) — cannot transfer/delete
//   - One per address — second register = abort
// ================================================================
module zebvix::pay_id {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::table::{Self, Table};
    use sui::coin::{Self, Coin};
    use std::string::{Self, String};

    // ── Errors ──
    const E_NAME_EMPTY:         u64 = 1;
    const E_NAME_TAKEN:         u64 = 2;
    const E_ALREADY_REGISTERED: u64 = 3;
    const E_REGISTRY_NOT_FOUND: u64 = 4;
    const E_PAY_ID_NOT_FOUND:   u64 = 5;
    const E_DISPLAY_NAME_EMPTY: u64 = 6; // display_name cannot be empty

    // ── Global Registry (shared object — one instance on chain) ──
    public struct PayIdRegistry has key {
        id: UID,
        name_to_addr: Table<String, address>,   // pay_id → owner address
        addr_to_name: Table<address, String>,   // owner address → pay_id
    }

    // ── Pay ID object — has key ONLY (no store = cannot transfer) ──
    public struct PayId has key {
        id: UID,
        pay_id:       String,  // e.g. "rahul"        (unique)
        full_id:      String,  // e.g. "rahul@zbx"    (unique)
        display_name: String,  // e.g. "Rahul Kumar"  (NOT unique)
        owner:        address,
        created_epoch: u64,
    }

    // ── Initialize global registry (called once at genesis) ──
    fun init(ctx: &mut TxContext) {
        let registry = PayIdRegistry {
            id: object::new(ctx),
            name_to_addr: table::new(ctx),
            addr_to_name: table::new(ctx),
        };
        transfer::share_object(registry);
    }

    // ── Register a Pay ID ──
    public fun register_pay_id(
        registry:     &mut PayIdRegistry,
        pay_id:       vector<u8>,    // e.g. b"rahul"
        display_name: vector<u8>,    // e.g. b"Rahul Kumar" — mandatory, NOT unique
        ctx:          &mut TxContext,
    ) {
        let sender    = tx_context::sender(ctx);
        let id_str    = string::utf8(pay_id);
        let dname_str = string::utf8(display_name);

        // ── Validations ──
        assert!(string::length(&id_str)    > 0, E_NAME_EMPTY);
        assert!(string::length(&dname_str) > 0, E_DISPLAY_NAME_EMPTY);
        // NOTE: display_name has NO uniqueness check.
        //       "Rahul Kumar" naam do alag log rakh sakte hain.
        //       Sirf pay_id globally unique hota hai.
        assert!(!table::contains(&registry.addr_to_name, sender),  E_ALREADY_REGISTERED);
        assert!(!table::contains(&registry.name_to_addr, id_str),  E_NAME_TAKEN);

        // ── Build full ID: "rahul" + "@zbx" = "rahul@zbx" ──
        let mut full_id = id_str;
        string::append_utf8(&mut full_id, b"@zbx");

        // ── Register in bidirectional maps ──
        table::add(&mut registry.name_to_addr, id_str, sender);
        table::add(&mut registry.addr_to_name, sender, id_str);

        // ── Create immutable PayId object → owner ──
        let pay_id_obj = PayId {
            id:            object::new(ctx),
            pay_id:        id_str,
            full_id:       full_id,
            display_name:  dname_str,
            owner:         sender,
            created_epoch: tx_context::epoch(ctx),
        };

        // Transfer to owner — has key only, so this is a "transfer to sender"
        transfer::transfer(pay_id_obj, sender);
    }

    // ── Transfer coin to a Pay ID ──
    public fun transfer_to_pay_id<T>(
        registry: &PayIdRegistry,
        pay_id:   vector<u8>,
        coin:     Coin<T>,
        ctx:      &mut TxContext,
    ) {
        let id_str = string::utf8(pay_id);
        assert!(table::contains(&registry.name_to_addr, id_str), E_PAY_ID_NOT_FOUND);
        let recipient = *table::borrow(&registry.name_to_addr, id_str);
        transfer::public_transfer(coin, recipient);
    }

    // ── Resolve Pay ID → address ──
    public fun resolve_pay_id(
        registry: &PayIdRegistry,
        pay_id:   vector<u8>,
    ): address {
        let id_str = string::utf8(pay_id);
        assert!(table::contains(&registry.name_to_addr, id_str), E_PAY_ID_NOT_FOUND);
        *table::borrow(&registry.name_to_addr, id_str)
    }

    // ── Check if Pay ID available ──
    public fun is_name_available(
        registry: &PayIdRegistry,
        pay_id:   vector<u8>,
    ): bool {
        let id_str = string::utf8(pay_id);
        !table::contains(&registry.name_to_addr, id_str)
    }

    // ── Get address's Pay ID ──
    public fun get_pay_id_by_address(
        registry: &PayIdRegistry,
        addr:     address,
    ): String {
        assert!(table::contains(&registry.addr_to_name, addr), E_PAY_ID_NOT_FOUND);
        *table::borrow(&registry.addr_to_name, addr)
    }

    // ── View helpers ──
    public fun get_pay_id(pay_id_obj: &PayId): String     { pay_id_obj.pay_id }
    public fun get_full_id(pay_id_obj: &PayId): String    { pay_id_obj.full_id }
    public fun get_display_name(pay_id_obj: &PayId): String { pay_id_obj.display_name }
    public fun get_owner(pay_id_obj: &PayId): address     { pay_id_obj.owner }
    public fun get_created_epoch(pay_id_obj: &PayId): u64 { pay_id_obj.created_epoch }

    // ── Registry stats ──
    public fun total_registered(registry: &PayIdRegistry): u64 {
        table::length(&registry.name_to_addr)
    }
}
