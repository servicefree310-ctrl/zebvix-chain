import 'package:flutter/material.dart';
import '../theme.dart';
import 'wallet_tab.dart';
import 'swap_tab.dart';
import 'history_screen.dart';
import 'multisig_tab.dart';
import 'connect_tab.dart';
import 'settings_screen.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int idx = 0;
  late final pages = const [
    WalletTab(),
    HistoryScreen(),
    SwapTab(),
    MultisigTab(),
    ConnectTab(),
    SettingsScreen(),
  ];
  static const items = [
    (Icons.account_balance_wallet, 'Wallet'),
    (Icons.receipt_long, 'History'),
    (Icons.swap_vert, 'Swap'),
    (Icons.shield_outlined, 'Multisig'),
    (Icons.qr_code_scanner, 'Connect'),
    (Icons.settings, 'Settings'),
  ];
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kZbxBg,
      extendBody: false,
      resizeToAvoidBottomInset: true,
      body: IndexedStack(index: idx, children: pages),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: kZbxAppBar,
          border: Border(top: BorderSide(color: kZbxBorder)),
          boxShadow: [
            BoxShadow(
                color: Colors.black54, blurRadius: 12, offset: Offset(0, -4)),
          ],
        ),
        child: SafeArea(
          top: false,
          minimum: const EdgeInsets.only(bottom: 4),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: List.generate(items.length, (i) {
                final active = i == idx;
                return Expanded(
                  child: InkWell(
                    borderRadius: BorderRadius.circular(12),
                    onTap: () => setState(() => idx = i),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      decoration: BoxDecoration(
                        color: active
                            ? kZbxTeal.withOpacity(0.10)
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(items[i].$1,
                              color: active ? kZbxTeal : kZbxMuted, size: 22),
                          const SizedBox(height: 4),
                          Text(items[i].$2,
                              style: TextStyle(
                                  color: active ? kZbxTeal : kZbxMuted,
                                  fontSize: 10,
                                  fontWeight: active
                                      ? FontWeight.w700
                                      : FontWeight.w500)),
                        ],
                      ),
                    ),
                  ),
                );
              }),
            ),
          ),
        ),
      ),
    );
  }
}
