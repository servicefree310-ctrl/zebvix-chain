import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../theme.dart';
import '../state/app_state.dart';
import '../utils/format.dart';
import '../widgets/widgets.dart';
import 'scan_qr_screen.dart';

class SendScreen extends StatefulWidget {
  const SendScreen({super.key});
  @override
  State<SendScreen> createState() => _SendScreenState();
}

class _SendScreenState extends State<SendScreen> {
  final toCtl = TextEditingController();
  final amountCtl = TextEditingController();
  bool busy = false;

  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    final to = toCtl.text.trim();
    final amount = double.tryParse(amountCtl.text) ?? 0;
    final addrValid = RegExp(r'^0x[0-9a-fA-F]{40}$').hasMatch(to);
    final amountValid = amount > 0 && amount <= st.balance.liquidZbx;
    final canSend = addrValid && amountValid && !busy;

    return Scaffold(
      appBar: AppBar(title: const Text('Send ZBX')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          GradientCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('To',
                    style: TextStyle(color: kZbxMuted, fontSize: 11)),
                const SizedBox(height: 6),
                Row(children: [
                  Expanded(
                    child: TextField(
                      controller: toCtl,
                      style: const TextStyle(fontFamily: 'monospace'),
                      decoration: const InputDecoration(
                          hintText: '0x... 40 hex chars'),
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    onPressed: () async {
                      final r = await Navigator.push<String>(
                          context,
                          MaterialPageRoute(
                              builder: (_) => const ScanQrScreen()));
                      if (r != null && mounted) {
                        toCtl.text = r;
                        setState(() {});
                      }
                    },
                    icon: const Icon(Icons.qr_code_scanner,
                        color: kZbxTeal),
                  ),
                ]),
                if (to.isNotEmpty && !addrValid)
                  const Padding(
                    padding: EdgeInsets.only(top: 4),
                    child: Text('invalid address (need 0x + 40 hex chars)',
                        style: TextStyle(color: kZbxRed, fontSize: 11)),
                  ),
                const SizedBox(height: 18),
                const Text('Amount',
                    style: TextStyle(color: kZbxMuted, fontSize: 11)),
                const SizedBox(height: 6),
                Row(children: [
                  Expanded(
                    child: TextField(
                      controller: amountCtl,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      style: const TextStyle(
                          fontSize: 26, fontWeight: FontWeight.w700),
                      decoration: const InputDecoration(hintText: '0.0'),
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                  const SizedBox(width: 8),
                  TextButton(
                    onPressed: () {
                      amountCtl.text =
                          (st.balance.liquidZbx - 0.01).clamp(0, 1e18).toStringAsFixed(4);
                      setState(() {});
                    },
                    child: const Text('MAX'),
                  ),
                  const Text('ZBX',
                      style: TextStyle(
                          color: kZbxTeal, fontWeight: FontWeight.w700)),
                ]),
                Text('Available: ${fmtZbx(st.balance.liquidZbx)} ZBX',
                    style:
                        const TextStyle(color: kZbxMuted, fontSize: 11)),
              ],
            ),
          ),
          const SizedBox(height: 16),
          GradientCard(
            child: Column(children: [
              _kv('Network fee', '0.002 ZBX (≈ \$0.002)'),
              _kv('Total', '${fmtZbx(amount + 0.002)} ZBX'),
              _kv('Chain', 'Zebvix mainnet (7878)'),
            ]),
          ),
          const SizedBox(height: 20),
          GradientButton(
            label: 'Sign & send',
            icon: Icons.send,
            busy: busy,
            onPressed: canSend ? () => _send(amount) : null,
          ),
        ],
      ),
    );
  }

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [
          Text(k, style: const TextStyle(color: kZbxMuted, fontSize: 12)),
          const Spacer(),
          Text(v,
              style: const TextStyle(
                  fontSize: 12, fontWeight: FontWeight.w600)),
        ]),
      );

  Future<void> _send(double amount) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: kZbxSurface,
        title: const Text('Confirm send'),
        content: Text('Send ${fmtZbx(amount)} ZBX to ${shortAddr(toCtl.text)}?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          ElevatedButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Send')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => busy = true);
    try {
      final hash = await context
          .read<AppState>()
          .sendTransfer(to: toCtl.text.trim(), amountZbx: amount);
      if (!mounted) return;
      Navigator.pop(context);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('sent: $hash')));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('error: $e')));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }
}
