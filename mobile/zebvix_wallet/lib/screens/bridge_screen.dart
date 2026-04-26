import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../bridge/bridge_service.dart';
import '../core/balance_service.dart';
import '../core/chains.dart';
import '../core/rpc_client.dart';
import '../core/wallet_store.dart';
import '../theme.dart';
import '../widgets/glass_card.dart';

class BridgeScreen extends StatefulWidget {
  const BridgeScreen({super.key});

  @override
  State<BridgeScreen> createState() => _BridgeScreenState();
}

class _BridgeScreenState extends State<BridgeScreen> {
  BridgeDirection _dir = BridgeDirection.zebvixToBsc;
  final _amtCtrl = TextEditingController();
  final _destCtrl = TextEditingController();
  bool _busy = false;
  bool _checkingAllow = false;
  bool _needsApproval = false;
  bool _bridgePaused = false;
  bool _checkingPause = false;
  String? _err;
  String? _lastTx;
  Timer? _pauseTimer;

  ChainConfig get _from =>
      _dir == BridgeDirection.zebvixToBsc ? Chains.zebvix : Chains.bsc;
  ChainConfig get _to =>
      _dir == BridgeDirection.zebvixToBsc ? Chains.bsc : Chains.zebvix;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _useMyAddress();
      _refreshAllowance();
      _refreshBridgePause();
    });
    // Re-poll bridge pause state every 30s so a paused bridge becomes visible
    // promptly without the user having to leave/re-enter the screen.
    _pauseTimer = Timer.periodic(
        const Duration(seconds: 30), (_) => _refreshBridgePause());
  }

  @override
  void dispose() {
    _pauseTimer?.cancel();
    _amtCtrl.dispose();
    _destCtrl.dispose();
    super.dispose();
  }

  Future<void> _refreshBridgePause() async {
    if (!mounted) return;
    setState(() => _checkingPause = true);
    try {
      final rpc = context.read<RpcRegistry>().get(Chains.zebvix);
      final paused = await rpc.bridgePaused();
      if (mounted) setState(() => _bridgePaused = paused);
    } catch (_) {
      // fail-open; chain will reject tx if truly paused
    } finally {
      if (mounted) setState(() => _checkingPause = false);
    }
  }

  void _useMyAddress() {
    final addr = context.read<WalletStore>().active?.address;
    if (addr != null) {
      _destCtrl.text = addr;
      setState(() {});
    }
  }

  void _swap() {
    setState(() {
      _dir = _dir == BridgeDirection.zebvixToBsc
          ? BridgeDirection.bscToZebvix
          : BridgeDirection.zebvixToBsc;
      _lastTx = null;
      _err = null;
      _needsApproval = false;
    });
    _useMyAddress();
    _refreshAllowance();
  }

  Future<void> _refreshAllowance() async {
    if (_dir != BridgeDirection.bscToZebvix) {
      setState(() => _needsApproval = false);
      return;
    }
    final amt = double.tryParse(_amtCtrl.text.trim()) ?? 0;
    if (amt <= 0) {
      setState(() => _needsApproval = false);
      return;
    }
    setState(() => _checkingAllow = true);
    try {
      final wei = BigInt.from((amt * 1e18).round());
      final addr = context.read<WalletStore>().active?.address;
      if (addr == null) return;
      final svc = BridgeService(context.read<RpcRegistry>());
      final needs = await svc.needsApproval(owner: addr, amount: wei);
      if (mounted) setState(() => _needsApproval = needs);
    } catch (_) {
      // assume needs approval on error
      if (mounted) setState(() => _needsApproval = true);
    } finally {
      if (mounted) setState(() => _checkingAllow = false);
    }
  }

  Future<void> _submit() async {
    final amt = double.tryParse(_amtCtrl.text.trim()) ?? 0;
    final dest = _destCtrl.text.trim();
    if (amt <= 0) {
      setState(() => _err = 'Enter an amount');
      return;
    }
    if (!RegExp(r'^0x[0-9a-fA-F]{40}$').hasMatch(dest)) {
      setState(() => _err = 'Invalid destination address');
      return;
    }
    setState(() {
      _busy = true;
      _err = null;
      _lastTx = null;
    });
    try {
      final wei = BigInt.from((amt * 1e18).round());
      final wallet = context.read<WalletStore>();
      final rpc = context.read<RpcRegistry>();
      final svc = BridgeService(rpc);
      String hash;
      if (_dir == BridgeDirection.bscToZebvix) {
        if (_needsApproval) {
          hash = await svc.approveWZbx(
              credentials: wallet.activeCredentials(), amount: wei);
          setState(() {
            _lastTx = hash;
            _needsApproval = false;
          });
          // Re-check allowance shortly after
          await Future.delayed(const Duration(seconds: 2));
          await _refreshAllowance();
        } else {
          hash = await svc.burnToZebvix(
              credentials: wallet.activeCredentials(),
              zebvixDest: dest,
              amount: wei);
          setState(() => _lastTx = hash);
        }
      } else {
        hash = await svc.bridgeOutFromZebvix(
            credentials: wallet.activeCredentials(),
            bscRecipient: dest,
            amountWei: wei);
        setState(() => _lastTx = hash);
      }
      if (mounted) await context.read<BalanceService>().refreshAll();
    } catch (e) {
      setState(() => _err = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String get _actionLabel {
    if (_dir == BridgeDirection.bscToZebvix) {
      if (_checkingAllow) return 'Checking allowance...';
      if (_needsApproval) return 'Approve wZBX';
      return 'Bridge wZBX → ZBX';
    }
    return 'Bridge ZBX → wZBX';
  }

  @override
  Widget build(BuildContext context) {
    final balances = context.watch<BalanceService>();
    final fromBal = balances.forChain(_from.id);
    final toBal = balances.forChain(_to.id);
    final fromAmount = (_dir == BridgeDirection.zebvixToBsc)
        ? fromBal.where((t) => t.isNative).firstOrNull
        : fromBal.where((t) => t.symbol == 'wZBX').firstOrNull;
    final toAmount = (_dir == BridgeDirection.zebvixToBsc)
        ? toBal.where((t) => t.symbol == 'wZBX').firstOrNull
        : toBal.where((t) => t.isNative).firstOrNull;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        if (_bridgePaused) _pausedBanner(),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: AppColors.accent.withOpacity(0.12),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: AppColors.accent.withOpacity(0.3)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                  width: 6,
                  height: 6,
                  decoration: const BoxDecoration(
                      color: AppColors.accent, shape: BoxShape.circle)),
              const SizedBox(width: 6),
              const Text('Live · Mainnet · Bidirectional',
                  style: TextStyle(
                      color: AppColors.accent,
                      fontWeight: FontWeight.w700,
                      fontSize: 11)),
            ],
          ),
        ),
        const SizedBox(height: 12),
        const Text('Bridge ZBX',
            style: TextStyle(
                fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: -0.6)),
        const SizedBox(height: 4),
        const Text(
          'Move ZBX between Zebvix L1 and BNB Smart Chain in either direction.',
          style: TextStyle(color: AppColors.textDim, fontSize: 13, height: 1.4),
        ),
        const SizedBox(height: 18),
        GlassCard(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              _chainPanel(label: 'FROM', chain: _from, balance: fromAmount),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: GestureDetector(
                  onTap: _swap,
                  child: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: AppColors.surface2,
                      shape: BoxShape.circle,
                      border:
                          Border.all(color: AppColors.borderStrong, width: 1.5),
                    ),
                    child: const Icon(Icons.swap_vert_rounded,
                        size: 22, color: AppColors.accent),
                  ),
                ),
              ),
              _chainPanel(label: 'TO', chain: _to, balance: toAmount),
            ],
          ),
        ),
        const SizedBox(height: 16),
        GlassCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('AMOUNT',
                  style: TextStyle(
                      color: AppColors.textDim,
                      fontSize: 11,
                      letterSpacing: 0.8)),
              const SizedBox(height: 8),
              TextField(
                controller: _amtCtrl,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                style:
                    const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                decoration: InputDecoration(
                  hintText: '0.0',
                  suffixText: 'ZBX',
                  suffixStyle: const TextStyle(
                      color: AppColors.textDim, fontWeight: FontWeight.w700),
                ),
                onChanged: (_) {
                  setState(() {});
                  _refreshAllowance();
                },
              ),
              const SizedBox(height: 12),
              const Text('RECIPIENT',
                  style: TextStyle(
                      color: AppColors.textDim,
                      fontSize: 11,
                      letterSpacing: 0.8)),
              const SizedBox(height: 8),
              TextField(
                controller: _destCtrl,
                style:
                    const TextStyle(fontFamily: 'monospace', fontSize: 12),
                decoration: InputDecoration(
                  hintText: '0x... (40 hex chars)',
                  suffixIcon: TextButton(
                    onPressed: _useMyAddress,
                    child: const Text('USE MINE'),
                  ),
                ),
                onChanged: (_) => setState(() {}),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        GlassCard(
          padding: const EdgeInsets.all(14),
          child: Column(
            children: [
              _quoteRow('Estimated arrival', '~30 sec'),
              const SizedBox(height: 6),
              _quoteRow('Source-chain fee', '~0.0001 ZBX'),
              const SizedBox(height: 6),
              _quoteRow('Destination gas', 'paid by relayer',
                  highlight: AppColors.accent),
            ],
          ),
        ),
        if (_err != null) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.danger.withOpacity(0.12),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.danger.withOpacity(0.4)),
            ),
            child: Text(_err!,
                style:
                    const TextStyle(color: AppColors.danger, fontSize: 13)),
          ),
        ],
        if (_lastTx != null) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.success.withOpacity(0.12),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.success.withOpacity(0.4)),
            ),
            child: Text(
              'Submitted: ${_lastTx!.substring(0, 16)}...',
              style: const TextStyle(
                  color: AppColors.success,
                  fontSize: 13,
                  fontFamily: 'monospace'),
            ),
          ),
        ],
        const SizedBox(height: 18),
        GradientButton(
          label: _bridgePaused ? 'Bridge Paused' : _actionLabel,
          icon: _bridgePaused
              ? Icons.pause_circle_filled_rounded
              : (_needsApproval && _dir == BridgeDirection.bscToZebvix
                  ? Icons.lock_open_rounded
                  : Icons.swap_horiz_rounded),
          loading: _busy,
          onPressed: (!_bridgePaused &&
                  (double.tryParse(_amtCtrl.text.trim()) ?? 0) > 0 &&
                  _destCtrl.text.trim().length == 42 &&
                  !_checkingAllow)
              ? _submit
              : null,
        ),
      ],
    );
  }

  Widget _pausedBanner() {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.danger.withOpacity(0.14),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.danger.withOpacity(0.55), width: 1.5),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.pause_circle_filled_rounded,
              color: AppColors.danger, size: 22),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: const [
                Text(
                  'Bridge temporarily paused',
                  style: TextStyle(
                    color: AppColors.danger,
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                  ),
                ),
                SizedBox(height: 4),
                Text(
                  'Admin kill-switch is active. Bridging is disabled until the '
                  'team re-enables it. Existing balances are safe — only new '
                  'cross-chain transfers are blocked.',
                  style: TextStyle(
                    color: AppColors.text,
                    fontSize: 12,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
          if (_checkingPause)
            const SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(
                    strokeWidth: 2, color: AppColors.danger)),
        ],
      ),
    );
  }

  Widget _chainPanel(
      {required String label,
      required ChainConfig chain,
      required dynamic balance}) {
    final amount = balance == null ? '—' : (balance.formatted() as String);
    final symbol = balance?.symbol ?? chain.nativeSymbol;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface2,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient:
                  LinearGradient(colors: [chain.primary, chain.secondary]),
            ),
            child: Icon(chain.icon, color: Colors.black, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 10,
                        letterSpacing: 0.8)),
                const SizedBox(height: 2),
                Text(chain.name,
                    style: const TextStyle(
                        fontSize: 15, fontWeight: FontWeight.w700)),
                Text('chain ${chain.chainId}',
                    style: const TextStyle(
                        color: AppColors.textMuted,
                        fontFamily: 'monospace',
                        fontSize: 10)),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              const Text('BALANCE',
                  style: TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 10,
                      letterSpacing: 0.8)),
              const SizedBox(height: 2),
              Text(amount,
                  style: const TextStyle(
                      fontSize: 14, fontWeight: FontWeight.w700)),
              Text(symbol,
                  style: const TextStyle(
                      color: AppColors.textMuted, fontSize: 10)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _quoteRow(String k, String v, {Color? highlight}) {
    return Row(
      children: [
        Text(k,
            style: const TextStyle(color: AppColors.textDim, fontSize: 12)),
        const Spacer(),
        Text(v,
            style: TextStyle(
                color: highlight ?? AppColors.text,
                fontSize: 12,
                fontWeight: FontWeight.w600)),
      ],
    );
  }
}

extension _Iter<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
