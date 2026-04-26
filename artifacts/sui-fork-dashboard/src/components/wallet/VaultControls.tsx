import { useState } from "react";
import { Lock, Unlock, ShieldAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  lockVault,
  unlockVault,
  destroyVault,
  vaultExists,
  vaultUnlocked,
  persistVaultUpdate,
  setupVault,
} from "@/lib/wallet-vault";
import {
  loadWallets,
  PLAINTEXT_WALLETS_KEY,
  type StoredWallet,
} from "@/lib/web-wallet";

interface Props {
  /** Re-read wallets after vault state changes. */
  onChange: () => void;
}

export function VaultControls({ onChange }: Props) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"none" | "lock" | "unlock" | "disable">(
    "none",
  );
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const close = () => {
    setMode("none");
    setPw("");
    setPw2("");
    setErr(null);
    setBusy(false);
  };

  const hasVault = vaultExists();
  const unlocked = vaultUnlocked();

  const onLock = async () => {
    setErr(null);
    if (pw.length < 8) {
      setErr("Password must be at least 8 characters");
      return;
    }
    if (pw !== pw2) {
      setErr("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      // Two paths share this dialog:
      //   1. Legacy users with plaintext wallets in localStorage — migrate
      //      them into a fresh vault via `lockVault`.
      //   2. Fresh users with no wallets yet — provision an empty vault via
      //      `setupVault` so subsequent Create / Import flows are encrypted
      //      from the very first key.
      const ws: StoredWallet[] = loadWallets();
      if (ws.length > 0) {
        await lockVault(ws, pw, PLAINTEXT_WALLETS_KEY);
        toast({
          title: "Wallets encrypted",
          description: "Your existing keys are now protected by a password.",
        });
      } else {
        await setupVault(pw, PLAINTEXT_WALLETS_KEY);
        toast({
          title: "Encryption enabled",
          description:
            "Any wallet you create or import will now be encrypted at rest.",
        });
      }
      onChange();
      close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const onUnlock = async () => {
    setErr(null);
    setBusy(true);
    try {
      await unlockVault(pw);
      toast({ title: "Wallet unlocked" });
      onChange();
      close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const onRekey = async () => {
    setErr(null);
    setBusy(true);
    try {
      await persistVaultUpdate(pw);
      toast({ title: "Vault updated" });
      onChange();
      close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const onDisable = async () => {
    setErr(null);
    setBusy(true);
    try {
      await destroyVault(pw, PLAINTEXT_WALLETS_KEY);
      toast({
        title: "Encryption disabled",
        description: "Wallets are back to plaintext local storage.",
      });
      onChange();
      close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  // Distinguish "legacy plaintext to migrate" from "fresh user, nothing on
  // disk yet". The former is an urgent at-rest exposure; the latter is an
  // informational nudge to set the encryption password before the first
  // wallet is created.
  const hasPlaintext = !hasVault && loadWallets().length > 0;

  return (
    <>
      {/* Status banner — legacy plaintext data on disk: urgent migration. */}
      {!hasVault && hasPlaintext && (
        <div
          className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 mb-3"
          data-testid="banner-wallet-unencrypted"
        >
          <ShieldAlert className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-amber-200">
              Your existing wallets are stored in plain text
            </div>
            <div className="text-xs text-amber-200/70 mt-0.5">
              Set a password now to migrate them into the encrypted vault.
              This wipes the plaintext copy from this browser.
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMode("lock")}
            className="shrink-0 border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
            data-testid="button-wallet-lock"
          >
            <Lock className="w-3.5 h-3.5 mr-1.5" /> Encrypt now
          </Button>
        </div>
      )}

      {/* Status banner — fresh user, no vault yet: passive nudge. */}
      {!hasVault && !hasPlaintext && (
        <div
          className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 mb-3"
          data-testid="banner-wallet-setup"
        >
          <Lock className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-emerald-200">
              Encryption is on by default
            </div>
            <div className="text-xs text-emerald-200/70 mt-0.5">
              You&apos;ll be prompted to set a password before your first
              wallet is created or imported. Set one now to skip the prompt
              later.
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMode("lock")}
            className="shrink-0 border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10"
            data-testid="button-wallet-setup"
          >
            <Lock className="w-3.5 h-3.5 mr-1.5" /> Set password
          </Button>
        </div>
      )}

      {hasVault && !unlocked && (
        <div
          className="flex items-start gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 mb-3"
          data-testid="banner-wallet-locked"
        >
          <Lock className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-emerald-200">
              Wallet is locked
            </div>
            <div className="text-xs text-emerald-200/70 mt-0.5">
              Enter your password to access your encrypted wallets.
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => setMode("unlock")}
            className="shrink-0 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold"
            data-testid="button-wallet-unlock"
          >
            <Unlock className="w-3.5 h-3.5 mr-1.5" /> Unlock
          </Button>
        </div>
      )}

      {hasVault && unlocked && (
        <div
          className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 mb-3"
          data-testid="banner-wallet-unlocked"
        >
          <Unlock className="w-5 h-5 text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0 text-sm text-emerald-200">
            Wallet vault is unlocked for this tab. New wallets are
            auto-encrypted and saved as you go.
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMode("lock")}
              data-testid="button-wallet-rekey"
            >
              <Lock className="w-3.5 h-3.5 mr-1.5" /> Change password
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMode("disable")}
              data-testid="button-wallet-disable-vault"
            >
              Disable
            </Button>
          </div>
        </div>
      )}

      {/* Lock / set-password / change-password dialog */}
      <Dialog
        open={mode === "lock"}
        onOpenChange={(o) => (!o ? close() : null)}
      >
        <DialogContent className="bg-zinc-950 border border-emerald-500/30">
          <DialogHeader>
            <DialogTitle>
              {hasVault && unlocked ? "Change password" : "Encrypt wallet"}
            </DialogTitle>
            <DialogDescription>
              Choose a password. We can&apos;t recover it for you — losing it
              means losing access to your keys.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="password"
              placeholder="Password (min 8 chars)"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              data-testid="input-vault-password"
            />
            <Input
              type="password"
              placeholder="Confirm password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              data-testid="input-vault-password-confirm"
            />
            {err && <div className="text-xs text-red-400">{err}</div>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={hasVault && unlocked ? onRekey : onLock}
              disabled={busy || !pw}
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold"
              data-testid="button-vault-confirm-lock"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : hasVault && unlocked ? (
                "Update password"
              ) : (
                "Encrypt"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlock dialog */}
      <Dialog
        open={mode === "unlock"}
        onOpenChange={(o) => (!o ? close() : null)}
      >
        <DialogContent className="bg-zinc-950 border border-emerald-500/30">
          <DialogHeader>
            <DialogTitle>Unlock wallet</DialogTitle>
            <DialogDescription>
              Enter the password you set when you encrypted this wallet.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            placeholder="Password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pw && !busy) onUnlock();
            }}
            data-testid="input-vault-unlock-password"
          />
          {err && <div className="text-xs text-red-400">{err}</div>}
          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={onUnlock}
              disabled={busy || !pw}
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold"
              data-testid="button-vault-confirm-unlock"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Unlock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable dialog */}
      <Dialog
        open={mode === "disable"}
        onOpenChange={(o) => (!o ? close() : null)}
      >
        <DialogContent className="bg-zinc-950 border border-red-500/30">
          <DialogHeader>
            <DialogTitle>Disable encryption</DialogTitle>
            <DialogDescription>
              Confirm with your password to switch the wallet back to
              unencrypted local storage. Not recommended.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            placeholder="Password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            data-testid="input-vault-disable-password"
          />
          {err && <div className="text-xs text-red-400">{err}</div>}
          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onDisable}
              disabled={busy || !pw}
              data-testid="button-vault-confirm-disable"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Disable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
