import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:web3dart/credentials.dart';
import 'package:bip32/bip32.dart' as bip32;
import 'package:bip39/bip39.dart' as bip39;
import 'package:hex/hex.dart';
import '../core/balance_service.dart';
import '../core/chains.dart';
import '../core/rpc_client.dart';
import '../core/token_store.dart';
import '../core/wallet_store.dart';
import '../swap/swap_service.dart';
import '../theme.dart';
import '../widgets/glass_card.dart';

class SwapScreen extends StatefulWidget {
  const SwapScreen({super.key});

  @override
  State<SwapScreen> createState() => _SwapScreenState();
}

class _SwapScreenState extends State<SwapScreen> {
  late SwapService _svc;
  ChainConfig _chain = Chains.bsc; // BSC default — has PancakeSwap
  SwapToken? _tokenIn;
  SwapToken? _tokenOut;
  final _amountCtrl = TextEditingController();
  double _slippage = 1.0;
  bool _isBuy = true; // Buy = native → token, Sell = token → native
  Timer? _debounce;
  SwapQuote? _quote;
  bool _quoting = false;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _svc = SwapService(context.read<RpcRegistry>());
    _amountCtrl.addListener(_onAmountChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) => _initDefaults());
  }

  @override
  void dispose() {
    _amountCtrl.removeListener(_onAmountChanged);
    _amountCtrl.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _initDefaults() {
    _setupDefaultPair();
  }

  void _setupDefaultPair() {
    final native = SwapToken(
      chain: _chain,
      symbol: _chain.nativeSymbol,
      decimals: _chain.nativeDecimals,
    );
    SwapToken? other;
    if (_chain.id == 'bsc') {
      // Default: BNB ↔ wZBX (already known token).
      other = SwapToken(
        chain: _chain,
        symbol: 'wZBX',
        decimals: 18,
        contract: Chains.bsc.wrappedToken,
      );
    } else if (_chain.id == 'zebvix') {
      other = const SwapToken(
        chain: Chains.zebvix,
        symbol: 'ZUSD',
        decimals: 18,
        contract: '0x0000000000000000000000000000000000001100',
      );
    } else {
      // Use first custom token if any.
      final customs = context.read<TokenStore>().forChain(_chain.id);
      if (customs.isNotEmpty) {
        final t = customs.first;
        other = SwapToken(
          chain: _chain,
          symbol: t.symbol,
          decimals: t.decimals,
          contract: t.contract,
        );
      }
    }
    setState(() {
      _tokenIn = _isBuy ? native : (other ?? native);
      _tokenOut = _isBuy ? (other ?? native) : native;
    });
    _maybeQuote();
  }

  List<SwapToken> _availableTokens() {
    final out = <SwapToken>[
      SwapToken(
        chain: _chain,
        symbol: _chain.nativeSymbol,
        decimals: _chain.nativeDecimals,
      ),
    ];
    if (_chain.id == 'bsc' && _chain.wrappedToken != null) {
      out.add(SwapToken(
        chain: _chain,
        symbol: 'wZBX',
        decimals: 18,
        contract: _chain.wrappedToken,
      ));
    }
    if (_chain.id == 'zebvix') {
      out.add(const SwapToken(
        chain: Chains.zebvix,
        symbol: 'ZUSD',
        decimals: 18,
        contract: '0x0000000000000000000000000000000000001100',
      ));
    }
    final customs = context.read<TokenStore>().forChain(_chain.id);
    for (final c in customs) {
      out.add(SwapToken(
        chain: _chain,
        symbol: c.symbol,
        decimals: c.decimals,
        contract: c.contract,
      ));
    }
    return out;
  }

  void _onAmountChanged() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), _maybeQuote);
  }

  BigInt _parseAmount(String s, int decimals) {
    if (s.isEmpty) return BigInt.zero;
    final clean = s.replaceAll(',', '');
    final parts = clean.split('.');
    final whole = parts[0].isEmpty ? '0' : parts[0];
    final frac = parts.length > 1 ? parts[1] : '';
    final fracPad = frac.padRight(decimals, '0').substring(
        0, frac.length > decimals ? decimals : frac.length).padRight(decimals, '0');
    final s2 = '$whole$fracPad';
    return BigInt.parse(s2);
  }

  String _fmtAmount(BigInt wei, int decimals, [int dp = 6]) {
    if (wei == BigInt.zero) return '0';
    final divisor = BigInt.from(10).pow(decimals);
    final whole = wei ~/ divisor;
    final frac = wei - (whole * divisor);
    final n = whole.toDouble() + (frac.toDouble() / divisor.toDouble());
    if (n < 0.000001) return '<0.000001';
    return n.toStringAsFixed(dp).replaceAll(RegExp(r'0+$'), '').replaceAll(RegExp(r'\.$'), '');
  }

  Future<void> _maybeQuote() async {
    if (_tokenIn == null || _tokenOut == null) return;
    final inAmt = _parseAmount(_amountCtrl.text, _tokenIn!.decimals);
    if (inAmt == BigInt.zero) {
      setState(() {
        _quote = null;
        _error = null;
      });
      return;
    }
    setState(() {
      _quoting = true;
      _error = null;
    });
    try {
      SwapQuote? q;
      if (_chain.id == 'bsc') {
        q = await _svc.quoteBsc(
          tokenIn: _tokenIn!,
          tokenOut: _tokenOut!,
          amountInWei: inAmt,
          slippagePct: _slippage,
        );
      } else if (_chain.id == 'zebvix') {
        q = await _svc.quoteZebvix(
          tokenIn: _tokenIn!,
          tokenOut: _tokenOut!,
          amountInWei: inAmt,
          slippagePct: _slippage,
        );
        if (q == null) throw Exception('No on-chain pool quote available');
      } else {
        throw Exception('Swap not yet enabled on ${_chain.shortName}');
      }
      if (mounted) setState(() => _quote = q);
    } catch (e) {
      if (mounted) {
        setState(() {
          _quote = null;
          _error = e.toString().replaceFirst('Exception: ', '');
        });
      }
    } finally {
      if (mounted) setState(() => _quoting = false);
    }
  }

  Future<EthPrivateKey?> _credentialsForActive() async {
    final wallet = context.read<WalletStore>();
    final mnemonic = wallet.mnemonic;
    final acc = wallet.active;
    if (mnemonic == null || acc == null) return null;
    final seed = bip39.mnemonicToSeed(mnemonic);
    final root = bip32.BIP32.fromSeed(seed);
    final node = root.derivePath("m/44'/60'/0'/0/${acc.index}");
    final pk = node.privateKey;
    if (pk == null) return null;
    return EthPrivateKey.fromHex(HEX.encode(pk));
  }

  Future<void> _doSwap() async {
    if (_quote == null) return;
    final wallet = context.read<WalletStore>();
    final addr = wallet.active?.address;
    if (addr == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final creds = await _credentialsForActive();
      if (creds == null) throw Exception('No active wallet');
      if (_chain.id == 'bsc') {
        final needs = await _svc.bscNeedsApproval(
          owner: addr,
          tokenIn: _quote!.tokenIn,
          amount: _quote!.amountInWei,
        );
        if (needs) {
          final h = await _svc.bscApprove(
            credentials: creds,
            tokenIn: _quote!.tokenIn,
            amount: _quote!.amountInWei,
          );
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Approve sent: ${h.substring(0, 10)}…')),
            );
          }
        }
        final hash = await _svc.bscSwap(
          credentials: creds,
          recipient: addr,
          quote: _quote!,
        );
        if (mounted) _showResult('BSC swap submitted', hash);
      } else if (_chain.id == 'zebvix') {
        // Zebvix: simple lock-style submit via existing pool RPC alias would need
        // chain support; for now we surface the quote. Real submit can be added
        // when zbx_pool_swap accepts signed transactions.
        throw Exception(
            'Zebvix on-chain swap submit not yet wired (quote-only).');
      } else {
        throw Exception('Swap submit not enabled on ${_chain.shortName}');
      }
      await context.read<BalanceService>().refreshAll();
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _showResult(String title, String hash) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.check_circle_rounded,
                color: AppColors.accent, size: 56),
            const SizedBox(height: 12),
            Text(title,
                style: const TextStyle(
                    fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            SelectableText(hash,
                style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 12,
                    color: AppColors.textDim)),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: hash));
                    },
                    icon: const Icon(Icons.copy_rounded),
                    label: const Text('Copy'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Done'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  void _flip() {
    final ti = _tokenIn;
    setState(() {
      _tokenIn = _tokenOut;
      _tokenOut = ti;
      _isBuy = !_isBuy;
    });
    _maybeQuote();
  }

  @override
  Widget build(BuildContext context) {
    final tokens = _availableTokens();
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        _modeSwitcher(),
        const SizedBox(height: 14),
        _chainPicker(),
        const SizedBox(height: 14),
        _tokenCard(
          label: 'You pay',
          token: _tokenIn,
          options: tokens,
          editable: true,
          onTokenChanged: (t) {
            setState(() => _tokenIn = t);
            _maybeQuote();
          },
        ),
        Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: InkWell(
              onTap: _flip,
              borderRadius: BorderRadius.circular(18),
              child: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppColors.surface2,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: Colors.white12),
                ),
                child: const Icon(Icons.swap_vert_rounded,
                    color: AppColors.accent),
              ),
            ),
          ),
        ),
        _tokenCard(
          label: 'You receive (estimated)',
          token: _tokenOut,
          options: tokens,
          editable: false,
          quote: _quote,
          onTokenChanged: (t) {
            setState(() => _tokenOut = t);
            _maybeQuote();
          },
        ),
        const SizedBox(height: 16),
        _slippageRow(),
        if (_quote != null) ...[
          const SizedBox(height: 16),
          _quoteSummary(),
        ],
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: const TextStyle(color: AppColors.danger)),
        ],
        const SizedBox(height: 18),
        FilledButton(
          onPressed: (_quote == null || _busy) ? null : _doSwap,
          style: FilledButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 16),
            backgroundColor: AppColors.accent,
            foregroundColor: Colors.black,
          ),
          child: _busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.black))
              : Text(_isBuy ? 'Buy ${_tokenOut?.symbol ?? ''}' : 'Sell ${_tokenIn?.symbol ?? ''}',
                  style: const TextStyle(
                      fontWeight: FontWeight.w800, fontSize: 15)),
        ),
        const SizedBox(height: 14),
        const Center(
          child: Text(
            'Trades on BSC route via PancakeSwap V2',
            style: TextStyle(color: AppColors.textMuted, fontSize: 11),
          ),
        ),
      ],
    );
  }

  Widget _modeSwitcher() {
    return GlassCard(
      padding: const EdgeInsets.all(4),
      child: Row(
        children: [
          Expanded(child: _modeBtn('Buy', true, Icons.arrow_downward_rounded)),
          Expanded(child: _modeBtn('Sell', false, Icons.arrow_upward_rounded)),
        ],
      ),
    );
  }

  Widget _modeBtn(String label, bool buy, IconData ic) {
    final active = _isBuy == buy;
    return InkWell(
      onTap: () {
        if (active) return;
        setState(() => _isBuy = buy);
        _setupDefaultPair();
      },
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: active ? AppColors.accent.withOpacity(0.15) : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(ic, size: 16, color: active ? AppColors.accent : AppColors.textDim),
            const SizedBox(width: 6),
            Text(label,
                style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: active ? AppColors.accent : AppColors.textDim)),
          ],
        ),
      ),
    );
  }

  Widget _chainPicker() {
    return SizedBox(
      height: 40,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: Chains.all.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, i) {
          final c = Chains.all[i];
          final selected = c.id == _chain.id;
          return InkWell(
            onTap: () {
              setState(() {
                _chain = c;
                _quote = null;
              });
              _setupDefaultPair();
            },
            borderRadius: BorderRadius.circular(999),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              decoration: BoxDecoration(
                color: selected ? c.primary.withOpacity(0.15) : AppColors.surface2,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(
                  color: selected ? c.primary : Colors.white12,
                ),
              ),
              child: Row(
                children: [
                  Icon(c.icon, size: 14, color: c.primary),
                  const SizedBox(width: 6),
                  Text(c.shortName,
                      style: TextStyle(
                          color: selected ? c.primary : AppColors.text,
                          fontWeight: FontWeight.w600)),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _tokenCard({
    required String label,
    required SwapToken? token,
    required List<SwapToken> options,
    required bool editable,
    required ValueChanged<SwapToken> onTokenChanged,
    SwapQuote? quote,
  }) {
    String displayValue = '';
    if (!editable && quote != null && token != null) {
      displayValue = _fmtAmount(quote.amountOutWei, token.decimals);
    }
    return GlassCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: AppColors.textDim, fontSize: 12)),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: editable
                    ? TextField(
                        controller: _amountCtrl,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        style: const TextStyle(
                            fontSize: 26, fontWeight: FontWeight.w700),
                        decoration: const InputDecoration(
                          hintText: '0.0',
                          border: InputBorder.none,
                          isDense: true,
                        ),
                      )
                    : Text(
                        displayValue.isEmpty ? '0.0' : displayValue,
                        style: const TextStyle(
                            fontSize: 26, fontWeight: FontWeight.w700),
                      ),
              ),
              const SizedBox(width: 8),
              _tokenChip(token, options, onTokenChanged),
            ],
          ),
        ],
      ),
    );
  }

  Widget _tokenChip(SwapToken? token, List<SwapToken> options,
      ValueChanged<SwapToken> onChanged) {
    return PopupMenuButton<SwapToken>(
      onSelected: onChanged,
      itemBuilder: (_) => options
          .map((t) => PopupMenuItem(
                value: t,
                child: Row(
                  children: [
                    Icon(t.chain.icon, size: 14, color: t.chain.primary),
                    const SizedBox(width: 8),
                    Text(t.symbol,
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    if (!t.isNative)
                      const Padding(
                        padding: EdgeInsets.only(left: 6),
                        child: Text('ERC20',
                            style: TextStyle(color: AppColors.textMuted, fontSize: 10)),
                      ),
                  ],
                ),
              ))
          .toList(),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: AppColors.surface2,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 22,
              height: 22,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: token?.chain.primary.withOpacity(0.2) ?? Colors.white10,
              ),
              child: Center(
                  child: Text(
                token?.symbol.isNotEmpty == true ? token!.symbol[0] : '?',
                style: TextStyle(
                    color: token?.chain.primary ?? AppColors.text,
                    fontSize: 11,
                    fontWeight: FontWeight.w800),
              )),
            ),
            const SizedBox(width: 8),
            Text(token?.symbol ?? 'select',
                style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(width: 4),
            const Icon(Icons.expand_more_rounded, size: 18),
          ],
        ),
      ),
    );
  }

  Widget _slippageRow() {
    final opts = [0.5, 1.0, 3.0];
    return GlassCard(
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          const Text('Slippage',
              style: TextStyle(color: AppColors.textDim, fontSize: 12)),
          const Spacer(),
          ...opts.map((v) => Padding(
                padding: const EdgeInsets.only(left: 6),
                child: InkWell(
                  onTap: () {
                    setState(() => _slippage = v);
                    _maybeQuote();
                  },
                  borderRadius: BorderRadius.circular(999),
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: _slippage == v
                          ? AppColors.accent.withOpacity(0.18)
                          : AppColors.surface2,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text('${v.toStringAsFixed(v < 1 ? 1 : 0)}%',
                        style: TextStyle(
                            color: _slippage == v
                                ? AppColors.accent
                                : AppColors.text,
                            fontSize: 12,
                            fontWeight: FontWeight.w700)),
                  ),
                ),
              )),
        ],
      ),
    );
  }

  Widget _quoteSummary() {
    final q = _quote!;
    final outAmt = _fmtAmount(q.amountOutWei, q.tokenOut.decimals);
    final minOut = _fmtAmount(q.minOutWei, q.tokenOut.decimals);
    // Rate: 1 tokenIn ≈ X tokenOut.
    final inDouble =
        q.amountInWei.toDouble() / BigInt.from(10).pow(q.tokenIn.decimals).toDouble();
    final outDouble =
        q.amountOutWei.toDouble() / BigInt.from(10).pow(q.tokenOut.decimals).toDouble();
    final rate = inDouble == 0 ? 0.0 : (outDouble / inDouble);
    return GlassCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        children: [
          _qRow('Rate',
              '1 ${q.tokenIn.symbol} ≈ ${rate.toStringAsFixed(6).replaceAll(RegExp(r"0+$"), "").replaceAll(RegExp(r"\.$"), "")} ${q.tokenOut.symbol}'),
          _qRow('Estimated out', '$outAmt ${q.tokenOut.symbol}'),
          _qRow('Min received', '$minOut ${q.tokenOut.symbol}'),
          _qRow('Route',
              q.route.map((p) => p.length > 8 ? '${p.substring(0, 6)}…' : p).join(' → ')),
          if (_quoting)
            const Padding(
              padding: EdgeInsets.only(top: 4),
              child: LinearProgressIndicator(
                  minHeight: 1, color: AppColors.accent),
            ),
        ],
      ),
    );
  }

  Widget _qRow(String k, String v) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Text(k, style: const TextStyle(color: AppColors.textDim, fontSize: 12)),
          const Spacer(),
          Flexible(
            child: Text(v,
                textAlign: TextAlign.right,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}
