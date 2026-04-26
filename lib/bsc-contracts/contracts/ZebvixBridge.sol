// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import {IWrappedZBX} from "./interfaces/IWrappedZBX.sol";

/**
 * @title  ZebvixBridge
 * @notice M-of-N multisig bridge contract on BNB Smart Chain.
 *         Mints wZBX based on validator signatures attesting that ZBX was
 *         locked on the Zebvix L1. Burns wZBX to trigger an unlock on Zebvix.
 *
 * @dev    Trust model:
 *          - **Per-mint**: Off-chain signature aggregation. Each of N validators
 *            independently signs an EIP-712 typed `MintRequest`. The relayer
 *            collects M signatures and submits them in one tx. The contract
 *            verifies M unique validator signatures + replay protection.
 *          - **Governance** (`onlyOwner`): Add/remove validators, change
 *            threshold, pause, set wZBX address. Owner is intended to be a
 *            Gnosis Safe multisig — separate from the validator set, so even
 *            full validator compromise can't change governance.
 *
 *         Replay protection: `consumed[sourceTxHash]` is checked + set
 *         atomically. Each Zebvix BridgeOut tx hash can only mint once.
 *
 *         Burn flow: user calls `burnToZebvix(zebvixAddr, amount)`. Contract
 *         burns the caller's wZBX and emits `BurnToZebvix(seq, ...)`. The
 *         relayer detects this and submits `zbx_submitBridgeIn` on Zebvix.
 */
