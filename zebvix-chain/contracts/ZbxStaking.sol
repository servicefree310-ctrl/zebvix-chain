// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IZBX } from "./interfaces/IZBX.sol";

/// @title ZbxStaking — single-pool ZBX staking with linear reward stream
/// @author Zebvix Technologies Pvt Ltd
/// @notice Users stake ZBX (any ERC-20-compatible token, but designed for
///         the wrapped ZBX BEP-20) and earn rewards proportional to their
///         share of the pool times time elapsed. Reward token can be the
///         same as the staking token (auto-compound style) or a separate
///         token (e.g. zUSD as yield).
///
/// @dev    Reward accounting follows the SushiSwap MasterChef pattern:
///             accRewardPerShare += (timeElapsed * rewardRate) / totalStaked
///             pendingReward(user) = user.stake * accRewardPerShare
///                                   - user.rewardDebt
///         Math is done in 1e18 fixed point so dust is well below 1 wei.
///         Funder must pre-fund `rewardToken` balance into the contract.
contract ZbxStaking {
    // ---------------------------------------------------------------------
    // Immutable wiring
    // ---------------------------------------------------------------------

    /// @notice Token users stake. Must implement standard ERC-20.
    address public immutable stakingToken;

    /// @notice Token used for reward payouts. May equal `stakingToken`.
    address public immutable rewardToken;

    // ---------------------------------------------------------------------
    // Mutable state
    // ---------------------------------------------------------------------

    /// @notice Reward emission rate in `rewardToken` wei per second.
    ///         Founder can update via `setRewardRate`.
    uint256 public rewardRate;

    /// @notice Last block timestamp at which `accRewardPerShare` was updated.
    uint256 public lastUpdateTime;

    /// @notice Accumulated rewards per staked wei, scaled by `ACC_PRECISION`.
    uint256 public accRewardPerShare;

    /// @notice Total currently staked.
    uint256 public totalStaked;

    /// @notice Total reward-token amount owed to all users (accrued via
    ///         updatePool() but not yet claimed). Maintained as a running
    ///         liability so `recoverExcessRewards` can never drain into
    ///         user-owned tokens — closes the architect-review High bug.
    uint256 public totalOwed;

    /// @notice Founder address — emergency pause + rate updates.
    address public founder;
    bool    public paused;

    /// @notice Per-user state.
    struct UserInfo {
        uint256 stake;        // amount of stakingToken held by this user
        uint256 rewardDebt;   // already-credited rewards (accrual baseline)
        uint256 pending;      // unclaimed rewards parked from prior updates
    }
    mapping(address => UserInfo) public users;

    uint256 private constant ACC_PRECISION = 1e18;

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

    error NotFounder();
    error PausedErr();
    error ZeroAmount();
    error InsufficientStake(uint256 requested, uint256 available);
    error TransferFailed();

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Staked(address indexed user, uint256 amount, uint256 newStake);
    event Unstaked(address indexed user, uint256 amount, uint256 newStake);
    event RewardPaid(address indexed user, uint256 amount);
    event RewardRateUpdated(uint256 oldRate, uint256 newRate);
    event PausedSet(bool isPaused);
    event FounderTransferred(address indexed from, address indexed to);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(
        address _stakingToken,
        address _rewardToken,
        uint256 _rewardRate,
        address _founder
    ) {
        require(_stakingToken != address(0) && _rewardToken != address(0)
                && _founder != address(0), "ZERO_ADDRESS");

        stakingToken    = _stakingToken;
        rewardToken     = _rewardToken;
        rewardRate      = _rewardRate;
        founder         = _founder;
        lastUpdateTime  = block.timestamp;
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

    /// @dev Pulls fresh rewards into `accRewardPerShare` and saves the
    ///      checkpoint timestamp. Called at the top of every state-mutating
    ///      user action so per-user math stays consistent.
    modifier updatePool() {
        if (block.timestamp > lastUpdateTime && totalStaked > 0) {
            uint256 elapsed = block.timestamp - lastUpdateTime;
            uint256 reward = elapsed * rewardRate;
            accRewardPerShare += (reward * ACC_PRECISION) / totalStaked;
            // Mirror the freshly-accrued reward in the global liability
            // counter — every wei that just became claimable belongs to a
            // user and must NOT be sweepable by `recoverExcessRewards`.
            unchecked { totalOwed += reward; }
        }
        lastUpdateTime = block.timestamp;
        _;
    }

    // ---------------------------------------------------------------------
    // User actions
    // ---------------------------------------------------------------------

    function stake(uint256 amount)
        external
        nonReentrant
        whenNotPaused
        updatePool
    {
        if (amount == 0) revert ZeroAmount();
        UserInfo storage u = users[msg.sender];

        // Park any pending rewards from prior stake before changing stake.
        if (u.stake > 0) {
            uint256 fresh = (u.stake * accRewardPerShare) / ACC_PRECISION;
            u.pending += fresh - u.rewardDebt;
        }

        // Pull tokens in.
        _safeTransferFrom(stakingToken, msg.sender, address(this), amount);

        unchecked {
            u.stake     += amount;
            totalStaked += amount;
        }
        u.rewardDebt = (u.stake * accRewardPerShare) / ACC_PRECISION;

        emit Staked(msg.sender, amount, u.stake);
    }

    function unstake(uint256 amount)
        external
        nonReentrant
        updatePool
    {
        if (amount == 0) revert ZeroAmount();
        UserInfo storage u = users[msg.sender];
        if (amount > u.stake) revert InsufficientStake(amount, u.stake);

        // Park earned rewards.
        uint256 fresh = (u.stake * accRewardPerShare) / ACC_PRECISION;
        u.pending += fresh - u.rewardDebt;

        unchecked {
            u.stake     -= amount;
            totalStaked -= amount;
        }
        u.rewardDebt = (u.stake * accRewardPerShare) / ACC_PRECISION;

        _safeTransfer(stakingToken, msg.sender, amount);
        emit Unstaked(msg.sender, amount, u.stake);
    }

    /// @notice Claim accumulated rewards without changing stake.
    function claim() external nonReentrant updatePool {
        UserInfo storage u = users[msg.sender];

        uint256 fresh = (u.stake * accRewardPerShare) / ACC_PRECISION;
        uint256 owed = u.pending + (fresh - u.rewardDebt);
        u.pending    = 0;
        u.rewardDebt = fresh;

        if (owed > 0) {
            // Liability has been satisfied; release from the global counter.
            // (Capped subtraction defends against rounding dust below
            // totalOwed in pathological corner cases.)
            totalOwed = owed > totalOwed ? 0 : totalOwed - owed;
            _safeTransfer(rewardToken, msg.sender, owed);
            emit RewardPaid(msg.sender, owed);
        }
    }

    /// @notice Bypass-pool withdrawal — forfeit rewards to recover stake.
    ///         Founder pause cannot block this so users always have an exit.
    /// @dev    Does NOT call updatePool to avoid the pause from blocking
    ///         exit. Forfeited rewards stay in `totalOwed` until the next
    ///         updatePool() flushes them — conservative but safe (it only
    ///         keeps `recoverExcessRewards` more restrictive, never less).
    function emergencyUnstake() external nonReentrant {
        UserInfo storage u = users[msg.sender];
        uint256 amount = u.stake;
        if (amount == 0) revert ZeroAmount();

        // Release this user's accrual baseline + parked pending from the
        // global owed counter — they are explicitly forfeiting them.
        uint256 fresh = (u.stake * accRewardPerShare) / ACC_PRECISION;
        uint256 forfeit = u.pending + (fresh > u.rewardDebt ? fresh - u.rewardDebt : 0);
        if (forfeit > 0) {
            totalOwed = forfeit > totalOwed ? 0 : totalOwed - forfeit;
        }

        u.stake      = 0;
        u.rewardDebt = 0;
        u.pending    = 0;
        unchecked { totalStaked -= amount; }

        _safeTransfer(stakingToken, msg.sender, amount);
        emit Unstaked(msg.sender, amount, 0);
    }

    // ---------------------------------------------------------------------
    // Read helpers
    // ---------------------------------------------------------------------

    /// @notice View pending reward for `user` without mutating state.
    function pendingReward(address user) external view returns (uint256) {
        UserInfo memory u = users[user];
        uint256 acc = accRewardPerShare;
        if (block.timestamp > lastUpdateTime && totalStaked > 0) {
            uint256 elapsed = block.timestamp - lastUpdateTime;
            uint256 reward = elapsed * rewardRate;
            acc += (reward * ACC_PRECISION) / totalStaked;
        }
        uint256 fresh = (u.stake * acc) / ACC_PRECISION;
        return u.pending + (fresh - u.rewardDebt);
    }

    // ---------------------------------------------------------------------
    // Founder ops
    // ---------------------------------------------------------------------

    function setRewardRate(uint256 newRate) external onlyFounder updatePool {
        emit RewardRateUpdated(rewardRate, newRate);
        rewardRate = newRate;
    }

    function setPaused(bool _p) external onlyFounder {
        paused = _p;
        emit PausedSet(_p);
    }

    function transferFounder(address newFounder) external onlyFounder {
        require(newFounder != address(0), "ZERO_ADDRESS");
        emit FounderTransferred(founder, newFounder);
        founder = newFounder;
    }

    /// @notice Founder can withdraw stranded `rewardToken` (excess beyond
    ///         what's needed to cover all current user obligations).
    ///         Cannot drain user principal OR accrued user rewards.
    /// @dev    Architect-review High fix: reserve includes `totalOwed`
    ///         (running per-user reward liability tracked by updatePool +
    ///         claim + emergencyUnstake) on top of `totalStaked` when the
    ///         staking and reward tokens are the same.
    function recoverExcessRewards(address to, uint256 amount)
        external
        onlyFounder
        updatePool
    {
        require(to != address(0), "ZERO_ADDRESS");
        uint256 bal = _balanceOf(rewardToken, address(this));
        uint256 reserve = totalOwed
            + ((rewardToken == stakingToken) ? totalStaked : 0);
        require(amount + reserve <= bal, "INSUFFICIENT_FREE_BALANCE");
        _safeTransfer(rewardToken, to, amount);
    }

    // ---------------------------------------------------------------------
    // ERC-20 helpers (no SafeERC20 import — minimal inline)
    // ---------------------------------------------------------------------

    function _balanceOf(address token, address who) internal view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(
            abi.encodeWithSignature("balanceOf(address)", who)
        );
        require(ok && data.length >= 32, "BALANCEOF_FAILED");
        return abi.decode(data, (uint256));
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool))))
            revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool))))
            revert TransferFailed();
    }
}
