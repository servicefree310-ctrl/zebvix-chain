import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../theme.dart';
import '../state/app_state.dart';
import '../services/wallet_service.dart';
import '../widgets/widgets.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final rpcCtl =
      TextEditingController(text: context.read<AppState>().rpcEndpoint);
  late final relayCtl =
      TextEditingController(text: context.read<AppState>().relayBase);

  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ── WALLETS ────────────────────────────────────────────────────
          Row(
            children: [
              const Expanded(child: SectionHeader(title: 'WALLETS')),
              Text('${st.wallets.length} total',
                  style: const TextStyle(color: kZbxMuted, fontSize: 11)),
            ],
          ),
          GradientCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                if (st.wallets.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text('No wallets yet',
                        style: TextStyle(color: kZbxMuted)),
                  ),
                for (int i = 0; i < st.wallets.length; i++) ...[
                  if (i > 0) const Divider(color: kZbxBorder, height: 1),
                  _walletRow(context, st, st.wallets[i]),
                ],
              ],
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _addBtn(Icons.add, 'Create new', () => _createNew(context)),
              _addBtn(Icons.download, 'Import mnemonic',
                  () => _importMnemonic(context)),
              _addBtn(Icons.vpn_key, 'Import private key',
                  () => _importPrivKey(context)),
            ],
          ),

          const SizedBox(height: 22),
          // ── SECURITY ──────────────────────────────────────────────────
          const SectionHeader(title: 'SECURITY'),
          GradientCard(
            child: _row(Icons.security, 'Biometric / PIN lock',
                trailing: Switch(
                    value: st.biometricEnabled,
                    activeColor: kZbxTeal,
                    onChanged: (v) => st.setBiometric(v))),
          ),

          const SizedBox(height: 16),
          // ── NETWORK ───────────────────────────────────────────────────
          const SectionHeader(title: 'NETWORK'),
          GradientCard(
            child: Column(children: [
              const Align(
                  alignment: Alignment.centerLeft,
                  child: Text('RPC endpoint',
                      style: TextStyle(color: kZbxMuted, fontSize: 11))),
              TextField(
                controller: rpcCtl,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () {
                    st.setRpcEndpoint(rpcCtl.text.trim());
                    ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('RPC saved')));
                  },
                  child: const Text('Save RPC'),
                ),
              ),
              const SizedBox(height: 14),
              const Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Pairing relay base URL',
                      style: TextStyle(color: kZbxMuted, fontSize: 11))),
              TextField(
                controller: relayCtl,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () {
                    st.setRelayBase(relayCtl.text.trim());
                    ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Relay saved')));
                  },
                  child: const Text('Save relay'),
                ),
              ),
            ]),
          ),
          const SizedBox(height: 16),
          const SectionHeader(title: 'ABOUT'),
          GradientCard(
            child: Column(children: [
              _row(Icons.info_outline, 'Chain',
                  trailing: const Text('Zebvix (ZBX) — chain_id 7878')),
              const Divider(color: kZbxBorder, height: 24),
              _row(Icons.label, 'Version',
                  trailing: const Text('0.2.0')),
            ]),
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
                foregroundColor: kZbxRed,
                side: const BorderSide(color: kZbxRed),
                minimumSize: const Size.fromHeight(48)),
            onPressed: () => _signOut(context),
            icon: const Icon(Icons.logout),
            label: const Text('Sign out & wipe ALL keys'),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  // ── Wallet row ──────────────────────────────────────────────────────────
  Widget _walletRow(BuildContext context, AppState st, ZebvixWallet w) {
    final active =
        (st.address ?? '').toLowerCase() == w.address.toLowerCase();
    final shortAddr = w.address.length > 12
        ? '${w.address.substring(0, 8)}…${w.address.substring(w.address.length - 6)}'
        : w.address;
    return InkWell(
      onTap: () => _openWalletSheet(context, w),
      child: Padding(
        padding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                  gradient: LinearGradient(colors: active
                      ? const [kZbxTeal, kZbxCyan]
                      : const [Color(0xFF2A3654), Color(0xFF1B2440)]),
                  borderRadius: BorderRadius.circular(10)),
              child: Icon(
                  w.source == 'privkey'
                      ? Icons.vpn_key
                      : Icons.account_balance_wallet,
                  color: active ? Colors.black : kZbxMuted,
                  size: 18),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Text(w.name,
                        style: const TextStyle(
                            fontWeight: FontWeight.w700, fontSize: 14)),
                    if (active) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                            color: kZbxTeal.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(4)),
                        child: const Text('ACTIVE',
                            style: TextStyle(
                                color: kZbxTeal,
                                fontSize: 9,
                                fontWeight: FontWeight.w800)),
                      ),
                    ],
                  ]),
                  const SizedBox(height: 2),
                  Text(shortAddr,
                      style: const TextStyle(
                          color: kZbxMuted,
                          fontSize: 11,
                          fontFamily: 'monospace')),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: kZbxMuted),
          ],
        ),
      ),
    );
  }

  Widget _addBtn(IconData ic, String label, VoidCallback onTap) {
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: Icon(ic, size: 16),
      label: Text(label, style: const TextStyle(fontSize: 12)),
    );
  }

  // ── Wallet management actions ──────────────────────────────────────────
  Future<void> _openWalletSheet(
      BuildContext context, ZebvixWallet w) async {
    final st = context.read<AppState>();
    final active =
        (st.address ?? '').toLowerCase() == w.address.toLowerCase();
    await showModalBottomSheet(
      context: context,
      backgroundColor: kZbxBg,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheetCtx) => SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                      color: kZbxBorder,
                      borderRadius: BorderRadius.circular(2)),
                ),
              ),
              const SizedBox(height: 14),
              Text(w.name,
                  style: const TextStyle(
                      fontSize: 18, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              SelectableText(w.address,
                  style: const TextStyle(
                      color: kZbxMuted,
                      fontSize: 11,
                      fontFamily: 'monospace')),
              const SizedBox(height: 16),
              if (!active)
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                      minimumSize: const Size.fromHeight(46)),
                  onPressed: () async {
                    Navigator.pop(sheetCtx);
                    await st.switchWallet(w.address);
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                          content: Text('Switched to ${w.name}')));
                    }
                  },
                  icon: const Icon(Icons.check_circle),
                  label: const Text('Set as active'),
                ),
              if (!active) const SizedBox(height: 8),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(46)),
                onPressed: () => _renameDialog(sheetCtx, st, w),
                icon: const Icon(Icons.edit),
                label: const Text('Rename'),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(46)),
                onPressed: () {
                  Navigator.pop(sheetCtx);
                  _showPrivKey(context, w);
                },
                icon: const Icon(Icons.vpn_key, color: kZbxAmber),
                label: const Text('Show private key'),
              ),
              if (w.mnemonic.isNotEmpty) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(46)),
                  onPressed: () {
                    Navigator.pop(sheetCtx);
                    _showMnemonic(context, w);
                  },
                  icon: const Icon(Icons.text_snippet, color: kZbxAmber),
                  label: const Text('Show recovery phrase'),
                ),
              ],
              const SizedBox(height: 8),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                    foregroundColor: kZbxRed,
                    side: const BorderSide(color: kZbxRed),
                    minimumSize: const Size.fromHeight(46)),
                onPressed: () async {
                  Navigator.pop(sheetCtx);
                  await _confirmRemove(context, st, w);
                },
                icon: const Icon(Icons.delete_outline),
                label: const Text('Remove this wallet'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _renameDialog(
      BuildContext sheetCtx, AppState st, ZebvixWallet w) async {
    final ctl = TextEditingController(text: w.name);
    final newName = await showDialog<String>(
      context: sheetCtx,
      builder: (_) => AlertDialog(
        backgroundColor: kZbxSurface,
        title: const Text('Rename wallet'),
        content: TextField(
          controller: ctl,
          decoration: const InputDecoration(hintText: 'Wallet name'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(sheetCtx),
              child: const Text('Cancel')),
          ElevatedButton(
              onPressed: () => Navigator.pop(sheetCtx, ctl.text.trim()),
              child: const Text('Save')),
        ],
      ),
    );
    if (newName == null || newName.isEmpty) return;
    await st.renameWallet(w.address, newName);
  }

  Future<void> _showPrivKey(BuildContext context, ZebvixWallet w) async {
    final pk = '0x${w.privateKeyHex}';
    bool revealed = false;
    await showDialog(
      context: context,
      builder: (_) => StatefulBuilder(builder: (ctx, setS) {
        return AlertDialog(
          backgroundColor: kZbxSurface,
          title: Row(
            children: const [
              Icon(Icons.warning_amber, color: kZbxAmber, size: 20),
              SizedBox(width: 8),
              Text('Private key'),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                  'Anyone with this key controls your funds. Never share it. Never paste it on a website.',
                  style: TextStyle(color: kZbxMuted, fontSize: 12)),
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                    color: kZbxBg,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: kZbxBorder)),
                child: SelectableText(
                  revealed
                      ? pk
                      : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••',
                  style: const TextStyle(
                      fontFamily: 'monospace', fontSize: 12),
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  TextButton.icon(
                      onPressed: () => setS(() => revealed = !revealed),
                      icon: Icon(revealed
                          ? Icons.visibility_off
                          : Icons.visibility),
                      label: Text(revealed ? 'Hide' : 'Reveal')),
                  const Spacer(),
                  if (revealed)
                    TextButton.icon(
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: pk));
                        ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                                content: Text('private key copied')));
                      },
                      icon: const Icon(Icons.copy, size: 16),
                      label: const Text('Copy'),
                    ),
                ],
              ),
            ],
          ),
          actions: [
            ElevatedButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Close')),
          ],
        );
      }),
    );
  }

  Future<void> _showMnemonic(BuildContext context, ZebvixWallet w) async {
    if (w.mnemonic.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('this wallet was imported by private key — '
              'no recovery phrase available')));
      return;
    }
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: kZbxSurface,
        title: const Text('Recovery phrase'),
        content: SelectableText(w.mnemonic,
            style:
                const TextStyle(fontFamily: 'monospace', fontSize: 14)),
        actions: [
          TextButton(
            onPressed: () {
              Clipboard.setData(ClipboardData(text: w.mnemonic));
              ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('phrase copied')));
              Navigator.pop(context);
            },
            child: const Text('Copy'),
          ),
          ElevatedButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Close')),
        ],
      ),
    );
  }

  Future<void> _confirmRemove(
      BuildContext context, AppState st, ZebvixWallet w) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: kZbxSurface,
        title: Text('Remove "${w.name}"?'),
        content: const Text(
            'This deletes the wallet from this device. Make sure you have its recovery phrase or private key backed up.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: kZbxRed),
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Remove')),
        ],
      ),
    );
    if (ok == true) {
      await st.removeWallet(w.address);
    }
  }

  // ── Add wallet flows ───────────────────────────────────────────────────
  Future<void> _createNew(BuildContext context) async {
    final st = context.read<AppState>();
    final mn = st.wallet.generateMnemonic();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: kZbxSurface,
        title: const Text('New wallet recovery phrase'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text(
              'Write these 12 words down. Anyone with them controls the funds.',
              style: TextStyle(color: kZbxMuted, fontSize: 12)),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
                color: kZbxBg,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: kZbxBorder)),
            child: SelectableText(mn,
                style:
                    const TextStyle(fontFamily: 'monospace', fontSize: 13)),
          ),
        ]),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          TextButton.icon(
            onPressed: () =>
                Clipboard.setData(ClipboardData(text: mn)),
            icon: const Icon(Icons.copy, size: 16),
            label: const Text('Copy'),
          ),
          ElevatedButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Saved — create')),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await st.importMnemonic(mn);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('new wallet created')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('error: $e')));
      }
    }
  }

  Future<void> _importMnemonic(BuildContext context) async {
    final ctl = TextEditingController();
    final mn = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: kZbxSurface,
        title: const Text('Import mnemonic'),
        content: TextField(
          controller: ctl,
          minLines: 3,
          maxLines: 4,
          decoration:
              const InputDecoration(hintText: '12 words separated by spaces'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel')),
          ElevatedButton(
              onPressed: () => Navigator.pop(context, ctl.text.trim()),
              child: const Text('Import')),
        ],
      ),
    );
    if (mn == null || mn.isEmpty) return;
    try {
      await context.read<AppState>().importMnemonic(mn);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('wallet imported')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('error: $e')));
      }
    }
  }

  Future<void> _importPrivKey(BuildContext context) async {
    final ctl = TextEditingController();
    final pk = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: kZbxSurface,
        title: const Text('Import private key'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(
            controller: ctl,
            minLines: 2,
            maxLines: 3,
            style: const TextStyle(fontFamily: 'monospace'),
            decoration:
                const InputDecoration(hintText: '0x... (64 hex chars)'),
          ),
          const SizedBox(height: 8),
          const Text(
              'Paste a 32-byte secp256k1 private key in hex (with or without 0x prefix).',
              style: TextStyle(color: kZbxMuted, fontSize: 11)),
        ]),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel')),
          ElevatedButton(
              onPressed: () => Navigator.pop(context, ctl.text.trim()),
              child: const Text('Import')),
        ],
      ),
    );
    if (pk == null || pk.isEmpty) return;
    try {
      await context.read<AppState>().importPrivateKey(pk);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('wallet imported')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('error: $e')));
      }
    }
  }

  // ── misc ───────────────────────────────────────────────────────────────
  Widget _row(IconData icon, String label,
      {Widget? trailing, VoidCallback? onTap}) {
    final w = Row(
      children: [
        Icon(icon, size: 18, color: kZbxTeal),
        const SizedBox(width: 12),
        Expanded(
            child: Text(label,
                style: const TextStyle(
                    fontSize: 13, fontWeight: FontWeight.w600))),
        if (trailing != null) trailing,
        if (onTap != null) const Icon(Icons.chevron_right, color: kZbxMuted),
      ],
    );
    return InkWell(
        onTap: onTap,
        child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4), child: w));
  }

  Future<void> _signOut(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: kZbxSurface,
        title: const Text('Sign out?'),
        content: const Text(
            'This deletes ALL wallets, private keys, and mnemonics from this device. Make sure you have backups.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: kZbxRed),
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Wipe & sign out')),
        ],
      ),
    );
    if (ok == true) {
      await context.read<AppState>().signOut();
    }
  }
}
