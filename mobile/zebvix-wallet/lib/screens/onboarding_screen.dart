import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../theme.dart';
import '../state/app_state.dart';
import '../widgets/widgets.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});
  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  String? generatedMnemonic;
  bool busy = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 24),
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(20),
                  gradient: const LinearGradient(
                      colors: [kZbxTeal, kZbxCyan]),
                ),
                child: const Icon(Icons.account_balance_wallet,
                    color: Colors.black, size: 36),
              ),
              const SizedBox(height: 20),
              const Text('Zebvix Wallet',
                  style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              const Text(
                'Non-custodial wallet for the Zebvix (ZBX) L1 chain',
                style: TextStyle(color: kZbxMuted, fontSize: 14),
              ),
              const SizedBox(height: 32),
              GradientButton(
                label: 'Create new wallet',
                icon: Icons.add_circle_outline,
                busy: busy,
                onPressed: () => _create(context),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(52)),
                onPressed: () => _import(context),
                icon: const Icon(Icons.download),
                label: const Text('Import 12-word mnemonic'),
              ),
              const SizedBox(height: 28),
              const Text(
                'Your private keys never leave this device. They are stored in encrypted secure storage and protected by your device biometrics / PIN.',
                style: TextStyle(color: kZbxMuted, fontSize: 12),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _create(BuildContext context) async {
    setState(() => busy = true);
    try {
      final st = context.read<AppState>();
      final mn = st.wallet.generateMnemonic();
      generatedMnemonic = mn;
      // Show the recovery phrase first; require explicit confirm to proceed.
      final confirmed = await showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        backgroundColor: kZbxBg,
        shape: const RoundedRectangleBorder(
            borderRadius:
                BorderRadius.vertical(top: Radius.circular(24))),
        builder: (_) => _MnemonicSheet(mnemonic: mn),
      );
      if (confirmed != true) return;
      await st.importMnemonic(mn);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('error: $e')));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _import(BuildContext context) async {
    final controller = TextEditingController();
    final mn = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: kZbxSurface,
        title: const Text('Import mnemonic'),
        content: TextField(
          controller: controller,
          minLines: 3,
          maxLines: 4,
          decoration: const InputDecoration(
            hintText: '12 words separated by spaces',
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel')),
          ElevatedButton(
              onPressed: () =>
                  Navigator.pop(context, controller.text.trim()),
              child: const Text('Import')),
        ],
      ),
    );
    if (mn == null || mn.isEmpty) return;
    setState(() => busy = true);
    try {
      await context.read<AppState>().importMnemonic(mn);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('error: $e')));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }
}

class _MnemonicSheet extends StatelessWidget {
  final String mnemonic;
  const _MnemonicSheet({required this.mnemonic});
  @override
  Widget build(BuildContext context) {
    final words = mnemonic.split(' ');
    return Padding(
      padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 20,
          bottom: 20 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            width: 40,
            height: 4,
            margin: const EdgeInsets.only(bottom: 16),
            decoration: BoxDecoration(
                color: kZbxBorder, borderRadius: BorderRadius.circular(2)),
          ),
          const Text('Recovery phrase',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          const Text(
              'Write these 12 words down on paper. Anyone with this phrase can spend your funds. Never share it.',
              style: TextStyle(color: kZbxMuted, fontSize: 12)),
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: List.generate(words.length, (i) {
              return Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                    color: kZbxSurface,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: kZbxBorder)),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text('${i + 1}',
                        style: const TextStyle(
                            color: kZbxMuted, fontSize: 10)),
                    const SizedBox(width: 6),
                    Text(words[i],
                        style: const TextStyle(
                            fontFamily: 'monospace',
                            fontWeight: FontWeight.w700)),
                  ],
                ),
              );
            }),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: () {
              Clipboard.setData(ClipboardData(text: mnemonic));
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                  content: Text('copied — paste only into your password manager')));
            },
            icon: const Icon(Icons.copy, size: 16),
            label: const Text('Copy phrase'),
          ),
          const SizedBox(height: 12),
          GradientButton(
            label: "I've saved it — continue",
            icon: Icons.check,
            onPressed: () => Navigator.pop(context, true),
          ),
        ],
      ),
    );
  }
}
