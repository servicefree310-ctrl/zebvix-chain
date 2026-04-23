import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../theme.dart';
import '../state/app_state.dart';
import '../utils/format.dart';
import '../widgets/widgets.dart';

class SwapTab extends StatefulWidget {
  const SwapTab({super.key});
  @override
  State<SwapTab> createState() => _SwapTabState();
}

class _SwapTabState extends State<SwapTab> {
  bool zbxToZusd = true;
  final amountCtl = TextEditingController();
  bool busy = false;

  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    final b = st.balance;
    final amt = double.tryParse(amountCtl.text) ?? 0;
    final maxIn = zbxToZusd ? b.liquidZbx : b.zusd;
    final priceIn = 1.0;
    final out = amt * priceIn; // 1:1 placeholder until pool RPC is wired
    return Scaffold(
      appBar: AppBar(title: const Text('Swap')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const SectionHeader(title: 'BUY / SELL ZBX VIA ON-CHAIN AMM POOL'),
          GradientCard(
            child: Column(
              children: [
                _swapField(
                    label: 'You pay',
                    symbol: zbxToZusd ? 'ZBX' : 'zUSD',
                    color: zbxToZusd ? kZbxTeal : kZbxEmerald,
                    available: maxIn,
                    controller: amountCtl,
                    onMax: () {
                      amountCtl.text = maxIn.toStringAsFixed(4);
                      setState(() {});
                    }),
                const SizedBox(height: 8),
                Center(
                  child: InkWell(
                    onTap: () => setState(() => zbxToZusd = !zbxToZusd),
                    borderRadius: BorderRadius.circular(20),
                    child: Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                          color: kZbxSurface,
                          shape: BoxShape.circle,
                          border: Border.all(color: kZbxBorder)),
                      child: const Icon(Icons.swap_vert, color: kZbxTeal),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                _swapField(
                    label: 'You receive',
                    symbol: zbxToZusd ? 'zUSD' : 'ZBX',
                    color: zbxToZusd ? kZbxEmerald : kZbxTeal,
                    available: zbxToZusd ? b.zusd : b.liquidZbx,
                    readOnlyValue: out > 0 ? out.toStringAsFixed(4) : '—',
                    onMax: null),
              ],
            ),
          ),
          const SizedBox(height: 16),
          GradientCard(
            child: Column(
              children: [
                _kv('Rate', zbxToZusd ? '1 ZBX ≈ 1.00 zUSD' : '1 zUSD ≈ 1.00 ZBX'),
                _kv('Network fee', '0.002 ZBX (\$0.002)'),
                _kv('Pool', 'amm-zbx-zusd'),
                _kv('Slippage tolerance', '0.5%'),
              ],
            ),
          ),
          const SizedBox(height: 20),
          GradientButton(
            label: zbxToZusd ? 'Sell ZBX → zUSD' : 'Buy ZBX with zUSD',
            icon: Icons.swap_horizontal_circle_outlined,
            busy: busy,
            onPressed:
                (amt <= 0 || amt > maxIn) ? null : () => _confirmSwap(context, amt),
          ),
        ],
      ),
    );
  }

  Widget _swapField({
    required String label,
    required String symbol,
    required Color color,
    required double available,
    TextEditingController? controller,
    String? readOnlyValue,
    VoidCallback? onMax,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: kZbxBg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: kZbxBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Text(label,
                style: const TextStyle(color: kZbxMuted, fontSize: 11)),
            const Spacer(),
            Text('Available: ${fmtZbx(available)} $symbol',
                style: const TextStyle(color: kZbxMuted, fontSize: 11)),
          ]),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: controller != null
                    ? TextField(
                        controller: controller,
                        keyboardType:
                            const TextInputType.numberWithOptions(decimal: true),
                        style: const TextStyle(
                            fontSize: 26, fontWeight: FontWeight.w700),
                        decoration: const InputDecoration(
                          hintText: '0.0',
                          border: InputBorder.none,
                          enabledBorder: InputBorder.none,
                          focusedBorder: InputBorder.none,
                          fillColor: Colors.transparent,
                          contentPadding: EdgeInsets.zero,
                        ),
                        onChanged: (_) => setState(() {}),
                      )
                    : Text(readOnlyValue ?? '—',
                        style: const TextStyle(
                            fontSize: 26, fontWeight: FontWeight.w700)),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                    color: color.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: color.withOpacity(0.3))),
                child: Text(symbol,
                    style: TextStyle(
                        color: color, fontWeight: FontWeight.w700)),
              ),
              if (onMax != null) ...[
                const SizedBox(width: 6),
                TextButton(
                    onPressed: onMax,
                    style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 10)),
                    child: const Text('MAX')),
              ],
            ],
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
          Text(v, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
        ]),
      );

  Future<void> _confirmSwap(BuildContext context, double amount) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: kZbxSurface,
        title: Text(zbxToZusd ? 'Confirm sell' : 'Confirm buy'),
        content: Text('Submit ${fmtZbx(amount)} ${zbxToZusd ? "ZBX → zUSD" : "zUSD → ZBX"} swap?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          ElevatedButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Sign & broadcast')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => busy = true);
    try {
      final st = context.read<AppState>();
      final hash = zbxToZusd
          ? await st.swapZbxToZusd(amountZbx: amount)
          : await st.swapZusdToZbx(amountZusd: amount);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('submitted: $hash')));
      amountCtl.clear();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('error: $e')));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }
}
