// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IBridgeVault } from "./interfaces/IBridgeVault.sol";

/// @title BridgeMultisig — N-of-M oracle multisig for the Zebvix → BSC mint
/// @author Zebvix Technologies Pvt Ltd
/// @notice Each relayer in the oracle set independently watches Zebvix
///         `BridgeOutEvent`s and submits an EIP-191 personal-sign signature
///         to this contract via `submitMint`. Once `threshold` distinct
///         signatures arrive for the same `(zebvixSeq, to, amount)` tuple
///         the contract calls `BridgeVault.executeMint`, which then mints
///         wrapped ZBX to the user via the token's vault-only mint path.
///
/// @dev    Phase B.12 deploys a 1-of-1 single-key oracle (founder.key).
///         Phase B.13 upgrades to 5-of-7 with independent relayer custody.
///
///         Vault-deadlock fix (post-architect-review): vault is mutable +
///         set-once via `setVault(address)` then permanently locked. This
///         lets the deploy script create Multisig first, then Vault (which
///         needs the multisig address), then call `setVault` + `lockVault`
///         on both the multisig and the token.
contract BridgeMultisig {
    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice Domain tag mixed into the personal-sign digest so a relayer
    ///         signature is bound to *this* bridge / chain / vault tuple
    ///         and cannot be replayed across deployments.
    bytes32 private constant _DOMAIN_TAG = keccak256("ZEBVIX_BRIDGE_MINT_v1");

    // ---------------------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------------------

    /// @notice BridgeVault address (set once via setVault, then locked).
    address public vault;
    bool    public vaultLocked;

    /// @notice Quorum size. Immutable so an owner can't reduce it post-deploy.
    uint256 public immutable threshold; // M

    // ---------------------------------------------------------------------
    // Mutable state
    // ---------------------------------------------------------------------

    address public founder;
    bool    public paused;

    /// @notice Active relayer set. Founder can rotate via `setRelayers`.
    address[] private _relayers;
    mapping(address => bool) public isRelayer;

    /// @notice Per-zebvixSeq, per-relayer voting record. Prevents the same
    ///         relayer signing twice for the same seq.
    mapping(uint64 => mapping(address => bool)) public votedBy;

    /// @notice Per-zebvixSeq vote count + canonical (to, amount) the
    ///         relayers must agree on. First valid signature defines them;
    ///         later signatures must match exactly or are rejected.
    struct Tally {
        uint64  count;
        address to;
        uint256 amount;
        bool    executed;
    }
    mapping(uint64 => Tally) public tallies;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotFounder();
    error PausedErr();
    error NotRelayer(address who);
    error AlreadyVoted(uint64 seq, address who);
    error AlreadyExecuted(uint64 seq);
    error MismatchedTally(uint64 seq, address to, uint256 amount);
    error InvalidSignature();
    error EmptyRelayers();
    error ThresholdAboveSet();
    error VaultNotSet();
    error VaultAlreadyLocked();
    error ZeroAddress();

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Voted(uint64 indexed zebvixSeq, address indexed relayer, uint64 count);
    event Executed(uint64 indexed zebvixSeq, address indexed to, uint256 amount);
    event RelayersUpdated(address[] relayers);
    event FounderTransferred(address indexed from, address indexed to);
    event PausedSet(bool isPaused);
    event VaultSet(address indexed vault);
    event VaultLocked();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(
        address[] memory initialRelayers,
        uint256 _threshold,
        address _founder
    ) {
        if (_founder == address(0)) revert ZeroAddress();
        if (initialRelayers.length == 0) revert EmptyRelayers();
        if (_threshold == 0 || _threshold > initialRelayers.length) revert ThresholdAboveSet();

        threshold = _threshold;
        founder   = _founder;
        _setRelayers(initialRelayers);
    }

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyFounder() {
        if (msg.sender != founder) revert NotFounder();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedErr();
        _;
    }

    modifier vaultReady() {
        if (vault == address(0)) revert VaultNotSet();
        _;
    }

    // ---------------------------------------------------------------------
    // Vault wiring (set + lock)
    // ---------------------------------------------------------------------

    function setVault(address _vault) external onlyFounder {
        if (vaultLocked) revert VaultAlreadyLocked();
        if (_vault == address(0)) revert ZeroAddress();
        vault = _vault;
        emit VaultSet(_vault);
    }

    function lockVault() external onlyFounder {
        if (vault == address(0)) revert VaultNotSet();
        if (vaultLocked) revert VaultAlreadyLocked();
        vaultLocked = true;
        emit VaultLocked();
    }

    // ---------------------------------------------------------------------
    // Submit a mint vote
    // ---------------------------------------------------------------------

    /// @notice A relayer (or anyone, on behalf of a relayer) submits an
    ///         EIP-191 sig. Once `threshold` distinct relayer sigs arrive
    ///         for `(seq, to, amount)`, the vault is invoked and the user
    ///         receives wrapped ZBX via the token's vault-only mint path.
    /// @param  zebvixSeq Sequence number from Zebvix `BridgeOutEvent`.
    /// @param  to        Recipient on BSC.
    /// @param  amount    Amount in 18-decimal wei.
    /// @param  v,r,s     EIP-191 personal_sign signature components.
    function submitMint(
        uint64 zebvixSeq,
        address to,
        uint256 amount,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public whenNotPaused vaultReady {
        // 1. Recover signer.
        bytes32 inner = keccak256(
            abi.encode(_DOMAIN_TAG, block.chainid, vault, zebvixSeq, to, amount)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", inner)
        );
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
        if (!isRelayer[signer]) revert NotRelayer(signer);

        // 2. Replay/dup checks.
        Tally storage t = tallies[zebvixSeq];
        if (t.executed) revert AlreadyExecuted(zebvixSeq);
        if (votedBy[zebvixSeq][signer]) revert AlreadyVoted(zebvixSeq, signer);

        // 3. Lock canonical (to, amount) on first vote; reject mismatches.
        if (t.count == 0) {
            t.to = to;
            t.amount = amount;
        } else if (t.to != to || t.amount != amount) {
            revert MismatchedTally(zebvixSeq, to, amount);
        }

        votedBy[zebvixSeq][signer] = true;
        unchecked {
            t.count += 1;
        }

        emit Voted(zebvixSeq, signer, t.count);

        // 4. If quorum reached, execute mint via vault. Vault is the sole
        //    minter on the token; it passes `zebvixSeq` explicitly to the
        //    token's `bridgeMint(to, amount, seq)`. No transient storage.
        if (t.count >= threshold) {
            t.executed = true;
            IBridgeVault(vault).executeMint(to, amount, zebvixSeq);
            emit Executed(zebvixSeq, to, amount);
        }
    }

    /// @notice Variant that accepts a batch of pre-collected sigs in one tx.
    ///         Internal call (not `this.`) so a single relayer's bad sig
    ///         doesn't cost the others gas. Bails on the first reverting
    ///         sig — caller should prune duplicates / post-quorum sigs.
    function submitMintBatch(
        uint64 zebvixSeq,
        address to,
        uint256 amount,
        uint8[] calldata vs,
        bytes32[] calldata rs,
        bytes32[] calldata ss
    ) external whenNotPaused vaultReady {
        require(vs.length == rs.length && rs.length == ss.length, "LEN_MISMATCH");
        for (uint256 i = 0; i < vs.length; i++) {
            // Stop early if quorum already reached this batch — saves gas
            // and avoids the post-execute revert path.
            if (tallies[zebvixSeq].executed) break;
            submitMint(zebvixSeq, to, amount, vs[i], rs[i], ss[i]);
        }
    }

    // ---------------------------------------------------------------------
    // Founder ops
    // ---------------------------------------------------------------------

    function setPaused(bool _p) external onlyFounder {
        paused = _p;
        emit PausedSet(_p);
    }

    function transferFounder(address newFounder) external onlyFounder {
        if (newFounder == address(0)) revert ZeroAddress();
        emit FounderTransferred(founder, newFounder);
        founder = newFounder;
    }

    function setRelayers(address[] calldata newSet) external onlyFounder {
        if (newSet.length == 0) revert EmptyRelayers();
        if (threshold > newSet.length) revert ThresholdAboveSet();
        _setRelayers(newSet);
    }

    // ---------------------------------------------------------------------
    // Read helpers
    // ---------------------------------------------------------------------

    function relayers() external view returns (address[] memory) {
        return _relayers;
    }

    function relayerCount() external view returns (uint256) {
        return _relayers.length;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _setRelayers(address[] memory newSet) internal {
        // Clear old set.
        for (uint256 i = 0; i < _relayers.length; i++) {
            isRelayer[_relayers[i]] = false;
        }
        delete _relayers;

        // Install new set, dedup-checked.
        for (uint256 i = 0; i < newSet.length; i++) {
            address r = newSet[i];
            require(r != address(0), "ZERO_RELAYER");
            require(!isRelayer[r], "DUP_RELAYER");
            isRelayer[r] = true;
            _relayers.push(r);
        }

        emit RelayersUpdated(newSet);
    }
}
