import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../theme.dart';
import '../state/app_state.dart';
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
          const SectionHeader(title: 'WALLET'),
          GradientCard(
            child: Column(children: [
              _row(Icons.fingerprint, 'Address',
                  trailing: SelectableText(st.address ?? '—',
                      style: const TextStyle(
                          fontFamily: 'monospace', fontSize: 11))),
              const Divider(color: kZbxBorder, height: 24),
              _row(Icons.vpn_key, 'View recovery phrase',
                  onTap: () => _showMnemonic(context, st)),
              const Divider(color: kZbxBorder, height: 24),
              _row(Icons.security, 'Biometric / PIN lock',
                  trailing: Switch(
                      value: st.biometricEnabled,
                      activeColor: kZbxTeal,
                      onChanged: (v) => st.setBiometric(v))),
            ]),
          ),
          const SizedBox(height: 16),
          const SectionHeader(title: 'NETWORK'),
          GradientCard(
            child: Column(children: [
              const Text('RPC endpoint',
                  style: TextStyle(color: kZbxMuted, fontSize: 11)),
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
              const Text('Pairing relay base URL',
                  style: TextStyle(color: kZbxMuted, fontSize: 11)),
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
              _row(Icons.info_outline, 'Chain', trailing: const Text('Zebvix (ZBX) — chain_id 7878')),
              const Divider(color: kZbxBorder, height: 24),
              _row(Icons.label, 'Version', trailing: const Text('0.1.0')),
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
            label: const Text('Sign out & wipe keys'),
          ),
        ],
      ),
    );
  }

  Widget _row(IconData icon, String label,
      {Widget? trailing, VoidCallback? onTap}) {
    final w = Row(
      children: [
        Icon(icon, size: 18, color: kZbxTeal),
        const SizedBox(width: 12),
        Expanded(
            child: Text(label,
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
        if (trailing != null) trailing,
        if (onTap != null) const Icon(Icons.chevron_right, color: kZbxMuted),
      ],
    );
    return InkWell(onTap: onTap, child: Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: w));
  }

  Future<void> _showMnemonic(BuildContext context, AppState st) async {
    final w = await st.currentWallet();
    if (w == null || w.mnemonic.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('mnemonic not stored')));
      return;
    }
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: kZbxSurface,
        title: const Text('Recovery phrase'),
        content: SelectableText(w.mnemonic,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 14)),
        actions: [
          TextButton(
            onPressed: () {
              Clipboard.setData(ClipboardData(text: w.mnemonic));
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

  Future<void> _signOut(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: kZbxSurface,
        title: const Text('Sign out?'),
        content: const Text(
            'This deletes your private key and mnemonic from this device. Make sure you have your recovery phrase saved elsewhere.'),
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
