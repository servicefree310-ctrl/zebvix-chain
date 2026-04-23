String shortAddr(String? addr, {int head = 6, int tail = 4}) {
  if (addr == null || addr.isEmpty) return '—';
  if (addr.length <= head + tail + 2) return addr;
  return '${addr.substring(0, head + 2)}…${addr.substring(addr.length - tail)}';
}

double weiHexToZbx(String hex) {
  if (hex.isEmpty) return 0;
  var s = hex.startsWith('0x') ? hex.substring(2) : hex;
  if (s.isEmpty) return 0;
  final big = BigInt.parse(s, radix: 16);
  return big.toDouble() / 1e18;
}

BigInt zbxToWei(double zbx) {
  // multiply by 1e18 with safety for fractional input
  final asString = (zbx * 1e18).toStringAsFixed(0);
  return BigInt.parse(asString);
}

String fmtZbx(double v, {int frac = 4}) {
  if (v.abs() < 0.0001 && v != 0) return v.toStringAsExponential(2);
  return v.toStringAsFixed(frac);
}

String fmtUsd(double v) => '\$${v.toStringAsFixed(2)}';

String age(int ms) {
  final s = ((DateTime.now().millisecondsSinceEpoch - ms) / 1000).floor();
  if (s < 60) return '${s}s';
  if (s < 3600) return '${(s / 60).floor()}m';
  if (s < 86400) return '${(s / 3600).floor()}h';
  return '${(s / 86400).floor()}d';
}
