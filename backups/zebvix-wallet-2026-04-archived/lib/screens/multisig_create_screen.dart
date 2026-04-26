import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../theme.dart';
import '../state/app_state.dart';
import '../widgets/widgets.dart';

class MultisigCreateScreen extends StatefulWidget {
  const MultisigCreateScreen({super.key});
  @override
  State<MultisigCreateScreen> createState() => _MultisigCreateScreenState();
}

class _MultisigCreateScreenState extends State<MultisigCreateScreen> {
  final List<TextEditingController> signerCtls = [];
  int threshold = 2;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    final myAddr = context.read<AppState>().address ?? '';
    signerCtls.add(TextEditingController(text: myAddr));
    signerCtls.add(TextEditingController());
  }

  @override
  void dispose() {
    for (final c in signerCtls) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final n = signerCtls.length;
    final addrs = signerCtls
        .map((c) => c.text.trim())
        .where((s) => s.isNotEmpty)
        .toList();
    final allValid = addrs.every(
        (a) => RegExp(r'^0x[0-9a-fA-F]{40}$').hasMatch(a));
    final dedup = addrs.toSet().length == addrs.length;
    final canCreate = addrs.length >= 2 &&
        threshold >= 1 &&
        threshold <= addrs.length &&
        allValid &&
        dedup;

    return Scaffold(
      appBar: AppBar(title: const Text('Create multisig')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const SectionHeader(title: 'SIGNERS'),
          for (int i = 0; i < n; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(children: [
                Container(
                  width: 28,
                  height: 28,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                      color: kZbxViolet.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(8)),
                  child: Text('${i + 1}',
                      style: const TextStyle(
                          color: kZbxViolet, fontWeight: FontWeight.w700)),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: signerCtls[i],
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                    decoration: const InputDecoration(
                        hintText: '0x... 40 hex chars'),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                IconButton(
                  onPressed: signerCtls.length > 2
                      ? () => setState(() => signerCtls.removeAt(i))
                      : null,
                  icon: const Icon(Icons.remove_circle_outline,
                      color: kZbxRed),
                ),
              ]),
            ),
          OutlinedButton.icon(
            onPressed: signerCtls.length >= 10
                ? null
                : () => setState(
                    () => signerCtls.add(TextEditingController())),
            icon: const Icon(Icons.add),
            label: const Text('Add signer'),
          ),
          const SizedBox(height: 20),
          const SectionHeader(title: 'THRESHOLD (M of N)'),
          GradientCard(
            child: Column(children: [
              Row(children: [
                Text('$threshold',
                    style: const TextStyle(
                        fontSize: 36,
                        fontWeight: FontWeight.w800,
                        color: kZbxViolet)),
                const SizedBox(width: 8),
                Text('of ${addrs.length} signers must approve',
                    style:
                        const TextStyle(color: kZbxMuted, fontSize: 13)),
              ]),
              Slider(
                value: threshold.toDouble(),
                min: 1,
                max: (addrs.isEmpty ? 1 : addrs.length).toDouble(),
                divisions: addrs.isEmpty ? 1 : (addrs.length - 1).clamp(1, 100),
                activeColor: kZbxViolet,
                onChanged: (v) => setState(() => threshold = v.round()),
              ),
            ]),
          ),
          const SizedBox(height: 20),
          if (!dedup)
            const Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: Text('Duplicate signer addresses',
                  style: TextStyle(color: kZbxRed, fontSize: 12)),
            ),
          if (!allValid && addrs.isNotEmpty)
            const Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: Text('One or more addresses are invalid',
                  style: TextStyle(color: kZbxRed, fontSize: 12)),
            ),
          GradientButton(
            label: 'Sign & deploy multisig',
            icon: Icons.shield,
            colors: const [kZbxViolet, Color(0xFFB14CFF)],
            busy: busy,
            onPressed: !canCreate ? null : () => _submit(addrs),
          ),
        ],
      ),
    );
  }

  Future<void> _submit(List<String> signers) async {
    setState(() => busy = true);
    try {
      final res = await context
          .read<AppState>()
          .createMultisig(signers: signers, threshold: threshold);
      if (!mounted) return;
      Navigator.pop(context);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('deployed: $res')));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('error: $e')));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }
}
