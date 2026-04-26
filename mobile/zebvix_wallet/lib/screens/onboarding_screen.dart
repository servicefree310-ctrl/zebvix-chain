import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';
import '../core/wallet_store.dart';
import '../theme.dart';
import '../widgets/glass_card.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  int _step = 0; // 0 = welcome, 1 = create, 2 = import
  String? _generatedMnemonic;
  bool _confirmed = false;
  final _importCtrl = TextEditingController();
  bool _busy = false;
  String? _err;

  @override
  void dispose() {
    _importCtrl.dispose();
    super.dispose();
  }

  Future<void> _startCreate() async {
    final store = context.read<WalletStore>();
    setState(() {
      _step = 1;
      _generatedMnemonic = store.generateMnemonic();
      _confirmed = false;
      _err = null;
    });
  }

  Future<void> _finishCreate() async {
    if (_generatedMnemonic == null) return;
    setState(() {
      _busy = true;
      _err = null;
    });
    try {
      await context.read<WalletStore>().createWallet(_generatedMnemonic!);
    } catch (e) {
      setState(() => _err = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _finishImport() async {
    setState(() {
      _busy = true;
      _err = null;
    });
    try {
      await context.read<WalletStore>().createWallet(_importCtrl.text);
    } catch (e) {
      setState(() => _err = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // Quick Test: creates a wallet from the well-known Hardhat/Foundry test
  // mnemonic so the user can jump straight into the app without writing
  // down a phrase. Address #0 = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266.
  static const _testMnemonic =
      'test test test test test test test test test test test junk';

  Future<void> _quickTest() async {
    setState(() {
      _busy = true;
      _err = null;
    });
    try {
      await context.read<WalletStore>().createWallet(_testMnemonic);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Test wallet loaded — DO NOT send real funds'),
            duration: Duration(seconds: 3),
          ),
        );
      }
    } catch (e) {
      setState(() => _err = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: switch (_step) {
            1 => _buildCreate(),
            2 => _buildImport(),
            _ => _buildWelcome(),
          },
        ),
      ),
    );
  }

  Widget _buildWelcome() {
    return Column(
      children: [
        const SizedBox(height: 40),
        Container(
          width: 120,
          height: 120,
          decoration: BoxDecoration(
            gradient: AppColors.accentGradient,
            borderRadius: BorderRadius.circular(36),
            boxShadow: [
              BoxShadow(
                color: AppColors.accent.withOpacity(0.3),
                blurRadius: 40,
                spreadRadius: 4,
              ),
            ],
          ),
          child: const Icon(Icons.bolt_rounded, size: 64, color: Colors.black),
        ).animate().scale(duration: 600.ms, curve: Curves.elasticOut),
        const SizedBox(height: 32),
        const Text(
          'Zebvix Wallet',
          style: TextStyle(
            fontSize: 34,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.8,
          ),
        ).animate().fadeIn(delay: 200.ms),
        const SizedBox(height: 12),
        const Text(
          'Multichain crypto wallet\nwith built-in bridge & QR sign',
          textAlign: TextAlign.center,
          style: TextStyle(color: AppColors.textDim, fontSize: 16, height: 1.5),
        ).animate().fadeIn(delay: 400.ms),
        const Spacer(),
        _featureRow(Icons.account_balance_wallet_rounded, 'Self-custody',
                'Your keys stay on this device, encrypted')
            .animate()
            .fadeIn(delay: 600.ms)
            .slideY(begin: 0.2),
        const SizedBox(height: 12),
        _featureRow(Icons.swap_horiz_rounded, 'Native bridge',
                'Move ZBX between Zebvix L1 and BSC')
            .animate()
            .fadeIn(delay: 700.ms)
            .slideY(begin: 0.2),
        const SizedBox(height: 12),
        _featureRow(Icons.qr_code_scanner_rounded, 'QR sign',
                'Scan from dashboard to approve transactions')
            .animate()
            .fadeIn(delay: 800.ms)
            .slideY(begin: 0.2),
        const Spacer(),
        SizedBox(
          width: double.infinity,
          child: GradientButton(
            label: 'Create new wallet',
            icon: Icons.add_rounded,
            onPressed: _startCreate,
          ),
        ).animate().fadeIn(delay: 900.ms),
        const SizedBox(height: 12),
        TextButton(
          onPressed: () => setState(() => _step = 2),
          child: const Text(
            'Import existing wallet',
            style: TextStyle(color: AppColors.textDim, fontSize: 15),
          ),
        ).animate().fadeIn(delay: 1000.ms),
        const SizedBox(height: 4),
        // Dev-only quick test entry point
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: _busy ? null : _quickTest,
            icon: const Icon(Icons.science_outlined, size: 18),
            label: const Text('Quick Test (dev wallet)'),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.accent,
              side: BorderSide(color: AppColors.accent.withOpacity(0.4)),
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
        ).animate().fadeIn(delay: 1100.ms),
        const SizedBox(height: 6),
        const Text(
          'Pre-loaded Hardhat test phrase. Do NOT send real funds.',
          textAlign: TextAlign.center,
          style: TextStyle(color: AppColors.textMuted, fontSize: 11),
        ),
        const SizedBox(height: 12),
      ],
    );
  }

  Widget _featureRow(IconData icon, String title, String subtitle) {
    return GlassCard(
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: AppColors.accent.withOpacity(0.15),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: AppColors.accent, size: 22),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: const TextStyle(
                        fontWeight: FontWeight.w700, fontSize: 15)),
                const SizedBox(height: 2),
                Text(subtitle,
                    style: const TextStyle(
                        color: AppColors.textDim, fontSize: 13)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCreate() {
    final words = _generatedMnemonic?.split(' ') ?? [];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            IconButton(
              onPressed: () => setState(() => _step = 0),
              icon: const Icon(Icons.arrow_back_rounded),
            ),
            const Spacer(),
          ],
        ),
        const Text(
          'Your recovery phrase',
          style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        const Text(
          'Write these 12 words in order. This is the ONLY way to recover your wallet.',
          style: TextStyle(color: AppColors.textDim, fontSize: 14, height: 1.4),
        ),
        const SizedBox(height: 20),
        GlassCard(
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: List.generate(words.length, (i) {
              return Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: AppColors.surface2,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text('${i + 1}',
                        style: const TextStyle(
                            color: AppColors.textMuted, fontSize: 11)),
                    const SizedBox(width: 6),
                    Text(words[i],
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 14)),
                  ],
                ),
              );
            }),
          ),
        ),
        const SizedBox(height: 12),
        TextButton.icon(
          onPressed: () {
            Clipboard.setData(ClipboardData(text: _generatedMnemonic ?? ''));
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Copied to clipboard')),
            );
          },
          icon: const Icon(Icons.copy_rounded, size: 18),
          label: const Text('Copy phrase'),
        ),
        const Spacer(),
        Row(
          children: [
            Checkbox(
              value: _confirmed,
              onChanged: (v) => setState(() => _confirmed = v ?? false),
              activeColor: AppColors.accent,
              checkColor: Colors.black,
            ),
            const Expanded(
              child: Text(
                'I have safely backed up my recovery phrase',
                style: TextStyle(color: AppColors.textDim, fontSize: 13),
              ),
            ),
          ],
        ),
        if (_err != null) ...[
          const SizedBox(height: 8),
          Text(_err!, style: const TextStyle(color: AppColors.danger)),
        ],
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          child: GradientButton(
            label: 'Continue',
            icon: Icons.check_rounded,
            loading: _busy,
            onPressed: _confirmed ? _finishCreate : null,
          ),
        ),
      ],
    );
  }

  Widget _buildImport() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            IconButton(
              onPressed: () => setState(() => _step = 0),
              icon: const Icon(Icons.arrow_back_rounded),
            ),
            const Spacer(),
          ],
        ),
        const Text(
          'Import recovery phrase',
          style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        const Text(
          'Enter your 12 or 24 word phrase, separated by spaces.',
          style: TextStyle(color: AppColors.textDim, fontSize: 14, height: 1.4),
        ),
        const SizedBox(height: 20),
        TextField(
          controller: _importCtrl,
          minLines: 4,
          maxLines: 6,
          style: const TextStyle(fontSize: 15, height: 1.6),
          decoration: const InputDecoration(
            hintText: 'word1 word2 word3 ...',
          ),
        ),
        if (_err != null) ...[
          const SizedBox(height: 8),
          Text(_err!, style: const TextStyle(color: AppColors.danger)),
        ],
        const Spacer(),
        SizedBox(
          width: double.infinity,
          child: GradientButton(
            label: 'Import wallet',
            icon: Icons.download_rounded,
            loading: _busy,
            onPressed: _importCtrl.text.trim().split(' ').length >= 12
                ? _finishImport
                : null,
          ),
        ),
      ],
    );
  }
}
