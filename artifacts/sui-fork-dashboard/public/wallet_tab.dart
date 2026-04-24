import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../theme.dart';
import '../state/app_state.dart';
import '../utils/format.dart';
import '../widgets/widgets.dart';
import 'send_screen.dart';
import 'receive_screen.dart';

class WalletTab extends StatelessWidget {
  const WalletTab({super.key});
  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    final b = st.balance;
    final active = st.activeWallet;
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 12,
        title: PopupMenuButton<String>(
          tooltip: 'switch wallet',
          color: kZbxSurface,
          offset: const Offset(0, 44),
          onSelected: (v) async {
            if (v == '__add__') {
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                  content: Text(
                      'Open Settings → Wallets to add or import')));
              return;
            }
            await st.switchWallet(v);
          },
          itemBuilder: (_) {
            final items = <PopupMenuEntry<String>>[];
            for (final w in st.wallets) {
              final isActive =
                  (st.address ?? '').toLowerCase() == w.address.toLowerCase();
              items.add(PopupMenuItem<String>(
                value: w.address,
                child: Row(children: [
                  Icon(
                      isActive
                          ? Icons.check_circle
                          : Icons.circle_outlined,
                      color: isActive ? kZbxTeal : kZbxMuted,
                      size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(w.name,
                            style: const TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w700)),
                        Text(
                            '${w.address.substring(0, 8)}…${w.address.substring(w.address.length - 6)}',
                            style: const TextStyle(
                                fontSize: 10,
                                color: kZbxMuted,
                                fontFamily: 'monospace')),
                      ],
                    ),
                  ),
                ]),
              ));
            }
            items.add(const PopupMenuDivider());
            items.add(const PopupMenuItem<String>(
              value: '__add__',
              child: Row(children: [
                Icon(Icons.add, color: kZbxTeal, size: 16),
                SizedBox(width: 8),
                Text('Add / import wallet'),
              ]),
            ));
            return items;
          },
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                    gradient: const LinearGradient(
                        colors: [kZbxTeal, kZbxCyan]),
                    borderRadius: BorderRadius.circular(8)),
                child: const Icon(Icons.account_balance_wallet,
                    color: Colors.black, size: 16),
              ),
              const SizedBox(width: 10),
              Flexible(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(active?.name ?? 'Zebvix Wallet',
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 14, fontWeight: FontWeight.w800)),
                    if (st.wallets.length > 1)
                      Text('${st.wallets.length} wallets',
                          style: const TextStyle(
                              fontSize: 10, color: kZbxMuted)),
                  ],
                ),
              ),
              const SizedBox(width: 4),
              const Icon(Icons.expand_more, size: 18),
            ],
          ),
        ),
        actions: [
          IconButton(
              tooltip: 'refresh',
              onPressed: st.loading ? null : () => st.refresh(),
              icon: st.loading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.refresh)),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: st.refresh,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // BALANCE HERO
            GradientCard(
              colors: const [Color(0xFF0C2A36), Color(0xFF0F1730)],
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      AddressPill(
                          address: st.address ?? '',
                          payIdName: b.payIdName),
                      const Spacer(),
                      StatChip(
                          icon: Icons.layers,
                          label: 'block',
                          value: '#${st.blockHeight}',
                          color: kZbxCyan),
                    ],
                  ),
                  const SizedBox(height: 18),
                  const Text('TOTAL BALANCE',
                      style: TextStyle(
                          color: kZbxMuted,
                          letterSpacing: 1.2,
                          fontSize: 11,
                          fontWeight: FontWeight.w700)),
                  const SizedBox(height: 4),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Text(fmtZbx(b.totalZbx, frac: 4),
                          style: const TextStyle(
                              fontSize: 36,
                              fontWeight: FontWeight.w800,
                              color: kZbxTeal)),
                      const SizedBox(width: 6),
                      const Text('ZBX',
                          style: TextStyle(
                              color: kZbxMuted, fontWeight: FontWeight.w600)),
                    ],
                  ),
                  Text('≈ ${fmtUsd(b.totalUsd)}',
                      style: const TextStyle(
                          color: kZbxEmerald,
                          fontSize: 16,
                          fontWeight: FontWeight.w600)),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                          child: ActionTile(
                              icon: Icons.arrow_upward,
                              label: 'Send',
                              color: kZbxTeal,
                              onTap: () => Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                      builder: (_) =>
                                          const SendScreen())))),
                      const SizedBox(width: 8),
                      Expanded(
                          child: ActionTile(
                              icon: Icons.arrow_downward,
                              label: 'Receive',
                              color: kZbxCyan,
                              onTap: () => Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                      builder: (_) =>
                                          const ReceiveScreen())))),
                      const SizedBox(width: 8),
                      Expanded(
                          child: ActionTile(
                              icon: Icons.swap_vert,
                              label: 'Swap',
                              color: kZbxViolet,
                              onTap: () {
                                ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(content: Text('Open the Swap tab below')));
                              })),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            const SectionHeader(title: 'BREAKDOWN'),
            _row(Icons.account_balance_wallet, 'Liquid', b.liquidZbx, 'ZBX',
                kZbxTeal),
            _row(Icons.trending_up, 'Staked', b.stakedZbx, 'ZBX', kZbxAmber),
            _row(Icons.lock_clock, 'Locked rewards', b.lockedZbx, 'ZBX',
                kZbxViolet),
            _row(Icons.attach_money, 'zUSD', b.zusd, 'zUSD', kZbxEmerald),
            const SizedBox(height: 16),
            const SectionHeader(title: 'NETWORK'),
            GradientCard(
              child: Column(
                children: [
                  _kv('Chain ID', '7878'),
                  _kv('RPC',
                      st.rpcEndpoint.replaceAll(RegExp(r'^https?://'), '')),
                  _kv('Nonce', '${b.nonce}'),
                ],
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _row(IconData icon, String label, double v, String unit, Color c) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      decoration: BoxDecoration(
        color: kZbxSurface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: kZbxBorder),
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
                color: c.withOpacity(0.12),
                borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, color: c, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
              child: Text(label,
                  style: const TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w600))),
          Text('${fmtZbx(v)} $unit',
              style: TextStyle(
                  fontFamily: 'monospace',
                  color: c,
                  fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }

  Widget _kv(String k, String v) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(children: [
        Text(k, style: const TextStyle(color: kZbxMuted, fontSize: 12)),
        const Spacer(),
        Text(v,
            style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 12,
                fontWeight: FontWeight.w600)),
      ]),
    );
  }
}
