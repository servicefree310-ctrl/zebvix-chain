import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../theme.dart';
import '../state/app_state.dart';
import '../utils/format.dart';
import '../widgets/widgets.dart';
import 'multisig_create_screen.dart';

class MultisigTab extends StatefulWidget {
  const MultisigTab({super.key});
  @override
  State<MultisigTab> createState() => _MultisigTabState();
}

class _MultisigTabState extends State<MultisigTab> {
  final lookupCtl = TextEditingController();
  Map<String, dynamic>? info;
  String? lookupError;
  bool busy = false;

  Future<void> _lookup(BuildContext context) async {
    final addr = lookupCtl.text.trim();
    if (!RegExp(r'^0x[0-9a-fA-F]{40}$').hasMatch(addr)) {
      setState(() {
        info = null;
        lookupError = 'invalid multisig address (need 0x + 40 hex)';
      });
      return;
    }
    setState(() {
      busy = true;
      info = null;
      lookupError = null;
    });
    try {
      final r = await context.read<AppState>().rpc.getMultisig(addr);
      setState(() {
        info = r;
        if (r == null) lookupError = 'no multisig found at this address';
      });
    } catch (e) {
      setState(() => lookupError = e.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Multisig')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          GradientCard(
            colors: const [Color(0xFF1A0E2A), Color(0xFF120E1F)],
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.add_moderator, color: kZbxViolet),
                    SizedBox(width: 8),
                    Text('Create new multisig wallet',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w700)),
                  ],
                ),
                const SizedBox(height: 6),
                const Text(
                    'M-of-N signers — funds can only move when at least M signers approve.',
                    style: TextStyle(color: kZbxMuted, fontSize: 12)),
                const SizedBox(height: 14),
                GradientButton(
                  label: 'Create multisig',
                  icon: Icons.add,
                  colors: const [kZbxViolet, Color(0xFFB14CFF)],
                  onPressed: () {
                    Navigator.push(
                        context,
                        MaterialPageRoute(
                            builder: (_) => const MultisigCreateScreen()));
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          const SectionHeader(title: 'INSPECT EXISTING MULTISIG'),
          GradientCard(
            child: Column(
              children: [
                TextField(
                  controller: lookupCtl,
                  decoration: const InputDecoration(
                      hintText: '0x... multisig contract address'),
                  style: const TextStyle(fontFamily: 'monospace'),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: busy ? null : () => _lookup(context),
                    icon: busy
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.search),
                    label: const Text('Lookup'),
                  ),
                ),
                if (lookupError != null) ...[
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                        color: kZbxRed.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: kZbxRed.withOpacity(0.3))),
                    child: Text(lookupError!,
                        style: const TextStyle(color: kZbxRed, fontSize: 12)),
                  ),
                ],
                if (info != null) ...[
                  const SizedBox(height: 14),
                  _msInfo(info!),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _msInfo(Map<String, dynamic> i) {
    final signers = (i['signers'] as List?) ?? [];
    final threshold = (i['threshold'] as num?)?.toInt() ?? 0;
    final pending = (i['pending'] as List?) ?? [];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
                color: kZbxViolet.withOpacity(0.15),
                borderRadius: BorderRadius.circular(8)),
            child: Text('$threshold of ${signers.length}',
                style: const TextStyle(
                    color: kZbxViolet, fontWeight: FontWeight.w800)),
          ),
          const SizedBox(width: 8),
          const Text('signers required',
              style: TextStyle(color: kZbxMuted, fontSize: 12)),
        ]),
        const SizedBox(height: 12),
        const Text('SIGNERS',
            style: TextStyle(color: kZbxMuted, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1)),
        const SizedBox(height: 6),
        ...signers.map((s) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(children: [
                const Icon(Icons.account_circle,
                    size: 16, color: kZbxMuted),
                const SizedBox(width: 6),
                Text(shortAddr(s.toString(), head: 8, tail: 6),
                    style: const TextStyle(
                        fontFamily: 'monospace', fontSize: 12)),
              ]),
            )),
        const SizedBox(height: 12),
        Text('PENDING PROPOSALS (${pending.length})',
            style: const TextStyle(
                color: kZbxMuted,
                fontSize: 11,
                fontWeight: FontWeight.w700,
                letterSpacing: 1)),
        const SizedBox(height: 6),
        if (pending.isEmpty)
          const Text('— none —', style: TextStyle(color: kZbxMuted, fontSize: 12))
        else
          ...pending.map((p) {
            final m = p as Map;
            return Container(
              margin: const EdgeInsets.symmetric(vertical: 4),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                  color: kZbxBg,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: kZbxBorder)),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Proposal #${m['id']}',
                            style: const TextStyle(
                                fontWeight: FontWeight.w700, fontSize: 13)),
                        const SizedBox(height: 2),
                        Text(
                            '${(m['approvals'] as List?)?.length ?? 0} / ${m['threshold'] ?? '?'} approvals',
                            style: const TextStyle(
                                color: kZbxMuted, fontSize: 11)),
                      ],
                    ),
                  ),
                  ElevatedButton(
                    onPressed: () => _approve(
                        lookupCtl.text.trim(), (m['id'] as num).toInt()),
                    style: ElevatedButton.styleFrom(
                        backgroundColor: kZbxViolet,
                        foregroundColor: Colors.white,
                        minimumSize: const Size(0, 36),
                        padding:
                            const EdgeInsets.symmetric(horizontal: 12)),
                    child: const Text('Approve'),
                  ),
                ],
              ),
            );
          }),
      ],
    );
  }

  Future<void> _approve(String multisig, int proposalId) async {
    try {
      final r = await context
          .read<AppState>()
          .approveMultisig(multisig: multisig, proposalId: proposalId);
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('approve sent: $r')));
      _lookup(context);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('error: $e')));
    }
  }
}
