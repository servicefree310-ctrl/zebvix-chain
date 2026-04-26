import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../session/session_relay.dart';
import '../theme.dart';
import 'bridge_screen.dart';
import 'scan_screen.dart';
import 'settings_screen.dart';
import 'wallet_screen.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _idx = 0;

  void _navTo(String tab) {
    setState(() {
      _idx = switch (tab) {
        'wallet' => 0,
        'bridge' => 1,
        'scan' => 2,
        'settings' => 3,
        _ => _idx,
      };
    });
  }

  @override
  Widget build(BuildContext context) {
    final relay = context.watch<SessionRelay>();
    final pages = [
      WalletScreen(onAction: (chainId, {bool send = false}) => _navTo(chainId)),
      const BridgeScreen(),
      const ScanScreen(),
      const SettingsScreen(),
    ];
    final titles = ['Wallet', 'Bridge', 'Scan', 'Settings'];
    return Scaffold(
      appBar: _idx == 2
          ? null
          : AppBar(
              title: Text(titles[_idx]),
              actions: [
                if (relay.status == SessionStatus.connected)
                  Padding(
                    padding: const EdgeInsets.only(right: 12),
                    child: IconButton(
                      icon: Stack(
                        clipBehavior: Clip.none,
                        children: [
                          const Icon(Icons.notifications_rounded,
                              color: AppColors.accent),
                          if (relay.pending.isNotEmpty)
                            Positioned(
                              right: -4,
                              top: -4,
                              child: Container(
                                padding: const EdgeInsets.all(4),
                                decoration: const BoxDecoration(
                                    color: AppColors.danger,
                                    shape: BoxShape.circle),
                                child: Text('${relay.pending.length}',
                                    style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 9,
                                        fontWeight: FontWeight.w700)),
                              ),
                            ),
                        ],
                      ),
                      onPressed: () =>
                          Navigator.of(context).pushNamed('/approve'),
                    ),
                  ),
              ],
            ),
      body: IndexedStack(index: _idx, children: pages),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _idx,
        onTap: (i) => setState(() => _idx = i),
        items: const [
          BottomNavigationBarItem(
              icon: Icon(Icons.account_balance_wallet_rounded),
              label: 'Wallet'),
          BottomNavigationBarItem(
              icon: Icon(Icons.swap_horiz_rounded), label: 'Bridge'),
          BottomNavigationBarItem(
              icon: Icon(Icons.qr_code_scanner_rounded), label: 'Scan'),
          BottomNavigationBarItem(
              icon: Icon(Icons.settings_rounded), label: 'Settings'),
        ],
      ),
    );
  }
}
