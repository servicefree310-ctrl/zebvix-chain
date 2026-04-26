import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import '../core/chains.dart';
import '../core/token_store.dart';
import '../theme.dart';
import '../widgets/glass_card.dart';

class AddTokenScreen extends StatefulWidget {
  final String? initialChainId;
  const AddTokenScreen({super.key, this.initialChainId});

  @override
  State<AddTokenScreen> createState() => _AddTokenScreenState();
}

class _AddTokenScreenState extends State<AddTokenScreen> {
  late ChainConfig _chain;
  final _inputCtrl = TextEditingController();
  final _symbolCtrl = TextEditingController();
  final _decimalsCtrl = TextEditingController(text: '18');
  final _contractCtrl = TextEditingController();
  bool _looking = false;
  String? _error;
  String? _info;

  @override
  void initState() {
    super.initState();
    _chain = widget.initialChainId != null
        ? Chains.byId(widget.initialChainId!)
        : Chains.zebvix;
  }

  @override
  void dispose() {
    _inputCtrl.dispose();
    _symbolCtrl.dispose();
    _decimalsCtrl.dispose();
    _contractCtrl.dispose();
    super.dispose();
  }

  bool get _isZebvix => _chain.id == 'zebvix';

  Future<void> _lookup() async {
    setState(() {
      _error = null;
      _info = null;
      _looking = true;
    });
    try {
      if (_isZebvix) {
        final sym = _inputCtrl.text.trim();
        if (sym.isEmpty) throw Exception('Enter token symbol');
        final r = await http.get(
          Uri.parse('/api/tokens/zebvix/by-symbol/$sym').replace(),
        );
        if (r.statusCode == 404) {
          throw Exception(
              "Symbol '${sym.toUpperCase()}' not registered on Zebvix yet.");
        }
        if (r.statusCode != 200) throw Exception('Lookup failed (${r.statusCode})');
        final j = jsonDecode(r.body) as Map<String, dynamic>;
        _symbolCtrl.text = (j['symbol'] as String).toUpperCase();
        _contractCtrl.text = j['contract'] as String;
        _decimalsCtrl.text = (j['decimals'] as int).toString();
        _info = "Found '${j['symbol']}' on Zebvix.";
      } else {
        final addr = _inputCtrl.text.trim();
        if (!RegExp(r'^0x[0-9a-fA-F]{40}$').hasMatch(addr)) {
          throw Exception('Enter a valid 0x… contract address');
        }
        final r = await http.get(
          Uri.parse('/api/tokens/lookup/${_chain.id}/$addr'),
        );
        if (r.statusCode != 200) {
          throw Exception('Lookup failed (${r.statusCode})');
        }
        final j = jsonDecode(r.body) as Map<String, dynamic>;
        _symbolCtrl.text = (j['symbol'] as String).toUpperCase();
        _contractCtrl.text = j['contract'] as String;
        _decimalsCtrl.text = (j['decimals'] as int).toString();
        _info = "Found '${j['symbol']}' on ${_chain.shortName}.";
      }
    } catch (e) {
      _error = e.toString().replaceFirst('Exception: ', '');
    } finally {
      if (mounted) setState(() => _looking = false);
    }
  }

  Future<void> _save() async {
    setState(() {
      _error = null;
    });
    final symbol = _symbolCtrl.text.trim().toUpperCase();
    final contract = _contractCtrl.text.trim();
    final decimals = int.tryParse(_decimalsCtrl.text.trim()) ?? -1;
    if (symbol.isEmpty || symbol.length > 16) {
      setState(() => _error = 'Invalid symbol');
      return;
    }
    if (!RegExp(r'^0x[0-9a-fA-F]{40}$').hasMatch(contract)) {
      setState(() => _error = 'Invalid contract');
      return;
    }
    if (decimals < 0 || decimals > 36) {
      setState(() => _error = 'Invalid decimals');
      return;
    }
    final store = context.read<TokenStore>();
    final err = await store.add(CustomToken(
      chainId: _chain.id,
      symbol: symbol,
      contract: contract,
      decimals: decimals,
    ));
    if (err != null) {
      setState(() => _error = err);
      return;
    }
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Added $symbol on ${_chain.shortName}')),
      );
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Add Token')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          GlassCard(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Chain', style: TextStyle(color: AppColors.textDim, fontSize: 12)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: Chains.all.map((c) {
                    final selected = c.id == _chain.id;
                    return InkWell(
                      onTap: () {
                        setState(() {
                          _chain = c;
                          _inputCtrl.clear();
                          _symbolCtrl.clear();
                          _contractCtrl.clear();
                          _decimalsCtrl.text = '18';
                          _error = null;
                          _info = null;
                        });
                      },
                      borderRadius: BorderRadius.circular(999),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: selected ? c.primary.withOpacity(0.18) : AppColors.surface2,
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(
                            color: selected ? c.primary : Colors.white12,
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(c.icon, size: 14, color: c.primary),
                            const SizedBox(width: 6),
                            Text(c.shortName,
                                style: TextStyle(
                                  color: selected ? c.primary : AppColors.text,
                                  fontWeight: FontWeight.w600,
                                  fontSize: 12,
                                )),
                          ],
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          GlassCard(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _isZebvix
                      ? 'Search by symbol  (Zebvix: 1 symbol = 1 token)'
                      : 'Paste contract address',
                  style: const TextStyle(color: AppColors.textDim, fontSize: 12),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _inputCtrl,
                        decoration: InputDecoration(
                          hintText: _isZebvix ? 'e.g. ZBX, USDz' : '0x…',
                          border: const OutlineInputBorder(),
                        ),
                        textCapitalization: _isZebvix
                            ? TextCapitalization.characters
                            : TextCapitalization.none,
                        autocorrect: false,
                      ),
                    ),
                    const SizedBox(width: 8),
                    if (!_isZebvix)
                      IconButton(
                        icon: const Icon(Icons.paste_rounded),
                        onPressed: () async {
                          final cd = await Clipboard.getData('text/plain');
                          if (cd?.text != null) _inputCtrl.text = cd!.text!.trim();
                        },
                      ),
                    FilledButton(
                      onPressed: _looking ? null : _lookup,
                      child: _looking
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Lookup'),
                    ),
                  ],
                ),
                if (_info != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(_info!,
                        style: const TextStyle(color: AppColors.accent, fontSize: 12)),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          GlassCard(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                _field('Symbol', _symbolCtrl, hint: 'USDT'),
                const SizedBox(height: 10),
                _field('Contract address', _contractCtrl, hint: '0x…'),
                const SizedBox(height: 10),
                _field('Decimals', _decimalsCtrl, hint: '18',
                    keyboardType: TextInputType.number),
              ],
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(_error!, style: const TextStyle(color: AppColors.danger)),
            ),
          const SizedBox(height: 18),
          FilledButton.icon(
            onPressed: _save,
            icon: const Icon(Icons.check_rounded),
            label: const Text('Save token'),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
          ),
        ],
      ),
    );
  }

  Widget _field(String label, TextEditingController c,
      {String? hint, TextInputType? keyboardType}) {
    return TextField(
      controller: c,
      keyboardType: keyboardType,
      autocorrect: false,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        border: const OutlineInputBorder(),
      ),
    );
  }
}
