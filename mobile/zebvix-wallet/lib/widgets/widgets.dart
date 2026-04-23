import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme.dart';

class GradientCard extends StatelessWidget {
  final Widget child;
  final List<Color> colors;
  final EdgeInsetsGeometry padding;
  const GradientCard({
    super.key,
    required this.child,
    this.colors = const [kZbxSurface, Color(0xFF101A2E)],
    this.padding = const EdgeInsets.all(16),
  });
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: colors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: kZbxBorder),
      ),
      child: child,
    );
  }
}

class StatChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color color;
  const StatChip({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    this.color = kZbxTeal,
  });
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 6),
          Text(label,
              style: const TextStyle(fontSize: 11, color: kZbxMuted)),
          const SizedBox(width: 6),
          Text(value,
              style: TextStyle(
                  fontSize: 12, color: color, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

class ActionTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;
  const ActionTile({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.color = kZbxTeal,
  });
  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            color: color.withOpacity(0.08),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: color.withOpacity(0.25)),
          ),
          child: Column(
            children: [
              Icon(icon, color: color, size: 22),
              const SizedBox(height: 6),
              Text(label,
                  style: const TextStyle(
                      fontSize: 12, fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      ),
    );
  }
}

class AddressPill extends StatelessWidget {
  final String address;
  final String? payIdName;
  const AddressPill({super.key, required this.address, this.payIdName});
  @override
  Widget build(BuildContext context) {
    final short =
        '${address.substring(0, 8)}…${address.substring(address.length - 6)}';
    return InkWell(
      onTap: () {
        Clipboard.setData(ClipboardData(text: address));
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('address copied'), duration: Duration(seconds: 1)));
      },
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: kZbxSurface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: kZbxBorder),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (payIdName != null) ...[
              Text('@$payIdName',
                  style: const TextStyle(
                      color: kZbxTeal,
                      fontSize: 12,
                      fontWeight: FontWeight.w600)),
              const SizedBox(width: 6),
              Container(
                  width: 1,
                  height: 12,
                  color: kZbxBorder.withOpacity(0.6)),
              const SizedBox(width: 6),
            ],
            Text(short,
                style: const TextStyle(
                    fontFamily: 'monospace', fontSize: 11, color: kZbxMuted)),
            const SizedBox(width: 4),
            const Icon(Icons.copy, size: 12, color: kZbxMuted),
          ],
        ),
      ),
    );
  }
}

class SectionHeader extends StatelessWidget {
  final String title;
  final Widget? trailing;
  const SectionHeader({super.key, required this.title, this.trailing});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 8, 4, 6),
      child: Row(
        children: [
          Text(title,
              style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.4)),
          const Spacer(),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

class GradientButton extends StatelessWidget {
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final List<Color> colors;
  final bool busy;
  const GradientButton({
    super.key,
    required this.label,
    this.icon,
    required this.onPressed,
    this.colors = const [kZbxTeal, kZbxCyan],
    this.busy = false,
  });
  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: onPressed == null ? 0.5 : 1,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: busy ? null : onPressed,
        child: Container(
          height: 52,
          padding: const EdgeInsets.symmetric(horizontal: 24),
          decoration: BoxDecoration(
            gradient: LinearGradient(colors: colors),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (busy)
                const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.black))
              else if (icon != null)
                Icon(icon, color: Colors.black, size: 18),
              if ((icon != null || busy) && label.isNotEmpty)
                const SizedBox(width: 8),
              Text(label,
                  style: const TextStyle(
                      color: Colors.black,
                      fontWeight: FontWeight.w700,
                      fontSize: 15)),
            ],
          ),
        ),
      ),
    );
  }
}
