import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../theme.dart';
import '../state/app_state.dart';
import '../utils/format.dart';

class HistoryScreen extends StatelessWidget {
  const HistoryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    final list = st.txHistory;
    return Scaffold(
      backgroundColor: kZbxBg,
      appBar: AppBar(
        backgroundColor: kZbxAppBar,
        title: const Text('Transactions'),
        actions: [
          IconButton(
            tooltip: 'Refresh balance',
            icon: const Icon(Icons.refresh),
            onPressed: () => st.refresh(),
          ),
          PopupMenuButton<String>(
            onSelected: (v) async {
              if (v == 'clear') {
                final ok = await showDialog<bool>(
                  context: context,
                  builder: (_) => AlertDialog(
                    backgroundColor: kZbxSurface,
                    title: const Text('Clear history?'),
                    content: const Text(
                        'On-device record will be deleted. The chain itself is unaffected.'),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(context, false),
                          child: const Text('Cancel')),
                      ElevatedButton(
                          onPressed: () => Navigator.pop(context, true),
                          child: const Text('Clear')),
                    ],
                  ),
                );
                if (ok == true) await st.clearHistory();
              }
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'clear', child: Text('Clear history')),
            ],
          ),
        ],
      ),
      body: list.isEmpty
          ? const _EmptyState()
          : ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: list.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) => _TxTile(rec: list[i]),
            ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();
  @override
  Widget build(BuildContext context) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: const [
            Icon(Icons.receipt_long, size: 56, color: kZbxMuted),
            SizedBox(height: 12),
            Text('No transactions yet',
                style: TextStyle(color: kZbxMuted, fontSize: 14)),
            SizedBox(height: 4),
            Text('Sends will appear here automatically.',
                style: TextStyle(color: kZbxMuted, fontSize: 11)),
          ],
        ),
      );
}

class _TxTile extends StatelessWidget {
  final TxRecord rec;
  const _TxTile({required this.rec});

  Color get _color {
    switch (rec.status) {
      case TxStatus.success: return const Color(0xFF22C55E);
      case TxStatus.failed:  return kZbxRed;
      case TxStatus.invalid: return const Color(0xFFEAB308);
      case TxStatus.pending: return const Color(0xFF60A5FA);
    }
  }

  IconData get _icon {
    switch (rec.status) {
      case TxStatus.success: return Icons.check_circle;
      case TxStatus.failed:  return Icons.cancel;
      case TxStatus.invalid: return Icons.report_problem;
      case TxStatus.pending: return Icons.schedule;
    }
  }

  String get _label {
    switch (rec.status) {
      case TxStatus.success: return 'SUCCESS';
      case TxStatus.failed:  return 'FAILED';
      case TxStatus.invalid: return 'INVALID';
      case TxStatus.pending: return 'PENDING';
    }
  }

  @override
  Widget build(BuildContext context) {
    final dt = DateTime.fromMillisecondsSinceEpoch(rec.timestampMs).toLocal();
    final ts =
        '${dt.year}-${_p(dt.month)}-${_p(dt.day)} ${_p(dt.hour)}:${_p(dt.minute)}';
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: () => _showDetails(context),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: kZbxSurface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: kZbxBorder),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(_icon, color: _color, size: 28),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Text(rec.kind.toUpperCase(),
                        style: const TextStyle(
                            color: kZbxMuted,
                            fontSize: 10,
                            letterSpacing: 0.6,
                            fontWeight: FontWeight.w700)),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: _color.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(_label,
                          style: TextStyle(
                              color: _color,
                              fontSize: 9,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.6)),
                    ),
                    const Spacer(),
                    Text(ts,
                        style:
                            const TextStyle(color: kZbxMuted, fontSize: 10)),
                  ]),
                  const SizedBox(height: 6),
                  Text('-${fmtZbx(rec.amountZbx)} ZBX',
                      style: const TextStyle(
                          fontSize: 16, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text('to ${shortAddr(rec.to)}',
                      style: const TextStyle(
                          color: kZbxMuted,
                          fontSize: 11,
                          fontFamily: 'monospace')),
                  if (rec.error != null) ...[
                    const SizedBox(height: 4),
                    Text(rec.error!,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: _color, fontSize: 11)),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _p(int n) => n.toString().padLeft(2, '0');

  void _showDetails(BuildContext context) {
    final dt = DateTime.fromMillisecondsSinceEpoch(rec.timestampMs).toLocal();
    showModalBottomSheet(
      context: context,
      backgroundColor: kZbxSurface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (_) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Icon(_icon, color: _color),
                const SizedBox(width: 8),
                Text(_label,
                    style: TextStyle(
                        color: _color,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.8)),
                const Spacer(),
                Text(rec.kind.toUpperCase(),
                    style: const TextStyle(
                        color: kZbxMuted,
                        fontSize: 11,
                        fontWeight: FontWeight.w700)),
              ]),
              const Divider(height: 24, color: kZbxBorder),
              _row('Time', dt.toString()),
              _row('Amount', '${fmtZbx(rec.amountZbx)} ZBX'),
              _row('Fee', '${fmtZbx(rec.feeZbx)} ZBX'),
              _copyRow(context, 'From', rec.from),
              _copyRow(context, 'To', rec.to),
              if (rec.hash != null && rec.hash!.isNotEmpty)
                _copyRow(context, 'Hash', rec.hash!),
              if (rec.error != null) ...[
                const SizedBox(height: 8),
                const Text('Error',
                    style: TextStyle(color: kZbxMuted, fontSize: 11)),
                const SizedBox(height: 4),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: kZbxBg,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: kZbxBorder),
                  ),
                  child: Text(rec.error!,
                      style: TextStyle(
                          color: _color,
                          fontSize: 12,
                          fontFamily: 'monospace')),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _row(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [
          SizedBox(
              width: 70,
              child: Text(k,
                  style: const TextStyle(color: kZbxMuted, fontSize: 12))),
          Expanded(
            child: Text(v,
                style: const TextStyle(
                    fontSize: 12, fontWeight: FontWeight.w600)),
          ),
        ]),
      );

  Widget _copyRow(BuildContext context, String k, String v) => InkWell(
        onTap: () {
          Clipboard.setData(ClipboardData(text: v));
          ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('$k copied'), duration: const Duration(seconds: 1)));
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(children: [
            SizedBox(
                width: 70,
                child: Text(k,
                    style: const TextStyle(color: kZbxMuted, fontSize: 12))),
            Expanded(
              child: Text(v,
                  style: const TextStyle(
                      fontSize: 11,
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w600)),
            ),
            const Icon(Icons.copy, size: 14, color: kZbxMuted),
          ]),
        ),
      );
}
