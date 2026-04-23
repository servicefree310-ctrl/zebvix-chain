import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'theme.dart';
import 'state/app_state.dart';
import 'screens/onboarding_screen.dart';
import 'screens/home_shell.dart';

void main() {
  runApp(const ZebvixWalletApp());
}

class ZebvixWalletApp extends StatelessWidget {
  const ZebvixWalletApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => AppState()..init(),
      child: MaterialApp(
        title: 'Zebvix Wallet',
        debugShowCheckedModeBanner: false,
        theme: buildZebvixTheme(),
        home: const _Root(),
      ),
    );
  }
}

class _Root extends StatelessWidget {
  const _Root();
  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    if (!st.bootstrapped) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (st.address == null) return const OnboardingScreen();
    return const HomeShell();
  }
}
