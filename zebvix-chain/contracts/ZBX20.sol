// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IZBX } from "./interfaces/IZBX.sol";

/// @title ZBX20 — Wrapped Zebvix (ZBX) on BNB Chain
/// @author Zebvix Technologies Pvt Ltd
/// @notice Canonical BEP-20 / ERC-20 representation of native Zebvix L1 ZBX,
///         minted/burned only by the BridgeVault contract. Total supply on
///         this chain ≤ total ZBX locked in the Zebvix bridge vault
///         `0x7a627…0000` — verifiable on-chain on both sides.
///
/// @dev    Authority model (post-architect-review):
///         - `vault` is the sole bridge-mint/burn caller. It is set once via
///           `setVault(address)` then permanently locked, breaking the
///           constructor-deadlock cycle Multisig ↔ Vault ↔ Token while still
///           giving the deploy script a clean atomic init flow.
///         - `founder` keeps emergency pause + role rotation.
///         - All bridge events carry the Zebvix sequence number explicitly
///           — no transient storage / EIP-1153 cross-contract assumptions.
///         Solidity 0.8+ checked math used throughout.
contract ZBX20 is IZBX {
    // ---------------------------------------------------------------------
    // Token metadata
    // ---------------------------------------------------------------------

    string public constant override name = "Zebvix";
    string public constant override symbol = "ZBX";
    uint8  public constant override decimals = 18;

    // ---------------------------------------------------------------------
    // ERC-20 storage
    // ---------------------------------------------------------------------

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    // ---------------------------------------------------------------------
    // Bridge wiring (set-once, then immutable in practice)
    // ---------------------------------------------------------------------

    address public override vault;
    bool    public override vaultLocked;

    // ---------------------------------------------------------------------
    // Founder
    // ---------------------------------------------------------------------

    address public founder;
    bool    public paused;

    // ---------------------------------------------------------------------
    // EIP-2612 permit
    // ---------------------------------------------------------------------

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 private constant _PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    mapping(address => uint256) public nonces;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotVault();
    error NotFounder();
    error VaultAlreadyLocked();
    error VaultNotSet();
    error PausedErr();
    error ZeroAddress();
    error InsufficientBalance(uint256 requested, uint256 available);
    error InsufficientAllowance(uint256 requested, uint256 available);
    error PermitExpired(uint256 deadline, uint256 nowTs);
    error InvalidSignature();

    // ---------------------------------------------------------------------
    // Events (extra to those in IZBX)
    // ---------------------------------------------------------------------

    event FounderTransferred(address indexed from, address indexed to);
    event PausedSet(bool isPaused);
    event VaultLocked();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /// @param _founder  Address allowed to set the vault, pause, and rotate.
    constructor(address _founder) {
        if (_founder == address(0)) revert ZeroAddress();
        founder = _founder;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
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
    // Vault wiring (set + lock)
    // ---------------------------------------------------------------------

    /// @notice Founder sets the vault address once; can be re-set freely
    ///         until `lockVault()` is called, after which the address is
    ///         permanent.
    function setVault(address _vault) external onlyFounder {
        if (vaultLocked) revert VaultAlreadyLocked();
        if (_vault == address(0)) revert ZeroAddress();
        vault = _vault;
        emit VaultSet(_vault);
    }

    /// @notice Permanently lock the current vault address. After this, the
    ///         token's bridge authority is non-rotatable.
    function lockVault() external onlyFounder {
        if (vault == address(0)) revert VaultNotSet();
        if (vaultLocked) revert VaultAlreadyLocked();
        vaultLocked = true;
        emit VaultLocked();
    }

    // ---------------------------------------------------------------------
    // ERC-20 read API
    // ---------------------------------------------------------------------

    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view override returns (uint256) {
        return _balances[account];
    }

    function allowance(address owner, address spender)
        external
        view
        override
        returns (uint256)
    {
        return _allowances[owner][spender];
    }

    // ---------------------------------------------------------------------
    // ERC-20 write API
    // ---------------------------------------------------------------------

    function transfer(address to, uint256 amount)
        external
        override
        whenNotPaused
        returns (bool)
    {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount)
        external
        override
        returns (bool)
    {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external
        override
        whenNotPaused
        returns (bool)
    {
        uint256 currentAllowance = _allowances[from][msg.sender];
        if (currentAllowance != type(uint256).max) {
            if (currentAllowance < amount)
                revert InsufficientAllowance(amount, currentAllowance);
            unchecked {
                _allowances[from][msg.sender] = currentAllowance - amount;
            }
        }
        _transfer(from, to, amount);
        return true;
    }

    function increaseAllowance(address spender, uint256 added) external returns (bool) {
        _approve(msg.sender, spender, _allowances[msg.sender][spender] + added);
        return true;
    }

    function decreaseAllowance(address spender, uint256 subbed) external returns (bool) {
        uint256 cur = _allowances[msg.sender][spender];
        if (cur < subbed) revert InsufficientAllowance(subbed, cur);
        unchecked {
            _approve(msg.sender, spender, cur - subbed);
        }
        return true;
    }

    // ---------------------------------------------------------------------
    // Bridge: mint + burn (vault only)
    // ---------------------------------------------------------------------

    /// @inheritdoc IZBX
    function bridgeMint(address to, uint256 amount, uint64 zebvixSeq)
        external
        override
        onlyVault
        whenNotPaused
    {
        _mint(to, amount);
        emit BridgeMint(to, amount, zebvixSeq);
    }

    /// @inheritdoc IZBX
    function bridgeBurnFrom(
        address account,
        uint256 amount,
        bytes calldata zebvixDest
    )
        external
        override
        onlyVault
        whenNotPaused
    {
        // Vault must hold an allowance from `account` (set in advance via
        // standard ERC-20 `approve` or EIP-2612 `permit`). Vault's own
        // allowance is consumed here.
        uint256 cur = _allowances[account][msg.sender];
        if (cur != type(uint256).max) {
            if (cur < amount) revert InsufficientAllowance(amount, cur);
            unchecked {
                _allowances[account][msg.sender] = cur - amount;
            }
        }
        _burn(account, amount);
        emit BridgeBurn(account, amount, zebvixDest);
    }

    // ---------------------------------------------------------------------
    // EIP-2612 permit
    // ---------------------------------------------------------------------

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (block.timestamp > deadline) revert PermitExpired(deadline, block.timestamp);

        bytes32 structHash = keccak256(
            abi.encode(_PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0) || recovered != owner) revert InvalidSignature();

        _approve(owner, spender, value);
    }

    // ---------------------------------------------------------------------
    // Founder ops
    // ---------------------------------------------------------------------

    function setPaused(bool _paused) external onlyFounder {
        paused = _paused;
        emit PausedSet(_paused);
    }

    function transferFounder(address newFounder) external onlyFounder {
        if (newFounder == address(0)) revert ZeroAddress();
        emit FounderTransferred(founder, newFounder);
        founder = newFounder;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _transfer(address from, address to, uint256 amount) internal {
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        uint256 fromBal = _balances[from];
        if (fromBal < amount) revert InsufficientBalance(amount, fromBal);
        unchecked {
            _balances[from] = fromBal - amount;
            _balances[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        _totalSupply += amount;
        unchecked {
            _balances[to] += amount;
        }
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        if (from == address(0)) revert ZeroAddress();
        uint256 cur = _balances[from];
        if (cur < amount) revert InsufficientBalance(amount, cur);
        unchecked {
            _balances[from] = cur - amount;
            _totalSupply -= amount;
        }
        emit Transfer(from, address(0), amount);
    }

    function _approve(address owner, address spender, uint256 amount) internal {
        if (owner == address(0) || spender == address(0)) revert ZeroAddress();
        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }
}
