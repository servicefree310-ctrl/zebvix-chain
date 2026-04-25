import React from "react";

interface LivePulseProps {
  size?: number;
  color?: string;
  className?: string;
}

/** Tiny pulsing dot — used inside "Live" / connected badges. */
export function LivePulse({
  size = 6,
  color = "bg-emerald-400",
  className = "",
}: LivePulseProps) {
  return (
    <span className={`relative inline-flex ${className}`} style={{ width: size, height: size }}>
      <span
        className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-60`}
      />
      <span
        className={`relative inline-flex h-full w-full rounded-full ${color}`}
      />
    </span>
  );
}
