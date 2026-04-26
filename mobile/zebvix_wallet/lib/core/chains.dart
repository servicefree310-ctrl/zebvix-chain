import 'package:flutter/material.dart';

class ChainConfig {
  final String id;
  final String name;
  final String shortName;
  final int chainId;
  final String rpcUrl;
  final String explorerUrl;
  final String nativeSymbol;
  final int nativeDecimals;
  final Color primary;
  final Color secondary;
  final IconData icon;
  final String? wrappedToken;
  final String? bridgeContract;

  const ChainConfig({
    required this.id,
    required this.name,
    required this.shortName,
    required this.chainId,
    required this.rpcUrl,
    required this.explorerUrl,
    required this.nativeSymbol,
    required this.nativeDecimals,
    required this.primary,
    required this.secondary,
    required this.icon,
    this.wrappedToken,
    this.bridgeContract,
  });
}

class Chains {
  static const zebvix = ChainConfig(
    id: 'zebvix',
    name: 'Zebvix L1',
    shortName: 'Zebvix',
    chainId: 7878,
    rpcUrl: 'http://93.127.213.192:8545',
    explorerUrl: 'http://93.127.213.192:8545',
    nativeSymbol: 'ZBX',
    nativeDecimals: 18,
    primary: Color(0xFF10B981),
    secondary: Color(0xFF06B6D4),
    icon: Icons.bolt_rounded,
  );

  static const bsc = ChainConfig(
    id: 'bsc',
    name: 'BNB Smart Chain',
    shortName: 'BSC',
    chainId: 56,
    rpcUrl: 'https://bsc-dataseed.binance.org',
    explorerUrl: 'https://bscscan.com',
    nativeSymbol: 'BNB',
    nativeDecimals: 18,
    primary: Color(0xFFF59E0B),
    secondary: Color(0xFFFBBF24),
    icon: Icons.token_rounded,
    wrappedToken: '0xf7AA4bF26AfFC5e44dE1aa6ff6612C8dc09',
    bridgeContract: '0xa6dF16fdc1f2b8cAFf3ad8F2E1d671094F85',
  );

  static const ethereum = ChainConfig(
    id: 'ethereum',
    name: 'Ethereum',
    shortName: 'ETH',
    chainId: 1,
    rpcUrl: 'https://eth.llamarpc.com',
    explorerUrl: 'https://etherscan.io',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    primary: Color(0xFF6366F1),
    secondary: Color(0xFF818CF8),
    icon: Icons.diamond_rounded,
  );

  static const polygon = ChainConfig(
    id: 'polygon',
    name: 'Polygon',
    shortName: 'POL',
    chainId: 137,
    rpcUrl: 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
    nativeSymbol: 'POL',
    nativeDecimals: 18,
    primary: Color(0xFF8B5CF6),
    secondary: Color(0xFFA78BFA),
    icon: Icons.hexagon_rounded,
  );

  static const arbitrum = ChainConfig(
    id: 'arbitrum',
    name: 'Arbitrum One',
    shortName: 'ARB',
    chainId: 42161,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    explorerUrl: 'https://arbiscan.io',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    primary: Color(0xFF3B82F6),
    secondary: Color(0xFF60A5FA),
    icon: Icons.layers_rounded,
  );

  static const all = [zebvix, bsc, ethereum, polygon, arbitrum];

  static ChainConfig byId(String id) =>
      all.firstWhere((c) => c.id == id, orElse: () => zebvix);

  static ChainConfig byChainId(int chainId) =>
      all.firstWhere((c) => c.chainId == chainId, orElse: () => zebvix);
}