contract ZebvixBridge is EIP712, Ownable, Pausable, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.AddressSet;

    // ─────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────

    /// @dev EIP-712 type hash for MintRequest. Must EXACTLY match the off-chain
    ///      relayer/signer encoding.
    bytes32 public constant MINT_REQUEST_TYPEHASH = keccak256(
        "MintRequest(bytes32 sourceTxHash,address recipient,uint256 amount,uint256 sourceChainId,uint64 sourceBlockHeight)"
    );

    /// @notice Hard limit on validator count. EnumerableSet ops are O(N) for
    ///         remove; keeping N small guarantees gas predictability and
    ///         signature-loop bounds.
    uint256 public constant MAX_VALIDATORS = 64;

    // ─────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────

    IWrappedZBX public wZBX;
    EnumerableSet.AddressSet private _validators;
    uint256 public threshold;
    /// @notice The chain id of the Zebvix L1. Included in the EIP-712 payload
    ///         to prevent cross-chain replay if a sister bridge ever exists.
    uint256 public immutable zebvixChainId;
    /// @notice Source tx hashes (Zebvix BridgeOut tx hashes) already minted
    ///         on this contract. Prevents double-mint.
    mapping(bytes32 sourceTxHash => bool) public consumed;
    /// @notice Monotonic burn sequence number — the relayer pairs this with
    ///         the on-chain Zebvix `BridgeIn` claim.
    uint64 public burnSeq;

    // ─────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────

    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event ThresholdChanged(uint256 oldThreshold, uint256 newThreshold);
    event WZbxChanged(address indexed oldWZbx, address indexed newWZbx);

    /// @notice Emitted on every successful mint. Indexed by source hash so
    ///         off-chain auditors can quickly verify "this Zebvix lock got
    ///         the matching mint on BSC".
    event MintFromZebvix(
        bytes32 indexed sourceTxHash,
        address indexed recipient,
        uint256 amount,
        uint256 sourceBlockHeight,
        uint256 signatureCount
    );

    /// @notice Emitted when a user burns wZBX to redeem on Zebvix.
    event BurnToZebvix(
        uint64 indexed seq,
        address indexed burner,
        string zebvixAddress,
        uint256 amount,
        uint256 timestamp
    );

    // ─────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────

    struct MintRequest {
        bytes32 sourceTxHash;
        address recipient;
        uint256 amount;
        uint256 sourceChainId;
        uint64 sourceBlockHeight;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────

    /**
     * @param owner            Gnosis Safe address that controls governance.
     * @param wZBXAddress      The deployed WrappedZBX contract address.
     * @param initialValidators Bootstrap validator set (length must be >= initialThreshold).
     * @param initialThreshold M-of-N: minimum signatures required per mint.
     * @param _zebvixChainId   Zebvix L1 chain id (e.g. 7878). Embedded in EIP-712 payload.
     */
    constructor(
        address owner,
        address wZBXAddress,
        address[] memory initialValidators,
        uint256 initialThreshold,
        uint256 _zebvixChainId
    ) EIP712("ZebvixBridge", "1") Ownable(owner) {
        require(owner != address(0), "Bridge: owner = 0");
        require(wZBXAddress != address(0), "Bridge: wZBX = 0");
        require(_zebvixChainId > 0, "Bridge: bad chainId");
        require(initialThreshold > 0, "Bridge: threshold = 0");
        require(initialValidators.length >= initialThreshold, "Bridge: validators < threshold");
        require(initialValidators.length <= MAX_VALIDATORS, "Bridge: too many validators");

        wZBX = IWrappedZBX(wZBXAddress);
        zebvixChainId = _zebvixChainId;
        threshold = initialThreshold;
        emit ThresholdChanged(0, initialThreshold);
        emit WZbxChanged(address(0), wZBXAddress);

        for (uint256 i = 0; i < initialValidators.length; i++) {
            address v = initialValidators[i];
            require(v != address(0), "Bridge: validator = 0");
            require(_validators.add(v), "Bridge: duplicate validator");
            emit ValidatorAdded(v);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Core: mint (Zebvix → BSC)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * @notice Mint wZBX based on M-of-N validator attestations of a Zebvix lock.
     * @param req         The mint request, signed by validators off-chain.
     * @param signatures  Array of EIP-712 ECDSA signatures (65 bytes each).
     *                    Order doesn't matter, but each signature must come from
     *                    a unique active validator. Length must be >= threshold.
     *
     * @dev Reverts if:
     *      - paused
     *      - source already consumed (replay)
     *      - sourceChainId != zebvixChainId (cross-chain replay guard)
     *      - signatures.length < threshold
     *      - any sig from a non-validator OR same validator signs twice
     *      - recipient == 0 OR amount == 0
     */
    function mintFromZebvix(MintRequest calldata req, bytes[] calldata signatures)
        external
        whenNotPaused
        nonReentrant
    {
        require(req.recipient != address(0), "Bridge: recipient = 0");
        require(req.amount > 0, "Bridge: amount = 0");
        require(req.sourceChainId == zebvixChainId, "Bridge: bad source chain");
        require(!consumed[req.sourceTxHash], "Bridge: already consumed");
        require(signatures.length >= threshold, "Bridge: insufficient sigs");

        // Mark consumed FIRST (CEI pattern) — extra defense beyond nonReentrant.
        consumed[req.sourceTxHash] = true;

        bytes32 digest = _hashMintRequest(req);

        // Verify M unique validator signatures. We track seen signers in a
        // local `address[]` of bounded size (signatures.length) to reject
        // duplicates without using storage.
        address[] memory seen = new address[](signatures.length);
        uint256 seenCount = 0;

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ECDSA.recover(digest, signatures[i]);
            require(signer != address(0), "Bridge: bad signature");
            require(_validators.contains(signer), "Bridge: not a validator");

            // Reject duplicate signer (linear scan; bounded by sig count).
            for (uint256 j = 0; j < seenCount; j++) {
                require(seen[j] != signer, "Bridge: duplicate signer");
            }
            seen[seenCount++] = signer;
        }

        // Mint after all checks pass.
        wZBX.mint(req.recipient, req.amount);

        emit MintFromZebvix(
            req.sourceTxHash,
            req.recipient,
            req.amount,
            req.sourceBlockHeight,
            seenCount
        );
    }

    /**
     * @notice EIP-712 typed-data digest for off-chain signing.
     * @dev    Public so signer services can independently compute the same
     *         digest and the dashboard can display it for transparency.
     */
    function hashMintRequest(MintRequest calldata req) external view returns (bytes32) {
        return _hashMintRequest(req);
    }

    function _hashMintRequest(MintRequest calldata req) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    MINT_REQUEST_TYPEHASH,
                    req.sourceTxHash,
                    req.recipient,
                    req.amount,
                    req.sourceChainId,
                    req.sourceBlockHeight
                )
            )
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Core: burn (BSC → Zebvix)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * @notice Burn caller's wZBX and emit a redeem request for the Zebvix L1.
     * @param zebvixAddress  The 0x-prefixed Zebvix recipient address (EVM-format).
     * @param amount         wZBX amount to burn (18 decimals).
     *
     * @dev    Caller must have approved this contract OR call from an account
     *         with the wZBX balance. We use `burnFrom` so the bridge
     *         contract can burn caller's tokens with their consent.
     *
     *         The user must first approve(bridge, amount) on the wZBX contract.
     *         The dashboard will guide the two-step UX.
     */
    function burnToZebvix(string calldata zebvixAddress, uint256 amount)
        external
        whenNotPaused
        nonReentrant
    {
        require(amount > 0, "Bridge: amount = 0");
        // Validate Zebvix address format (0x + 40 hex). Cheap on-chain check.
        require(_isValidEvmAddress(zebvixAddress), "Bridge: bad zebvix addr");

        wZBX.burnFrom(msg.sender, amount);
        uint64 seq = ++burnSeq;
        emit BurnToZebvix(seq, msg.sender, zebvixAddress, amount, block.timestamp);
    }

    /// @dev String validator: must be 42 chars, "0x" prefix, 40 lowercase or
    ///      uppercase hex digits. Mixed case allowed (no checksum enforced
    ///      since Zebvix addresses are normalized lowercase).
    function _isValidEvmAddress(string calldata s) internal pure returns (bool) {
        bytes memory b = bytes(s);
        if (b.length != 42) return false;
        if (b[0] != "0" || (b[1] != "x" && b[1] != "X")) return false;
        for (uint256 i = 2; i < 42; i++) {
            bytes1 c = b[i];
            bool isHex = (c >= 0x30 && c <= 0x39) // 0-9
                || (c >= 0x41 && c <= 0x46) // A-F
                || (c >= 0x61 && c <= 0x66); // a-f
            if (!isHex) return false;
        }
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Governance (onlyOwner = Gnosis Safe)
    // ─────────────────────────────────────────────────────────────────────

    function addValidator(address v) external onlyOwner {
        require(v != address(0), "Bridge: validator = 0");
        require(_validators.length() < MAX_VALIDATORS, "Bridge: max validators");
        require(_validators.add(v), "Bridge: already validator");
        emit ValidatorAdded(v);
    }

    function removeValidator(address v) external onlyOwner {
        require(_validators.remove(v), "Bridge: not a validator");
        require(_validators.length() >= threshold, "Bridge: would break threshold");
        emit ValidatorRemoved(v);
    }

    function setThreshold(uint256 newThreshold) external onlyOwner {
        require(newThreshold > 0, "Bridge: threshold = 0");
        require(newThreshold <= _validators.length(), "Bridge: threshold > validators");
        uint256 old = threshold;
        threshold = newThreshold;
        emit ThresholdChanged(old, newThreshold);
    }

    function setWZbx(address newWZbx) external onlyOwner {
        require(newWZbx != address(0), "Bridge: wZBX = 0");
        address old = address(wZBX);
        wZBX = IWrappedZBX(newWZbx);
        emit WZbxChanged(old, newWZbx);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────

    function validatorCount() external view returns (uint256) {
        return _validators.length();
    }

    function validators() external view returns (address[] memory) {
        return _validators.values();
    }

    function isValidator(address v) external view returns (bool) {
        return _validators.contains(v);
    }

    /// @notice Returns the EIP-712 domain separator. Useful for off-chain signers.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
