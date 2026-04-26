import { useEffect, useState } from "react";
import { Smartphone, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { MobileConnectModal } from "./MobileConnectModal";

interface SessionInfo {
  id: string;
  uri: string;
  relayUrl: string;
  expiresAt: number;
}

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}

interface Props {
  variant?: "default" | "outline" | "secondary";
  className?: string;
  label?: string;
}

/**
 * Smart "Open Mobile Wallet" button:
 *   • On mobile device → creates a session and opens the deep-link
 *     `zebvix://wc?id=…&relay=…&origin=…` so the installed wallet handles it.
 *   • On desktop → falls back to QR-code modal.
 */
export function MobileConnectButton({
  variant = "outline",
  className,
  label = "Mobile Wallet",
}: Props) {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);

  const handleClick = async () => {
    if (!isMobile) {
      setShowModal(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/wc/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ origin: window.location.origin }),
      });
      if (!res.ok) throw new Error(`session create failed (${res.status})`);
      const info = (await res.json()) as SessionInfo;
      const params = new URLSearchParams({
        id: info.id,
        relay: info.relayUrl.replace(/\/[^/]+$/, ""),
        origin: window.location.origin,
      });
      const deepLink = `zebvix://wc?${params.toString()}`;
      // Use a temporary anchor click — works inside iframe sandboxes that
      // block programmatic location.href to custom schemes.
      try {
        const a = document.createElement("a");
        a.href = deepLink;
        a.rel = "noopener";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch {
        try {
          window.location.assign(deepLink);
        } catch {
          // last-resort no-op
        }
      }
      // After a short timeout, if no scheme handler caught it, fall back to QR.
      setTimeout(() => setShowModal(true), 1500);
    } catch (err) {
      toast({
        title: "Could not open mobile wallet",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      setShowModal(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={variant}
        className={className}
        onClick={handleClick}
        disabled={busy}
        data-testid="button-mobile-connect"
      >
        {busy ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Smartphone className="w-4 h-4 mr-2" />
        )}
        {label}
        {isMobile ? (
          <ExternalLink className="w-3.5 h-3.5 ml-2 opacity-70" />
        ) : null}
      </Button>
      <MobileConnectModal open={showModal} onClose={() => setShowModal(false)} />
    </>
  );
}
