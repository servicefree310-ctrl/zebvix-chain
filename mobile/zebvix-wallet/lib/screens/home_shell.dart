import 'package:flutter/material.dart';
import '../theme.dart';
import 'wallet_tab.dart';
import 'swap_tab.dart';
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
    SwapTab(),
    MultisigTab(),
    ConnectTab(),
    SettingsScreen(),
  ];
  static const items = [
    (Icons.account_balance_wallet, 'Wallet'),
    (Icons.swap_vert, 'Swap'),
    (Icons.shield_outlined, 'Multisig'),
    (Icons.qr_code_scanner, 'Connect'),
    (Icons.settings, 'Settings'),
  ];
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: idx, children: pages),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: kZbxBg,
          border: Border(top: BorderSide(color: kZbxBorder)),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: List.generate(items.length, (i) {
                final active = i == idx;
                return Expanded(
                  child: InkWell(
                    borderRadius: BorderRadius.circular(12),
                    onTap: () => setState(() => idx = i),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Column(
                        children: [
                          Icon(items[i].$1,
                              color: active ? kZbxTeal : kZbxMuted, size: 22),
                          const SizedBox(height: 2),
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
