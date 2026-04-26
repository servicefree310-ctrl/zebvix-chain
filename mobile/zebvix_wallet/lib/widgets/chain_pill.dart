import 'package:flutter/material.dart';
import '../core/chains.dart';
import '../theme.dart';

class ChainPill extends StatelessWidget {
  final ChainConfig chain;
  final bool selected;
  final VoidCallback? onTap;
  final bool dense;

  const ChainPill({
    super.key,
    required this.chain,
    this.selected = false,
    this.onTap,
    this.dense = false,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: EdgeInsets.symmetric(
            horizontal: dense ? 10 : 14,
            vertical: dense ? 6 : 9,
          ),
          decoration: BoxDecoration(
            color: selected ? chain.primary.withOpacity(0.18) : AppColors.surface2,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: selected ? chain.primary : AppColors.border,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: dense ? 18 : 22,
                height: dense ? 18 : 22,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(
                    colors: [chain.primary, chain.secondary],
                  ),
                ),
                child: Icon(chain.icon,
                    size: dense ? 11 : 13, color: Colors.black),
              ),
              SizedBox(width: dense ? 6 : 8),
              Text(
                chain.shortName,
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: dense ? 12 : 13.5,
                  color: selected ? chain.primary : AppColors.text,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class StatusDot extends StatelessWidget {
  final Color color;
  final String label;
  final String value;
  const StatusDot({
    super.key,
    required this.color,
    required this.label,
    required this.value,
  });
  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text('$label ', style: const TextStyle(color: AppColors.textDim, fontSize: 12)),
        Text(value,
            style: const TextStyle(
                color: AppColors.text, fontSize: 12, fontWeight: FontWeight.w600)),
      ],
    );
  }
}
