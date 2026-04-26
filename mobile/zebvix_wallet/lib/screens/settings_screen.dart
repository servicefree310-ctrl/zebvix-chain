import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../core/wallet_store.dart';
import '../theme.dart';
import '../widgets/glass_card.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _showSeed = false;

  Future<void> _addAccount() async {
    final n = await showDialog<String>(
      context: context,
      builder: (ctx) {
        final ctrl = TextEditingController(
            text: 'Account ${context.read<WalletStore>().accounts.length + 1}');
        return AlertDialog(
          backgroundColor: AppColors.surface,
          title: const Text('New account'),
          content: TextField(
            controller: ctrl,
            decoration: const InputDecoration(hintText: 'Name'),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            ElevatedButton(
                onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
                child: const Text('Add')),
          ],
        );
      },
    );
    if (n != null && n.isNotEmpty) {
      await context.read<WalletStore>().addAccount(n);
    }
  }

  Future<void> _confirmWipe() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: const Text('Wipe wallet?'),
        content: const Text(
          'This deletes the recovery phrase and all accounts from this device. Make sure you have your recovery phrase backed up.',
          style: TextStyle(height: 1.5),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Wipe', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
    if (ok == true) await context.read<WalletStore>().wipe();
  }

  @override
  Widget build(BuildContext context) {
    final wallet = context.watch<WalletStore>();
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Text('Accounts',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
        const SizedBox(height: 12),
        for (var i = 0; i < wallet.accounts.length; i++)
          _accountTile(wallet.accounts[i], i, wallet.active?.index == i,
              () => wallet.setActive(i)),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: _addAccount,
          icon: const Icon(Icons.add_rounded),
          label: const Text('Add account'),
          style: OutlinedButton.styleFrom(
            foregroundColor: AppColors.accent,
            side: const BorderSide(color: AppColors.accent),
            padding: const EdgeInsets.symmetric(vertical: 12),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12)),
          ),
        ),
        const SizedBox(height: 28),
        const Text('Security',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
        const SizedBox(height: 12),
        GlassCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.shield_rounded,
                      color: AppColors.accent, size: 20),
                  const SizedBox(width: 8),
                  const Text('Recovery phrase',
                      style: TextStyle(
                          fontSize: 15, fontWeight: FontWeight.w700)),
                  const Spacer(),
                  TextButton(
                    onPressed: () => setState(() => _showSeed = !_showSeed),
                    child: Text(_showSeed ? 'Hide' : 'Reveal'),
                  ),
                ],
              ),
              if (_showSeed) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.bg,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.danger.withOpacity(0.4)),
                  ),
                  child: SelectableText(
                    wallet.mnemonic ?? '',
                    style: const TextStyle(
                        fontSize: 14, height: 1.6, fontWeight: FontWeight.w600),
                  ),
                ),
                const SizedBox(height: 8),
                TextButton.icon(
                  onPressed: () {
                    Clipboard.setData(
                        ClipboardData(text: wallet.mnemonic ?? ''));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Copied recovery phrase')),
                    );
                  },
                  icon: const Icon(Icons.copy_rounded, size: 16),
                  label: const Text('Copy'),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 12),
        GlassCard(
          onTap: _confirmWipe,
          child: Row(
            children: [
              const Icon(Icons.delete_outline_rounded,
                  color: AppColors.danger, size: 20),
              const SizedBox(width: 8),
              const Text('Wipe wallet from this device',
                  style: TextStyle(
                      color: AppColors.danger,
                      fontSize: 14,
                      fontWeight: FontWeight.w600)),
              const Spacer(),
              const Icon(Icons.chevron_right_rounded,
                  color: AppColors.textDim),
            ],
          ),
        ),
        const SizedBox(height: 28),
        const Text('About',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
        const SizedBox(height: 12),
        GlassCard(
          child: Column(
            children: [
              _kv('App', 'Zebvix Wallet 0.1.0'),
              const SizedBox(height: 6),
              _kv('Networks', '5 chains supported'),
              const SizedBox(height: 6),
              _kv('Bridge', 'Zebvix L1 ↔ BSC live'),
            ],
          ),
        ),
      ],
    );
  }

  Widget _kv(String k, String v) {
    return Row(
      children: [
        Text(k, style: const TextStyle(color: AppColors.textDim, fontSize: 13)),
        const Spacer(),
        Text(v,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
      ],
    );
  }

  Widget _accountTile(
      Account a, int idx, bool active, VoidCallback onTap) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: GlassCard(
        onTap: onTap,
        padding: const EdgeInsets.all(14),
        border: Border.all(
          color: active ? AppColors.accent : AppColors.border,
          width: active ? 1.5 : 1,
        ),
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: AppColors.accentGradient,
              ),
              child: Center(
                child: Text('${idx + 1}',
                    style: const TextStyle(
                        color: Colors.black,
                        fontWeight: FontWeight.w800,
                        fontSize: 14)),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(a.name,
                      style: const TextStyle(
                          fontWeight: FontWeight.w700, fontSize: 14)),
                  Text(
                    '${a.address.substring(0, 10)}...${a.address.substring(a.address.length - 8)}',
                    style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 11,
                        fontFamily: 'monospace'),
                  ),
                ],
              ),
            ),
            if (active)
              const Icon(Icons.check_circle_rounded,
                  color: AppColors.accent, size: 20),
          ],
        ),
      ),
    );
  }
}
