// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title WrappedZBX (wZBX)
 * @notice BEP-20 representation of native ZBX on BNB Smart Chain.
 *         Backed 1:1 by ZBX locked in the on-chain escrow vault on the Zebvix L1.
 *
 * @dev    Trust model:
 *          - `MINTER_ROLE` is granted ONLY to the ZebvixBridge contract on
 *            deploy. The bridge contract requires M-of-N validator signatures
 *            to mint, so a single compromised validator cannot inflate supply.
 *          - `PAUSER_ROLE` and `DEFAULT_ADMIN_ROLE` are granted to the
 *            governance Safe (Gnosis Safe multisig). Governance can pause the
 *            token in an emergency and rotate the bridge address if needed.
 *          - Holders can always burn their own balance (`burn`). The bridge
 *            uses this for the burn-to-Zebvix flow (user calls `burnToZebvix`
 *            on the bridge, which calls `burnFrom` here after approval).
 *
 *         Decimals: 18 (matches Zebvix native ZBX).
 */
contract WrappedZBX is ERC20, ERC20Burnable, ERC20Pausable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Emitted when minter is granted (i.e. bridge contract address set/changed).
    event MinterGranted(address indexed minter);
    /// @notice Emitted when minter role is revoked.
    event MinterRevoked(address indexed minter);

    /**
     * @param admin       The governance Safe address (gets DEFAULT_ADMIN_ROLE + PAUSER_ROLE).
     * @param initialMinter The initial bridge contract address (gets MINTER_ROLE).
     *                    Pass address(0) to defer; admin can grant later.
     */
    constructor(address admin, address initialMinter)
        ERC20("Wrapped ZBX", "wZBX")
    {
        require(admin != address(0), "wZBX: admin = 0");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        if (initialMinter != address(0)) {
            _grantRole(MINTER_ROLE, initialMinter);
            emit MinterGranted(initialMinter);
        }
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    /**
     * @notice Mint wZBX. Restricted to MINTER_ROLE — i.e. ZebvixBridge contract.
     * @dev    Bridge enforces M-of-N signatures + replay protection BEFORE calling this.
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @notice Convenience: governance grants minter role to a new bridge contract.
    function grantMinter(address minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(minter != address(0), "wZBX: minter = 0");
        _grantRole(MINTER_ROLE, minter);
        emit MinterGranted(minter);
    }

    /// @notice Convenience: governance revokes minter role from an old bridge contract.
    function revokeMinter(address minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(MINTER_ROLE, minter);
        emit MinterRevoked(minter);
    }

    // Required override for OpenZeppelin v5 ERC20Pausable + ERC20.
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable)
    {
        super._update(from, to, value);
    }
}
