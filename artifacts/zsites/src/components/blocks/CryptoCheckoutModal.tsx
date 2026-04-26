import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, ShieldCheck, Loader2, CheckCircle2 } from "lucide-react";
import { useRecordSitePayment } from "@workspace/api-client-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: number;
  productName: string;
  description: string;
  asset: string;
  amount: string;
  recipientAddress: string;
  chainId: number;
}

export function CryptoCheckoutModal({
  open,
  onOpenChange,
  siteId,
  productName,
  description,
  asset,
  amount,
  recipientAddress,
  chainId,
}: Props) {
  const [step, setStep] = useState<"send" | "verify" | "done">("send");
  const [txHash, setTxHash] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const recordPayment = useRecordSitePayment();

  function copyText(text: string) {
    void navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  }

  async function submit() {
    if (!txHash.trim() || !fromAddress.trim()) {
      toast.error("Add your wallet and tx hash to confirm.");
      return;
    }
    try {
      await recordPayment.mutateAsync({
        siteId,
        data: {
          txHash: txHash.trim(),
          fromAddress: fromAddress.trim(),
          toAddress: recipientAddress,
          asset,
          amount,
          chainId,
        },
      });
      setStep("done");
      toast.success("Payment recorded");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Verification failed";
      toast.error(msg);
    }
  }

  function reset() {
    setStep("send");
    setTxHash("");
    setFromAddress("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            {productName}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {step === "send" && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Send exactly
              </div>
              <div className="text-3xl font-bold">
                {amount} {asset.toUpperCase()}
              </div>
              <div className="text-xs text-muted-foreground">
                On Zebvix L1 (chain id {chainId})
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                To address
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
                  {recipientAddress || "(owner has not set wallet)"}
                </code>
                {recipientAddress ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyText(recipientAddress)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                ) : null}
              </div>
            </div>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li>1. Open your Zebvix wallet.</li>
              <li>
                2. Send {amount} {asset.toUpperCase()} to the address above.
              </li>
              <li>3. Copy the transaction hash and paste it below.</li>
            </ol>
            <Button
              className="w-full"
              onClick={() => setStep("verify")}
              disabled={!recipientAddress}
            >
              I sent it — paste tx hash
            </Button>
          </div>
        )}

        {step === "verify" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">
                Your wallet address
              </label>
              <Input
                value={fromAddress}
                onChange={(e) => setFromAddress(e.target.value)}
                placeholder="0x..."
                spellCheck={false}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">
                Transaction hash
              </label>
              <Input
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                placeholder="0x..."
                spellCheck={false}
              />
            </div>
            <Button
              className="w-full"
              onClick={submit}
              disabled={recordPayment.isPending}
            >
              {recordPayment.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Verify on chain
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setStep("send")}
            >
              Back
            </Button>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4 py-4 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
            <div className="text-lg font-semibold">Payment recorded</div>
            <p className="text-sm text-muted-foreground">
              Thanks. You'll receive a confirmation once the transaction
              settles on Zebvix L1.
            </p>
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
