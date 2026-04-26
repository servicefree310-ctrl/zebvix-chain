import 'dart:async';
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'core/balance_service.dart';
import 'core/rpc_client.dart';
import 'core/token_store.dart';
import 'core/wallet_store.dart';
import 'screens/add_token_screen.dart';
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
        ChangeNotifierProvider(create: (_) => TokenStore()..load()),
        Provider(create: (_) => RpcRegistry(), dispose: (_, r) => r.disposeAll()),
        ChangeNotifierProxyProvider3<WalletStore, RpcRegistry, TokenStore,
            BalanceService>(
          create: (ctx) => BalanceService(
            ctx.read<RpcRegistry>(),
            ctx.read<WalletStore>(),
            ctx.read<TokenStore>(),
          ),
          update: (ctx, w, r, t, prev) => prev ?? BalanceService(r, w, t),
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
          '/add-token': (_) => const AddTokenScreen(),
        },
        home: const _Boot(),
      ),
    );
  }
}

class _Boot extends StatefulWidget {
  const _Boot();
  @override
  State<_Boot> createState() => _BootState();
}

class _BootState extends State<_Boot> {
  AppLinks? _appLinks;
  StreamSubscription<Uri>? _linkSub;

  @override
  void initState() {
    super.initState();
    _setupDeepLinks();
  }

  Future<void> _setupDeepLinks() async {
    try {
      _appLinks = AppLinks();
      final initial = await _appLinks!.getInitialLink();
      if (initial != null) _handleUri(initial);
      _linkSub = _appLinks!.uriLinkStream.listen(_handleUri, onError: (_) {});
    } catch (_) {
      // Web/desktop where app_links isn't supported — ignore.
    }
  }

  void _handleUri(Uri uri) {
    final scheme = uri.scheme.toLowerCase();
    if (scheme != 'zebvix' && scheme != 'zbx') return;
    if (uri.host != 'wc') return;
    final relay = context.read<SessionRelay>();
    relay.connect(uri.toString());
  }

  @override
  void dispose() {
    _linkSub?.cancel();
    super.dispose();
  }

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
