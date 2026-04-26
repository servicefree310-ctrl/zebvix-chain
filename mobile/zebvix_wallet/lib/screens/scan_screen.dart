import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';
import '../session/session_relay.dart';
import '../theme.dart';
import '../widgets/glass_card.dart';

class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  MobileScannerController? _controller;
  bool _handled = false;
  final _manualCtrl = TextEditingController();
  bool _showManual = false;

  @override
  void initState() {
    super.initState();
    if (!kIsWeb) {
      _controller = MobileScannerController(
        formats: const [BarcodeFormat.qrCode],
      );
    } else {
      _showManual = true;
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    _manualCtrl.dispose();
    super.dispose();
  }

  Future<void> _connect(String uri) async {
    if (_handled) return;
    _handled = true;
    final relay = context.read<SessionRelay>();
    await relay.connect(uri);
    if (!mounted) return;
    if (relay.status == SessionStatus.connected) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Connected to ${relay.origin ?? "session"}')),
      );
      Navigator.of(context).pushNamed('/approve');
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(relay.error ?? 'Failed to connect')),
      );
      _handled = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final relay = context.watch<SessionRelay>();
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  const Text('Scan to connect',
                      style: TextStyle(
                          fontSize: 20, fontWeight: FontWeight.w800)),
                  const Spacer(),
                  if (relay.status == SessionStatus.connected)
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: AppColors.success.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(
                            color: AppColors.success.withOpacity(0.5)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                              width: 6,
                              height: 6,
                              decoration: const BoxDecoration(
                                  color: AppColors.success,
                                  shape: BoxShape.circle)),
                          const SizedBox(width: 6),
                          Text(
                              'Connected${relay.pending.isNotEmpty ? " · ${relay.pending.length} req" : ""}',
                              style: const TextStyle(
                                  color: AppColors.success,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700)),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            Expanded(
              child: _showManual || _controller == null
                  ? _buildManual()
                  : _buildScanner(),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  TextButton.icon(
                    onPressed: () =>
                        setState(() => _showManual = !_showManual),
                    icon: Icon(_showManual
                        ? Icons.qr_code_scanner_rounded
                        : Icons.keyboard_rounded),
                    label: Text(_showManual ? 'Use camera' : 'Paste URI'),
                  ),
                  if (relay.status == SessionStatus.connected)
                    TextButton.icon(
                      onPressed: () => relay.disconnect(),
                      icon: const Icon(Icons.link_off_rounded,
                          color: AppColors.danger),
                      label: const Text('Disconnect',
                          style: TextStyle(color: AppColors.danger)),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildScanner() {
    return Stack(
      children: [
        MobileScanner(
          controller: _controller!,
          onDetect: (capture) {
            for (final b in capture.barcodes) {
              final raw = b.rawValue;
              if (raw != null && raw.startsWith('zbx://')) {
                _connect(raw);
                return;
              }
            }
          },
        ),
        Center(
          child: Container(
            width: 240,
            height: 240,
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.accent, width: 3),
              borderRadius: BorderRadius.circular(20),
            ),
          ),
        ),
        Positioned(
          left: 24,
          right: 24,
          bottom: 32,
          child: GlassCard(
            color: Colors.black.withOpacity(0.7),
            child: const Text(
              'Open a Zebvix-enabled dashboard, click "Connect mobile", and scan the QR code that appears.',
              style: TextStyle(color: AppColors.text, fontSize: 13, height: 1.4),
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildManual() {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        children: [
          GlassCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Paste session URI',
                    style: TextStyle(color: AppColors.textDim, fontSize: 13)),
                const SizedBox(height: 8),
                TextField(
                  controller: _manualCtrl,
                  decoration: const InputDecoration(
                    hintText: 'zbx://wc?id=...&relay=wss://...',
                  ),
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                  minLines: 2,
                  maxLines: 4,
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: GradientButton(
                    label: 'Connect',
                    icon: Icons.link_rounded,
                    onPressed: () => _connect(_manualCtrl.text.trim()),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          if (kIsWeb)
            const GlassCard(
              child: Row(
                children: [
                  Icon(Icons.info_outline_rounded,
                      color: AppColors.textDim, size: 18),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Camera scanning is available on the native mobile build (Android/iOS). On web, paste the session URI manually.',
                      style: TextStyle(color: AppColors.textDim, fontSize: 12),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
