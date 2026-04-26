import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:hex/hex.dart';
import 'package:provider/provider.dart';
import 'package:web3dart/credentials.dart';
import 'package:web3dart/crypto.dart';
import '../core/wallet_store.dart';
import '../session/session_relay.dart';
import '../theme.dart';
import '../widgets/glass_card.dart';

class ApproveScreen extends StatelessWidget {
  const ApproveScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final relay = context.watch<SessionRelay>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Pending requests'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: relay.pending.isEmpty
          ? _empty(relay)
          : ListView.builder(
              padding: const EdgeInsets.all(20),
              itemCount: relay.pending.length,
              itemBuilder: (ctx, i) =>
                  _RequestCard(req: relay.pending[i]),
            ),
    );
  }

  Widget _empty(SessionRelay relay) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(24),
                border: Border.all(color: AppColors.border),
              ),
              child: const Icon(Icons.inbox_rounded,
                  size: 36, color: AppColors.textDim),
            ),
            const SizedBox(height: 16),
            const Text('No pending requests',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(
              relay.status == SessionStatus.connected
                  ? 'Trigger a sign action from the dashboard\nto see it appear here.'
                  : 'Connect via Scan to receive sign requests.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.textDim, fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }
}

class _RequestCard extends StatefulWidget {
  final SessionRequest req;
  const _RequestCard({required this.req});

  @override
  State<_RequestCard> createState() => _RequestCardState();
}

class _RequestCardState extends State<_RequestCard> {
  bool _busy = false;

  Future<void> _approve() async {
    setState(() => _busy = true);
    try {
      final wallet = context.read<WalletStore>();
      final relay = context.read<SessionRelay>();
      final cred = wallet.activeCredentials();
      final method = widget.req.method;
      final pl = widget.req.paramsList;
      Map<String, dynamic> result;
      switch (method) {
        case 'personal_sign':
          // Standard EVM order: params=[messageHex, address]. Some wallets
          // historically used the reverse order; pick whichever value is hex.
          final a = pl.isNotEmpty ? pl[0]?.toString() ?? '' : '';
          final b = pl.length > 1 ? pl[1]?.toString() ?? '' : '';
          final msgHex = a.startsWith('0x') && a.length > 42 ? a : b;
          final raw = HEX.decode(msgHex.replaceFirst('0x', ''));
          final sig = await _signPersonal(cred, Uint8List.fromList(raw));
          result = {'signature': sig};
          break;
        case 'eth_signTypedData_v4':
          final m = widget.req.firstParamMap ?? const <String, dynamic>{};
          final domainHash = (m['domainHash'] as String?) ?? '';
          final structHash = (m['structHash'] as String?) ?? '';
          final sig = await _signTyped(cred, domainHash, structHash);
          result = {'signature': sig};
          break;
        case 'eth_accounts':
        case 'eth_requestAccounts':
          result = {'address': wallet.active!.address};
          break;
        case 'eth_sendTransaction':
          // Returning the signed transaction is intentionally NOT implemented
          // in this preview — needs gas/nonce fetch + chain dispatch.
          // Reject so the dashboard can fall back to in-browser signing.
          throw Exception('eth_sendTransaction not yet supported on mobile');
        default:
          throw Exception('Unsupported method: $method');
      }
      relay.approve(widget.req, result);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Approved')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _reject() {
    context.read<SessionRelay>().reject(widget.req, 'User rejected');
  }

  Future<String> _signPersonal(EthPrivateKey cred, Uint8List msg) async {
    final prefix = '\u0019Ethereum Signed Message:\n${msg.length}';
    final preBytes = Uint8List.fromList([...utf8.encode(prefix), ...msg]);
    final hash = keccak256(preBytes);
    final sig = cred.signPersonalMessageToUint8List(msg);
    return '0x${HEX.encode(sig)}';
    // ignore: dead_code
    final _ = hash;
  }

  Future<String> _signTyped(
      EthPrivateKey cred, String domainHash, String structHash) async {
    final dh = HEX.decode(domainHash.replaceFirst('0x', ''));
    final sh = HEX.decode(structHash.replaceFirst('0x', ''));
    final pre = Uint8List.fromList([0x19, 0x01, ...dh, ...sh]);
    final digest = keccak256(pre);
    final sig = cred.signToEcSignature(digest, chainId: null, isEIP1559: false);
    final r = sig.r.toRadixString(16).padLeft(64, '0');
    final s = sig.s.toRadixString(16).padLeft(64, '0');
    final v = sig.v.toRadixString(16).padLeft(2, '0');
    return '0x$r$s$v';
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: GlassCard(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.surface,
            AppColors.accent.withOpacity(0.06),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.accent.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    widget.req.method,
                    style: const TextStyle(
                        color: AppColors.accent,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        fontFamily: 'monospace'),
                  ),
                ),
                const Spacer(),
                Text(
                  '${DateTime.now().difference(widget.req.receivedAt).inSeconds}s ago',
                  style: const TextStyle(
                      color: AppColors.textMuted, fontSize: 11),
                ),
              ],
            ),
            const SizedBox(height: 12),
            const Text('Request from',
                style: TextStyle(color: AppColors.textDim, fontSize: 12)),
            Text(widget.req.origin ?? 'Unknown origin',
                style: const TextStyle(
                    fontWeight: FontWeight.w700, fontSize: 14)),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.bg,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.border),
              ),
              child: Text(
                const JsonEncoder.withIndent('  ').convert(widget.req.params),
                style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: AppColors.textDim,
                    height: 1.4),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _busy ? null : _reject,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.danger,
                      side: const BorderSide(color: AppColors.danger),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                    child: const Text('Reject',
                        style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: GradientButton(
                    label: 'Approve',
                    icon: Icons.check_rounded,
                    loading: _busy,
                    onPressed: _approve,
                    height: 48,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
