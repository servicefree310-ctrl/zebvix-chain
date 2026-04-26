import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../core/balance_service.dart';
import '../core/chains.dart';
import '../core/wallet_store.dart';
import '../theme.dart';
import '../widgets/glass_card.dart';

class WalletScreen extends StatefulWidget {
  final void Function(String chainId, {bool send})? onAction;
  const WalletScreen({super.key, this.onAction});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<BalanceService>().refreshAll();
    });
  }

  String _shortAddr(String a) =>
      '${a.substring(0, 6)}...${a.substring(a.length - 4)}';

  @override
  Widget build(BuildContext context) {
    final wallet = context.watch<WalletStore>();
    final balances = context.watch<BalanceService>();
    final acc = wallet.active;
    if (acc == null) return const Center(child: CircularProgressIndicator());

    return RefreshIndicator(
      onRefresh: () => balances.refreshAll(),
      color: AppColors.accent,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _portfolioHeader(acc.address),
          const SizedBox(height: 20),
          _quickActions(),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Assets',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              if (balances.loading)
                const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: AppColors.accent)),
            ],
          ),
          const SizedBox(height: 12),
          for (final chain in Chains.all) _chainSection(chain, balances),
        ],
      ),
    );
  }

  Widget _portfolioHeader(String address) {
    return GlassCard(
      gradient: AppColors.heroGradient,
      padding: const EdgeInsets.all(22),
      border: Border.all(color: AppColors.accent.withOpacity(0.3)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text('Total balance',
                  style: TextStyle(color: AppColors.textDim, fontSize: 13)),
              const Spacer(),
              GestureDetector(
                onTap: () {
                  Clipboard.setData(ClipboardData(text: address));
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Address copied')),
                  );
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_shortAddr(address),
                          style: const TextStyle(
                              fontFamily: 'monospace', fontSize: 12)),
                      const SizedBox(width: 6),
                      const Icon(Icons.copy_rounded, size: 12),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text('—',
                  style: TextStyle(
                      fontSize: 38,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -1)),
              SizedBox(width: 6),
              Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: Text('USD',
                    style: TextStyle(
                        color: AppColors.textDim, fontWeight: FontWeight.w600)),
              ),
            ],
          ),
          const SizedBox(height: 2),
          const Text('Pricing feed coming soon',
              style: TextStyle(color: AppColors.textDim, fontSize: 12)),
        ],
      ),
    );
  }

  Widget _quickActions() {
    final actions = [
      ('Send', Icons.arrow_upward_rounded, () {
        Navigator.of(context).pushNamed('/send');
      }),
      ('Receive', Icons.arrow_downward_rounded, () {
        Navigator.of(context).pushNamed('/receive');
      }),
      ('Bridge', Icons.swap_horiz_rounded, () {
        widget.onAction?.call('bridge', send: false);
      }),
      ('Scan', Icons.qr_code_scanner_rounded, () {
        widget.onAction?.call('scan', send: false);
      }),
    ];
    return Row(
      children: actions.map((a) {
        return Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: GlassCard(
              padding: const EdgeInsets.symmetric(vertical: 16),
              onTap: a.$3,
              child: Column(
                children: [
                  Container(
                    width: 42,
                    height: 42,
                    decoration: BoxDecoration(
                      color: AppColors.accent.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(a.$2, color: AppColors.accent, size: 20),
                  ),
                  const SizedBox(height: 8),
                  Text(a.$1,
                      style: const TextStyle(
                          fontSize: 12, fontWeight: FontWeight.w600)),
                ],
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _chainSection(ChainConfig chain, BalanceService balances) {
    final tokens = balances.forChain(chain.id);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: GlassCard(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                        colors: [chain.primary, chain.secondary]),
                  ),
                  child: Icon(chain.icon, color: Colors.black, size: 18),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(chain.name,
                          style: const TextStyle(
                              fontWeight: FontWeight.w700, fontSize: 14)),
                      Text('Chain ${chain.chainId}',
                          style: const TextStyle(
                              color: AppColors.textMuted, fontSize: 11)),
                    ],
                  ),
                ),
              ],
            ),
            if (tokens.isEmpty) ...[
              const SizedBox(height: 12),
              const Text('Tap to refresh',
                  style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
            ] else ...[
              const SizedBox(height: 12),
              for (final t in tokens) _tokenRow(t),
            ],
          ],
        ),
      ),
    );
  }

  Widget _tokenRow(TokenBalance t) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: t.chain.primary.withOpacity(0.15),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Center(
              child: Text(t.symbol[0],
                  style: TextStyle(
                      color: t.chain.primary,
                      fontWeight: FontWeight.w800,
                      fontSize: 12)),
            ),
          ),
          const SizedBox(width: 10),
          Text(t.symbol,
              style: const TextStyle(fontWeight: FontWeight.w600)),
          if (!t.isNative)
            Container(
              margin: const EdgeInsets.only(left: 6),
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.surface2,
                borderRadius: BorderRadius.circular(4),
              ),
              child: const Text('BEP-20',
                  style: TextStyle(color: AppColors.textMuted, fontSize: 9)),
            ),
          const Spacer(),
          Text(t.formatted(),
              style:
                  const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
        ],
      ),
    );
  }
}
