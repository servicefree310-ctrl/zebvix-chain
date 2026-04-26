import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Smartphone, Loader2, Check, X } from "lucide-react";
import { useWallet } from "@/contexts/wallet-context";
import { shortAddr } from "@/lib/zbx-rpc";

type Status = "idle" | "creating" | "waiting" | "connected" | "signing" | "done" | "error";

interface SessionInfo {
  id: string;
  uri: string;
  relayUrl: string;
  expiresAt: number;
}

interface MobileConnectModalProps {
  open: boolean;
  onClose: () => void;
  // Optional: a payload to request signing once mobile connects.
  // If omitted, the modal just establishes pairing.
  signRequest?: {
    chainId: number;
    method: "eth_sendTransaction" | "personal_sign" | "eth_signTypedData_v4";
    params: unknown[];
  };
  onSigned?: (result: { signature?: string; txHash?: string }) => void;
}

export function MobileConnectModal({
  open,
  onClose,
  signRequest,
  onSigned,
}: MobileConnectModalProps) {
  const { toast } = useToast();
  const { connectRemote } = useWallet();
  const [status, setStatus] = useState<Status>("idle");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mobileAddr, setMobileAddr] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const requestIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      // Clean up on close
      try {
        wsRef.current?.close();
      } catch {}
      wsRef.current = null;
      setSession(null);
      setStatus("idle");
      setErrorMsg(null);
      setMobileAddr(null);
      return;
    }

    let cancelled = false;
    setStatus("creating");

    (async () => {
      try {
        const res = await fetch("/api/wc/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ origin: window.location.origin }),
        });
        if (!res.ok) throw new Error("session create failed");
        const info = (await res.json()) as SessionInfo;
        if (cancelled) return;
        setSession(info);

        // Open dashboard-side WebSocket
        const wsUrl = `${info.relayUrl}?role=dashboard`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        setStatus("waiting");

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data as string);
            if (msg.type === "ready") return;
            // mobile announces with {type:'hello', role:'mobile', address:'0x..', label?:'..'}
            if (msg.type === "hello" && msg.role === "mobile") {
              // Strict validation: 0x-prefixed, exactly 40 hex chars after the prefix.
              const raw = typeof msg.address === "string" ? msg.address.trim() : "";
              const addr = /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw : null;
              if (!addr) {
                setErrorMsg("Invalid mobile address");
                setStatus("error");
                toast({
                  title: "Mobile pairing rejected",
                  description: "The mobile sent an invalid wallet address.",
                  variant: "destructive",
                });
                return;
              }
              if (addr) {
                setMobileAddr(addr);
                connectRemote({
                  address: addr,
                  label:
                    typeof msg.label === "string" && msg.label.trim()
                      ? msg.label
                      : "Mobile Wallet",
                  sessionId: info.id,
                  relayUrl: info.relayUrl,
                });
                toast({
                  title: "Mobile wallet connected",
                  description: shortAddr(addr),
                });
              }
              setStatus("connected");
              if (signRequest) {
                const id = crypto.randomUUID();
                requestIdRef.current = id;
                ws.send(
                  JSON.stringify({
                    type: "request",
                    id,
                    chainId: signRequest.chainId,
                    method: signRequest.method,
                    params: signRequest.params,
                  }),
                );
                setStatus("signing");
              } else if (addr) {
                // Pure pairing flow — auto-close after a short success view.
                setTimeout(() => {
                  setStatus("done");
                  setTimeout(() => onClose(), 1200);
                }, 600);
              }
              return;
            }
            if (msg.type === "response" && msg.id === requestIdRef.current) {
              if (msg.error) {
                setErrorMsg(String(msg.error));
                setStatus("error");
                toast({
                  title: "Mobile rejected",
                  description: String(msg.error),
                  variant: "destructive",
                });
              } else {
                const r = msg.result ?? {};
                setStatus("done");
                toast({ title: "Signed on mobile" });
                onSigned?.({
                  signature: r.signature,
                  txHash: r.txHash,
                });
              }
            }
          } catch {
            // ignore malformed message
          }
        };

        ws.onerror = () => {
          setErrorMsg("Relay error");
          setStatus("error");
        };
        ws.onclose = () => {
          if (status !== "done") {
            // soft close, do not error if user already finished
          }
        };
      } catch (err) {
        if (!cancelled) {
          setErrorMsg((err as Error).message);
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <Card className="w-full max-w-md p-6 bg-zinc-950 border border-emerald-500/20 relative">
        <button
          aria-label="Close"
          onClick={onClose}
          className="absolute right-4 top-4 text-zinc-400 hover:text-white"
          data-testid="mobile-connect-close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <Smartphone className="w-5 h-5 text-emerald-400" />
          <h2 className="text-lg font-semibold text-white">Connect Mobile Wallet</h2>
        </div>

        {status === "creating" && (
          <div className="flex items-center gap-2 text-zinc-400 py-12 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Creating session…
          </div>
        )}

        {(status === "waiting" || status === "connected" || status === "signing") &&
          session && (
            <div className="flex flex-col items-center gap-4">
              <div className="bg-white p-4 rounded-lg" data-testid="mobile-connect-qr">
                <QRCodeSVG value={session.uri} size={224} level="M" />
              </div>
              <div className="text-xs text-zinc-500 break-all px-2 text-center max-w-full">
                {session.uri}
              </div>
              <div className="flex items-center gap-2">
                {status === "waiting" && (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-300">
                    <Loader2 className="w-3 h-3 animate-spin mr-1" /> Waiting for mobile
                  </Badge>
                )}
                {status === "connected" && (
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
                    <Check className="w-3 h-3 mr-1" /> Mobile connected
                  </Badge>
                )}
                {status === "signing" && (
                  <Badge variant="outline" className="border-cyan-500/40 text-cyan-300">
                    <Loader2 className="w-3 h-3 animate-spin mr-1" /> Awaiting approval on mobile
                  </Badge>
                )}
              </div>
              <p className="text-xs text-zinc-400 text-center max-w-xs">
                Open the Scan tab in your Zebvix mobile wallet and scan this QR.
              </p>
            </div>
          )}

        {status === "done" && (
          <div className="flex flex-col items-center gap-3 py-10 text-emerald-300">
            <Check className="w-10 h-10" />
            <div className="font-medium">
              {signRequest ? "Signed on mobile" : "Mobile wallet connected"}
            </div>
            {mobileAddr && !signRequest && (
              <div className="font-mono text-xs text-zinc-300">
                {shortAddr(mobileAddr)}
              </div>
            )}
            <Button onClick={onClose} className="mt-2">Close</Button>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-3 py-8 text-red-300">
            <X className="w-10 h-10" />
            <div className="text-sm text-center">{errorMsg ?? "Something went wrong"}</div>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
