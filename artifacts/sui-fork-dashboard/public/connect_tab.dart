import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../theme.dart';
import '../state/app_state.dart';
import '../services/pairing_service.dart';
import '../utils/format.dart';
import '../widgets/widgets.dart';
import 'scan_qr_screen.dart';

class ConnectTab extends StatefulWidget {
  const ConnectTab({super.key});
  @override
  State<ConnectTab> createState() => _ConnectTabState();
}

class _ConnectTabState extends State<ConnectTab> {
  StreamSubscription<SignRequest>? _sub;
  bool listening = false;

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  void _listen() {
    final st = context.read<AppState>();
    _sub?.cancel();
    _sub = st.pairing?.incoming.listen((req) {
      _showApprovalSheet(req);
    });
    setState(() => listening = true);
  }

  Future<void> _scan() async {
    final raw = await Navigator.push<String>(
        context, MaterialPageRoute(builder: (_) => const ScanQrScreen()));
    if (raw == null) return;
    final p = PairPayload.tryDecode(raw);
    if (p == null) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('not a Zebvix Connect QR')));
      return;
    }
    final st = context.read<AppState>();
    try {
      await st.pairing!
          .connect(payload: p, address: st.address!, payIdName: st.balance.payIdName);
      _listen();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('paired with dashboard')));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('pair failed: $e')));
    }
  }

  Future<void> _disconnect() async {
    await context.read<AppState>().pairing?.disconnect();
    _sub?.cancel();
    setState(() => listening = false);
  }

  Future<void> _showApprovalSheet(SignRequest req) async {
    final approved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: kZbxBg,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => _ApprovalSheet(req: req),
    );

    final st = context.read<AppState>();
    if (approved == true) {
      try {
        Map<String, dynamic>? result;
        if (req.type == 'transfer') {
          final to = req.payload['to'].toString();
          final amt = double.tryParse(req.payload['amountZbx'].toString()) ?? 0;
          final hash = await st.sendTransfer(to: to, amountZbx: amt);
          result = {'txHash': hash};
        } else if (req.type == 'swap') {
          final amt = double.tryParse(req.payload['amountZbx'].toString()) ?? 0;
          final hash = await st.swapZbxToZusd(amountZbx: amt);
          result = {'txHash': hash};
        } else if (req.type == 'multisig_approve') {
          final ms = req.payload['multisig'].toString();
          final pid = int.tryParse(req.payload['proposalId'].toString()) ?? 0;
          final hash = await st.approveMultisig(multisig: ms, proposalId: pid);
          result = {'txHash': hash};
        } else if (req.type == 'message') {
          final wallet = await st.currentWallet();
          if (wallet == null) throw Exception('no wallet');
          final msg = req.payload['message'].toString();
          final sigBytes = st.wallet
              .signRaw(Uint8List.fromList(utf8.encode(msg)), wallet.privateKey);
          result = {
            'address': wallet.address,
            'pubkey': '0x${wallet.publicKeyHex}',
            'signature': '0x${sigBytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join()}',
            'message': msg,
          };
        }
        await st.pairing!.respond(
            requestId: req.id, status: 'approved', result: result);
      } catch (e) {
        await st.pairing!
            .respond(requestId: req.id, status: 'error', error: e.toString());
      }
    } else {
      await st.pairing!
          .respond(requestId: req.id, status: 'rejected', error: 'user rejected');
    }
  }

  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    final paired = st.pairing?.active == true;
    return Scaffold(
      appBar: AppBar(title: const Text('Connect to dashboard')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          GradientCard(
            colors: paired
                ? const [Color(0xFF053A2A), Color(0xFF0E1730)]
                : const [Color(0xFF1A2238), Color(0xFF0E1421)],
            child: Column(
              children: [
                Icon(paired ? Icons.wifi : Icons.wifi_off,
                    size: 48, color: paired ? kZbxEmerald : kZbxMuted),
                const SizedBox(height: 10),
                Text(paired ? 'Connected' : 'Not connected',
                    style: const TextStyle(
                        fontSize: 18, fontWeight: FontWeight.w800)),
                const SizedBox(height: 6),
                Text(
                    paired
                        ? 'Session ${shortAddr(st.pairing?.sessionId ?? "", head: 4, tail: 4)} — listening for sign requests from your browser dashboard.'
                        : 'Open the dashboard → Connect Mobile Wallet, then scan the QR.',
                    textAlign: TextAlign.center,
                    style:
                        const TextStyle(color: kZbxMuted, fontSize: 12)),
                const SizedBox(height: 16),
                paired
                    ? OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                            minimumSize: const Size.fromHeight(48),
                            foregroundColor: kZbxRed,
                            side: const BorderSide(color: kZbxRed)),
                        onPressed: _disconnect,
                        icon: const Icon(Icons.link_off),
                        label: const Text('Disconnect'),
                      )
                    : GradientButton(
                        label: 'Scan dashboard QR',
                        icon: Icons.qr_code_scanner,
                        onPressed: _scan,
                      ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          GradientCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('How it works',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                const SizedBox(height: 8),
                _step('1', 'Open dashboard → Connect Mobile Wallet'),
                _step('2', 'Tap Scan above → point at the QR'),
                _step('3',
                    'Sign requests from the browser appear here as approval prompts'),
                _step('4',
                    'Approve / reject — your private key never leaves this device'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _step(String n, String t) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 22,
              height: 22,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                  color: kZbxTeal.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(11)),
              child: Text(n,
                  style: const TextStyle(
                      color: kZbxTeal,
                      fontWeight: FontWeight.w700,
                      fontSize: 11)),
            ),
            const SizedBox(width: 10),
            Expanded(
                child: Text(t,
                    style: const TextStyle(fontSize: 12, color: kZbxMuted))),
          ],
        ),
      );
}

class _ApprovalSheet extends StatelessWidget {
  final SignRequest req;
  const _ApprovalSheet({required this.req});
  @override
  Widget build(BuildContext context) {
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
                  color: kZbxBorder, borderRadius: BorderRadius.circular(2))),
          Row(children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                  color: kZbxTeal.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(8)),
              child: Text(req.type.toUpperCase(),
                  style: const TextStyle(
                      color: kZbxTeal,
                      fontWeight: FontWeight.w800,
                      fontSize: 11)),
            ),
            const Spacer(),
            const Text('SIGN REQUEST',
                style: TextStyle(
                    color: kZbxMuted, fontSize: 11, letterSpacing: 1)),
          ]),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
                color: kZbxSurface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: kZbxBorder)),
            child: Column(
              children: req.payload.entries
                  .map((e) => Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(
                              width: 90,
                              child: Text(e.key,
                                  style: const TextStyle(
                                      color: kZbxMuted, fontSize: 12)),
                            ),
                            Expanded(
                              child: Text('${e.value}',
                                  style: const TextStyle(
                                      fontFamily: 'monospace',
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600)),
                            ),
                          ],
                        ),
                      ))
                  .toList(),
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      foregroundColor: kZbxRed,
                      side: const BorderSide(color: kZbxRed)),
                  onPressed: () => Navigator.pop(context, false),
                  icon: const Icon(Icons.close),
                  label: const Text('Reject'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: GradientButton(
                  label: 'Approve',
                  icon: Icons.check,
                  onPressed: () => Navigator.pop(context, true),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

