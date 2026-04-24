// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IZBX } from "./interfaces/IZBX.sol";
import { IBridgeVault } from "./interfaces/IBridgeVault.sol";

/// @title BridgeVault — BSC-side lock/release vault for wrapped ZBX
/// @author Zebvix Technologies Pvt Ltd
/// @notice Two-way teleport between the BNB Chain ZBX BEP-20 token and
///         native Zebvix L1 ZBX. Uses a burn-and-emit / mint-on-quorum
///         pattern so circulating supply on BSC is always ≤ amount locked
///         in the Zebvix native bridge vault `0x7a627…0000`.
///
/// @dev    Authority chain (post-architect-review):
///             user ─approve→ vault
///             user ─lock()→ vault ─bridgeBurnFrom→ token (vault is sole burner)
///
///             relayer ─submitMint→ multisig ─executeMint→ vault
///                                          (multisig is sole executeMint caller)
///             vault ─bridgeMint(seq)→ token (vault is sole minter)
///
///         All replay protection lives on the vault; multisig only verifies
///         signatures. Reentrancy guarded with inlined OZ pattern.
contract BridgeVault is IBridgeVault {
    // ---------------------------------------------------------------------
    // Immutable wiring
    // ---------------------------------------------------------------------

    address public immutable override token;     // ZBX20
    address public immutable override multisig;  // BridgeMultisig

    // ---------------------------------------------------------------------
    // Mutable state
    // ---------------------------------------------------------------------

    address public founder;
    bool    public override paused;

    /// @notice Monotonic vault-side sequence number for `Locked` events.
    ///         Combined with `block.chainid` it produces a globally-unique
    ///         `source_tx_hash` for Zebvix replay protection.
    uint64 public override nextSeq = 1;

    /// @notice Outstanding wrapped ZBX in circulation = mints - burns.
    ///         Always equal to `IZBX(token).totalSupply()` if invariants hold.
    uint256 public override totalLocked;

    /// @notice Replay-protection set: `executeMint` may only credit each
    ///         Zebvix outbound sequence once.
    mapping(uint64 => bool) private _processedZebvixSeq;

    // ---------------------------------------------------------------------
    // Reentrancy guard
    // ---------------------------------------------------------------------

    uint256 private constant _ENTRY_FREE = 1;
    uint256 private constant _ENTRY_LOCKED = 2;
    uint256 private _entry = _ENTRY_FREE;

    modifier nonReentrant() {
        require(_entry == _ENTRY_FREE, "REENTRANCY");
        _entry = _ENTRY_LOCKED;
        _;
        _entry = _ENTRY_FREE;
    }

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotMultisig();
    error NotFounder();
    error PausedErr();
    error ZeroAmount();
    error InvalidDest();
    error AlreadyProcessed(uint64 zebvixSeq);
    error TransferFailed();
    error InsufficientLocked(uint256 amount, uint256 totalLockedNow);

    // ---------------------------------------------------------------------
    // Events (on top of IBridgeVault's)
    // ---------------------------------------------------------------------

    event FounderTransferred(address indexed from, address indexed to);
    event Recovered(address indexed token, address indexed to, uint256 amount);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address _token, address _multisig, address _founder) {
        require(_token != address(0) && _multisig != address(0) && _founder != address(0),
                "ZERO_ADDRESS");
        token    = _token;
        multisig = _multisig;
        founder  = _founder;
    }

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyMultisig() {
        if (msg.sender != multisig) revert NotMultisig();
        _;
    }

    modifier onlyFounder() {
        if (msg.sender != founder) revert NotFounder();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedErr();
        _;
    }

    // ---------------------------------------------------------------------
    // BSC → Zebvix (lock + emit)
    // ---------------------------------------------------------------------

    /// @inheritdoc IBridgeVault
    function lock(uint256 amount, bytes calldata zebvixDest)
        external
        override
        nonReentrant
        whenNotPaused
        returns (uint64 seq)
    {
        if (amount == 0) revert ZeroAmount();
        if (zebvixDest.length != 20) revert InvalidDest();
        if (amount > totalLocked) revert InsufficientLocked(amount, totalLocked);

        // Burn from caller — caller must have approved this vault on the
        // token contract for at least `amount`. Burn shrinks BSC supply.
        IZBX(token).bridgeBurnFrom(msg.sender, amount, zebvixDest);

        seq = nextSeq++;
        unchecked {
            // Burn just reduced totalSupply on the token; mirror it locally
            // so `totalLocked` stays equal to `token.totalSupply()`.
            totalLocked -= amount;
        }

        emit Locked(msg.sender, amount, zebvixDest, seq);
    }

    /// @inheritdoc IBridgeVault
    function lockWithPermit(
        uint256 amount,
        bytes calldata zebvixDest,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override nonReentrant whenNotPaused returns (uint64 seq) {
        if (amount == 0) revert ZeroAmount();
        if (zebvixDest.length != 20) revert InvalidDest();
        if (amount > totalLocked) revert InsufficientLocked(amount, totalLocked);

        // EIP-2612 permit lets us skip the separate approve() tx.
        // Use low-level call so IZBX doesn't need to expose permit().
        (bool ok, ) = token.call(
            abi.encodeWithSignature(
                "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
                msg.sender,
                address(this),
                amount,
                deadline,
                v, r, s
            )
        );
        if (!ok) revert TransferFailed();

        IZBX(token).bridgeBurnFrom(msg.sender, amount, zebvixDest);

        seq = nextSeq++;
        unchecked {
            totalLocked -= amount;
        }

        emit Locked(msg.sender, amount, zebvixDest, seq);
    }

    // ---------------------------------------------------------------------
    // Zebvix → BSC (multisig-gated mint)
    // ---------------------------------------------------------------------

    /// @inheritdoc IBridgeVault
    function executeMint(address to, uint256 amount, uint64 zebvixSeq)
        external
        override
        onlyMultisig
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert InvalidDest();
        if (_processedZebvixSeq[zebvixSeq]) revert AlreadyProcessed(zebvixSeq);

        _processedZebvixSeq[zebvixSeq] = true;

        unchecked {
            totalLocked += amount;
        }

        // Vault is the sole minter on the token (set via setVault → lockVault).
        // Pass `zebvixSeq` explicitly — no transient-storage hacks.
        IZBX(token).bridgeMint(to, amount, zebvixSeq);

        emit Minted(to, amount, zebvixSeq);
    }

    // ---------------------------------------------------------------------
    // Read helpers
    // ---------------------------------------------------------------------

    /// @inheritdoc IBridgeVault
    function isZebvixSeqProcessed(uint64 zebvixSeq)
        external
        view
        override
        returns (bool)
    {
        return _processedZebvixSeq[zebvixSeq];
    }

    // ---------------------------------------------------------------------
    // Founder ops
    // ---------------------------------------------------------------------

    function setPaused(bool _p) external onlyFounder {
        paused = _p;
        emit PausedSet(_p);
    }

    function transferFounder(address newFounder) external onlyFounder {
        require(newFounder != address(0), "ZERO_ADDRESS");
        emit FounderTransferred(founder, newFounder);
        founder = newFounder;
    }

    /// @notice Sweep stray tokens (not ZBX) accidentally sent to the vault.
    ///         Cannot be used to drain ZBX — that would break the bridge
    ///         invariant. Founder-only emergency.
    function recoverStray(address strayToken, address to, uint256 amount)
        external
        onlyFounder
    {
        require(strayToken != token, "CANNOT_RECOVER_ZBX");
        require(to != address(0), "ZERO_ADDRESS");

        (bool ok, bytes memory data) = strayToken.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, amount)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "RECOVERY_FAILED");
        emit Recovered(strayToken, to, amount);
    }
}
