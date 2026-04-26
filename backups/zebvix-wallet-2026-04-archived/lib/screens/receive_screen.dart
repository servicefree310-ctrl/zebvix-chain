import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../theme.dart';
import '../state/app_state.dart';
import '../utils/format.dart';

class ReceiveScreen extends StatelessWidget {
  const ReceiveScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    final addr = st.address ?? '';
    return Scaffold(
      appBar: AppBar(title: const Text('Receive')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                boxShadow: [
                  BoxShadow(
                      color: kZbxTeal.withOpacity(0.3),
                      blurRadius: 30,
                      spreadRadius: 4),
                ],
              ),
              child: QrImageView(
                data: addr,
                version: QrVersions.auto,
                size: 240,
                backgroundColor: Colors.white,
              ),
            ),
            const SizedBox(height: 24),
            if (st.balance.payIdName != null) ...[
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                    color: kZbxTeal.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: kZbxTeal.withOpacity(0.3))),
                child: Text('@${st.balance.payIdName}',
                    style: const TextStyle(
                        color: kZbxTeal,
                        fontWeight: FontWeight.w700,
                        fontSize: 16)),
              ),
              const SizedBox(height: 12),
            ],
            SelectableText(
              addr,
              style: const TextStyle(
                  fontFamily: 'monospace', fontSize: 13),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 18),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                OutlinedButton.icon(
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: addr));
                    ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('address copied')));
                  },
                  icon: const Icon(Icons.copy, size: 16),
                  label: const Text('Copy'),
                ),
                const SizedBox(width: 12),
                OutlinedButton.icon(
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: 'zbx:$addr'));
                  },
                  icon: const Icon(Icons.share, size: 16),
                  label: const Text('Share URI'),
                ),
              ],
            ),
            const SizedBox(height: 30),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: kZbxSurface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: kZbxBorder),
              ),
              child: Column(
                children: [
                  _kv('Network', 'Zebvix Mainnet'),
                  _kv('Chain ID', '7878'),
                  _kv('Nonce', '${st.balance.nonce}'),
                  _kv('Liquid', '${fmtZbx(st.balance.liquidZbx)} ZBX'),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          Text(k, style: const TextStyle(color: kZbxMuted, fontSize: 12)),
          const Spacer(),
          Text(v,
              style: const TextStyle(
                  fontFamily: 'monospace', fontSize: 12)),
        ]),
      );
}
