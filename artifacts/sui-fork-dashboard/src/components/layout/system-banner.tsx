import { AlertTriangle, Info, CheckCircle2, AlertOctagon } from "lucide-react";
import { useSystemConfig, type SystemConfig } from "@/lib/use-brand-config";

const STYLES: Record<
  SystemConfig["announcementLevel"],
  { wrap: string; icon: React.ReactNode; label: string }
> = {
  info: {
    wrap: "border-sky-500/40 bg-sky-500/10 text-sky-100",
    icon: <Info className="h-4 w-4 text-sky-300" aria-hidden="true" />,
    label: "Notice",
  },
  success: {
    wrap: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-hidden="true" />,
    label: "Update",
  },
  warn: {
    wrap: "border-amber-500/40 bg-amber-500/10 text-amber-100",
    icon: <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden="true" />,
    label: "Heads up",
  },
  critical: {
    wrap: "border-red-500/50 bg-red-500/15 text-red-100",
    icon: <AlertOctagon className="h-4 w-4 text-red-300" aria-hidden="true" />,
    label: "Critical",
  },
};

export function SystemBanner() {
  const sys = useSystemConfig();
  if (!sys.announcementEnabled) return null;
  const text = (sys.announcementText ?? "").trim();
  if (!text) return null;
  const style = STYLES[sys.announcementLevel] ?? STYLES.info;
  const url = (sys.announcementUrl ?? "").trim();
  const inner = (
    <div
      className={`flex items-center gap-2 px-4 py-2 border-b text-xs sm:text-sm ${style.wrap}`}
      role="status"
      aria-live="polite"
    >
      {style.icon}
      <span className="font-semibold uppercase tracking-wider text-[10px] opacity-80">
        {style.label}
      </span>
      <span className="truncate">{text}</span>
    </div>
  );
  if (url && /^https?:\/\//i.test(url)) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="block hover:brightness-110 transition"
        data-testid="system-announcement-link"
      >
        {inner}
      </a>
    );
  }
  return <div data-testid="system-announcement">{inner}</div>;
}
