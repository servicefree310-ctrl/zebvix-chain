import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/balance_service.dart';
import 'core/rpc_client.dart';
import 'core/wallet_store.dart';
import 'screens/approve_screen.dart';
import 'screens/home_shell.dart';
import 'screens/onboarding_screen.dart';
import 'screens/receive_screen.dart';
import 'screens/send_screen.dart';
import 'session/session_relay.dart';
import 'theme.dart';

void main() {
  runApp(const ZebvixApp());
}

class ZebvixApp extends StatelessWidget {
  const ZebvixApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => WalletStore()..load()),
        Provider(create: (_) => RpcRegistry(), dispose: (_, r) => r.disposeAll()),
        ChangeNotifierProxyProvider2<WalletStore, RpcRegistry, BalanceService>(
          create: (ctx) => BalanceService(
            ctx.read<RpcRegistry>(),
            ctx.read<WalletStore>(),
          ),
          update: (ctx, w, r, prev) => prev ?? BalanceService(r, w),
        ),
        ChangeNotifierProvider(create: (_) => SessionRelay()),
      ],
      child: MaterialApp(
        title: 'Zebvix Wallet',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.dark(),
        routes: {
          '/send': (_) => const SendScreen(),
          '/receive': (_) => const ReceiveScreen(),
          '/approve': (_) => const ApproveScreen(),
        },
        home: const _Boot(),
      ),
    );
  }
}

class _Boot extends StatelessWidget {
  const _Boot();
  @override
  Widget build(BuildContext context) {
    final wallet = context.watch<WalletStore>();
    if (!wallet.initialized) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator(color: AppColors.accent)),
      );
    }
    if (!wallet.hasWallet) return const OnboardingScreen();
    return const HomeShell();
  }
}
