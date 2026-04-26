import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/balance_service.dart';
import '../core/chains.dart';
import '../core/rpc_client.dart';
import '../core/wallet_store.dart';
import '../theme.dart';
import '../widgets/chain_pill.dart';
import '../widgets/glass_card.dart';

class SendScreen extends StatefulWidget {
  const SendScreen({super.key});

  @override
  State<SendScreen> createState() => _SendScreenState();
}

class _SendScreenState extends State<SendScreen> {
  ChainConfig _chain = Chains.zebvix;
  final _toCtrl = TextEditingController();
  final _amtCtrl = TextEditingController();
  bool _busy = false;
  String? _err;
  String? _txHash;

  @override
  void dispose() {
    _toCtrl.dispose();
    _amtCtrl.dispose();
    super.dispose();
  }

  bool _validAddr(String s) =>
      RegExp(r'^0x[0-9a-fA-F]{40}$').hasMatch(s.trim());

  Future<void> _send() async {
    final wallet = context.read<WalletStore>();
    final rpc = context.read<RpcRegistry>();
    final to = _toCtrl.text.trim();
    final amt = double.tryParse(_amtCtrl.text.trim());
    if (!_validAddr(to)) {
      setState(() => _err = 'Invalid recipient address');
      return;
    }
    if (amt == null || amt <= 0) {
      setState(() => _err = 'Invalid amount');
      return;
    }
    setState(() {
      _busy = true;
      _err = null;
      _txHash = null;
    });
    try {
      final wei = BigInt.from((amt * 1e18).round());
      final hash = await rpc.get(_chain).sendNative(
            credentials: wallet.activeCredentials(),
            to: to,
            valueWei: wei,
          );
      setState(() => _txHash = hash);
      if (mounted) {
        await context.read<BalanceService>().refreshAll();
      }
    } catch (e) {
      setState(() => _err = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final balances = context.watch<BalanceService>();
    final native = balances
        .forChain(_chain.id)
        .where((t) => t.isNative)
        .firstOrNull;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Send'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text('Network',
              style: TextStyle(color: AppColors.textDim, fontSize: 13)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: Chains.all
                .map((c) => ChainPill(
                      chain: c,
                      selected: c.id == _chain.id,
                      onTap: () => setState(() => _chain = c),
                    ))
                .toList(),
          ),
          const SizedBox(height: 20),
          GlassCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Recipient',
                    style:
                        TextStyle(color: AppColors.textDim, fontSize: 13)),
                const SizedBox(height: 8),
                TextField(
                  controller: _toCtrl,
                  decoration: const InputDecoration(
                    hintText: '0x... (40 hex chars)',
                  ),
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    const Text('Amount',
                        style: TextStyle(
                            color: AppColors.textDim, fontSize: 13)),
                    const Spacer(),
                    if (native != null)
                      Text(
                        'Balance: ${native.formatted()} ${_chain.nativeSymbol}',
                        style: const TextStyle(
                            color: AppColors.textMuted, fontSize: 12),
                      ),
                  ],
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _amtCtrl,
                  keyboardType: const TextInputType.numberWithOptions(
                      decimal: true),
                  decoration: InputDecoration(
                    hintText: '0.0',
                    suffixIcon: Padding(
                      padding: const EdgeInsets.only(right: 12),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (native != null && native.amountWei > BigInt.zero)
                            TextButton(
                              onPressed: () {
                                _amtCtrl.text =
                                    (native.amount * 0.99).toStringAsFixed(6);
                                setState(() {});
                              },
                              child: const Text('MAX'),
                            ),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                            child: Text(_chain.nativeSymbol,
                                style: const TextStyle(
                                    color: AppColors.textDim,
                                    fontWeight: FontWeight.w600)),
                          ),
                        ],
                      ),
                    ),
                  ),
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                  onChanged: (_) => setState(() {}),
                ),
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
              child: Row(
                children: [
                  const Icon(Icons.error_outline_rounded,
                      color: AppColors.danger, size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(_err!,
                        style: const TextStyle(
                            color: AppColors.danger, fontSize: 13)),
                  ),
                ],
              ),
            ),
          ],
          if (_txHash != null) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.success.withOpacity(0.12),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.success.withOpacity(0.4)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.check_circle_outline_rounded,
                      color: AppColors.success, size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Sent. tx: ${_txHash!.substring(0, 14)}...',
                      style: const TextStyle(
                          color: AppColors.success,
                          fontSize: 13,
                          fontFamily: 'monospace'),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 20),
          GradientButton(
            label: 'Send',
            icon: Icons.arrow_upward_rounded,
            loading: _busy,
            onPressed: _validAddr(_toCtrl.text.trim()) &&
                    (double.tryParse(_amtCtrl.text.trim()) ?? 0) > 0
                ? _send
                : null,
          ),
        ],
      ),
    );
  }
}

extension _Iter<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
