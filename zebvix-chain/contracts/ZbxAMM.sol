// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ZbxAMM — Uniswap V2-style constant-product AMM pair (single-pool)
/// @author Zebvix Technologies Pvt Ltd
/// @notice Holds reserves of two ERC-20 tokens (e.g. ZBX/zUSD or ZBX/BNB
///         via WBNB) and enforces the invariant `reserve0 * reserve1 = k`.
///         Charges a 0.30 % swap fee; LP shares are minted as ERC-20 LP
///         tokens that represent a proportional claim on the reserves.
///
/// @dev    Mirrors the public surface of UniswapV2Pair so existing routers
///         and analytics work unmodified. No factory — single instance per
///         token pair, deployed by founder. Math is the original Uniswap V2
///         formulas, ported to Solidity 0.8 (built-in overflow checks; the
///         `unchecked` blocks are kept where the original used uint112
///         packing).
contract ZbxAMM {
    // ---------------------------------------------------------------------
    // Immutable wiring
    // ---------------------------------------------------------------------

    /// @notice token0 < token1 (sorted) so the pair canonical-form is unique.
    address public immutable token0;
    address public immutable token1;

    string  public constant name     = "Zebvix LP";
    string  public constant symbol   = "ZBX-LP";
    uint8   public constant decimals = 18;

    /// @notice Minimum liquidity locked forever in the contract on first
    ///         mint — prevents the pool being drained to zero (which would
    ///         brick price discovery for future LPs). Same value as Uni V2.
    uint256 public constant MINIMUM_LIQUIDITY = 10**3;

    /// @notice 0.30 % swap fee, expressed as `(1 - 30/10000)` numerator.
    ///         Fee accrues to LPs by way of `k` growing on every swap.
    uint256 private constant FEE_NUM = 9970;
    uint256 private constant FEE_DEN = 10000;

    // ---------------------------------------------------------------------
    // ERC-20 LP token storage
    // ---------------------------------------------------------------------

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ---------------------------------------------------------------------
    // Reserves + price oracle
    // ---------------------------------------------------------------------

    uint112 private _reserve0;
    uint112 private _reserve1;
    uint32  private _blockTimestampLast;

    /// @notice TWAP cumulative prices (Uni V2 formulas), scaled by 2^112.
    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;

    /// @notice Last `reserve0 * reserve1` after the most recent mint/burn.
    ///         Used to detect protocol fees if enabled (we keep `feeOn=false`
    ///         to give 100 % of the trading fee to LPs).
    uint256 public kLast;

    // ---------------------------------------------------------------------
    // Reentrancy
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

    error IdenticalAddresses();
    error InsufficientLiquidityMinted();
    error InsufficientLiquidityBurned();
    error InsufficientOutputAmount();
    error InsufficientInputAmount();
    error InsufficientLiquidity();
    error InvalidTo();
    error K();
    error Overflow();

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address _tokenA, address _tokenB) {
        if (_tokenA == _tokenB) revert IdenticalAddresses();
        require(_tokenA != address(0) && _tokenB != address(0), "ZERO_ADDRESS");

        // Sort so the pair has a canonical orientation.
        (token0, token1) = _tokenA < _tokenB
            ? (_tokenA, _tokenB)
            : (_tokenB, _tokenA);
    }

    // ---------------------------------------------------------------------
    // ERC-20 LP token
    // ---------------------------------------------------------------------

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value)
        external
        returns (bool)
    {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= value, "ZBXLP/INSUF_ALLOWANCE");
            unchecked { allowance[from][msg.sender] = a - value; }
        }
        _transfer(from, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) private {
        require(to != address(0) && from != address(0), "ZBXLP/ZERO");
        uint256 bal = balanceOf[from];
        require(bal >= value, "ZBXLP/INSUF_BAL");
        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to]  += value;
        }
        emit Transfer(from, to, value);
    }

    function _mintLp(address to, uint256 value) private {
        totalSupply += value;
        unchecked { balanceOf[to] += value; }
        emit Transfer(address(0), to, value);
    }

    function _burnLp(address from, uint256 value) private {
        uint256 bal = balanceOf[from];
        require(bal >= value, "ZBXLP/INSUF_BAL");
        unchecked {
            balanceOf[from] = bal - value;
            totalSupply    -= value;
        }
        emit Transfer(from, address(0), value);
    }

    // ---------------------------------------------------------------------
    // Reserve view + sync
    // ---------------------------------------------------------------------

    function getReserves()
        public
        view
        returns (
            uint112 reserve0,
            uint112 reserve1,
            uint32 blockTimestampLast
        )
    {
        reserve0           = _reserve0;
        reserve1           = _reserve1;
        blockTimestampLast = _blockTimestampLast;
    }

    /// @dev Update reserves + cumulative-price oracle. Borrowed verbatim
    ///      from UniswapV2Pair._update.
    function _update(
        uint256 balance0,
        uint256 balance1,
        uint112 reserve0_,
        uint112 reserve1_
    ) private {
        if (balance0 > type(uint112).max || balance1 > type(uint112).max)
            revert Overflow();

        uint32 blockTimestamp = uint32(block.timestamp % 2**32);
        uint32 timeElapsed;
        unchecked {
            timeElapsed = blockTimestamp - _blockTimestampLast;
        }

        if (timeElapsed > 0 && reserve0_ != 0 && reserve1_ != 0) {
            // Encode reserves as UQ112x112 fixed point: shift left 112.
            unchecked {
                price0CumulativeLast +=
                    (uint256(reserve1_) << 112) / reserve0_ * timeElapsed;
                price1CumulativeLast +=
                    (uint256(reserve0_) << 112) / reserve1_ * timeElapsed;
            }
        }

        _reserve0 = uint112(balance0);
        _reserve1 = uint112(balance1);
        _blockTimestampLast = blockTimestamp;

        emit Sync(_reserve0, _reserve1);
    }

    // ---------------------------------------------------------------------
    // mint / burn (called by router after sending tokens to this contract)
    // ---------------------------------------------------------------------

    /// @notice Caller must transfer token0 + token1 to this contract first,
    ///         then call `mint(to)`. Returns LP tokens minted.
    function mint(address to) external nonReentrant returns (uint256 liquidity) {
        (uint112 r0, uint112 r1, ) = getReserves();
        uint256 bal0 = _bal(token0);
        uint256 bal1 = _bal(token1);
        uint256 amount0 = bal0 - r0;
        uint256 amount1 = bal1 - r1;

        uint256 _totalSupply = totalSupply;
        if (_totalSupply == 0) {
            liquidity = _sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            // Permanently lock MINIMUM_LIQUIDITY by minting to address(0).
            _mintLp(address(0), MINIMUM_LIQUIDITY);
        } else {
            uint256 a = (amount0 * _totalSupply) / r0;
            uint256 b = (amount1 * _totalSupply) / r1;
            liquidity = a < b ? a : b;
        }
        if (liquidity == 0) revert InsufficientLiquidityMinted();

        _mintLp(to, liquidity);
        _update(bal0, bal1, r0, r1);
        kLast = uint256(_reserve0) * uint256(_reserve1);

        emit Mint(msg.sender, amount0, amount1);
    }

    /// @notice Caller must transfer LP tokens to this contract first,
    ///         then call `burn(to)` to redeem underlying.
    function burn(address to)
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        (uint112 r0, uint112 r1, ) = getReserves();
        uint256 bal0 = _bal(token0);
        uint256 bal1 = _bal(token1);
        uint256 liquidity = balanceOf[address(this)];

        uint256 _totalSupply = totalSupply;
        amount0 = (liquidity * bal0) / _totalSupply;
        amount1 = (liquidity * bal1) / _totalSupply;
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidityBurned();

        _burnLp(address(this), liquidity);
        _safeTransfer(token0, to, amount0);
        _safeTransfer(token1, to, amount1);

        bal0 = _bal(token0);
        bal1 = _bal(token1);
        _update(bal0, bal1, r0, r1);
        kLast = uint256(_reserve0) * uint256(_reserve1);

        emit Burn(msg.sender, amount0, amount1, to);
    }

    // ---------------------------------------------------------------------
    // swap — low-level Uni V2 surface
    // ---------------------------------------------------------------------

    /// @notice Caller must transfer the input token to this contract first,
    ///         specify the desired outputs, and `to` cannot be either token
    ///         (prevents flash-callback abuse). Enforces `k` invariant net
    ///         of the 0.30 % fee.
    function swap(
        uint256 amount0Out,
        uint256 amount1Out,
        address to
    ) external nonReentrant {
        if (amount0Out == 0 && amount1Out == 0) revert InsufficientOutputAmount();
        (uint112 r0, uint112 r1, ) = getReserves();
        if (amount0Out >= r0 || amount1Out >= r1) revert InsufficientLiquidity();
        if (to == token0 || to == token1) revert InvalidTo();

        if (amount0Out > 0) _safeTransfer(token0, to, amount0Out);
        if (amount1Out > 0) _safeTransfer(token1, to, amount1Out);

        uint256 bal0 = _bal(token0);
        uint256 bal1 = _bal(token1);
        uint256 amount0In = bal0 > r0 - amount0Out ? bal0 - (r0 - amount0Out) : 0;
        uint256 amount1In = bal1 > r1 - amount1Out ? bal1 - (r1 - amount1Out) : 0;
        if (amount0In == 0 && amount1In == 0) revert InsufficientInputAmount();

        // Apply 0.30 % fee on the input legs and check k invariant.
        uint256 bal0Adj = (bal0 * FEE_DEN) - (amount0In * (FEE_DEN - FEE_NUM));
        uint256 bal1Adj = (bal1 * FEE_DEN) - (amount1In * (FEE_DEN - FEE_NUM));
        if (bal0Adj * bal1Adj < uint256(r0) * uint256(r1) * (FEE_DEN ** 2))
            revert K();

        _update(bal0, bal1, r0, r1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    // ---------------------------------------------------------------------
    // Convenience: amountOut quoted at current reserves (off-chain helper)
    // ---------------------------------------------------------------------

    function getAmountOut(uint256 amountIn, address tokenIn)
        external
        view
        returns (uint256 amountOut)
    {
        (uint112 r0, uint112 r1, ) = getReserves();
        (uint256 reserveIn, uint256 reserveOut) =
            tokenIn == token0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        require(reserveIn > 0 && reserveOut > 0, "INSUF_LIQ");

        uint256 amountInWithFee = amountIn * FEE_NUM;
        amountOut = (amountInWithFee * reserveOut) /
                    (reserveIn * FEE_DEN + amountInWithFee);
    }

    // ---------------------------------------------------------------------
    // Internal — ERC-20 helpers + sqrt
    // ---------------------------------------------------------------------

    function _bal(address token) private view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(
            abi.encodeWithSignature("balanceOf(address)", address(this))
        );
        require(ok && data.length >= 32, "BAL_FAIL");
        return abi.decode(data, (uint256));
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, value)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "XFER_FAIL");
    }

    /// @dev Babylonian sqrt — same routine Uniswap V2 uses for initial mint.
    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
