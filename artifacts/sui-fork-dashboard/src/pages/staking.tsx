import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TrendingUp,
  Users,
  Award,
  RefreshCw,
  Loader2,
  Coins,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  Wallet as WalletIcon,
} from "lucide-react";
import { useWallet } from "@/contexts/wallet-context";
import { useToast } from "@/hooks/use-toast";
import { rpc, weiHexToZbx, shortAddr } from "@/lib/zbx-rpc";
import {
  bpsToPct,
  getMyDelegations,
  getStakingOverview,
  sendClaimRewards,
  sendRedelegate,
  sendStake,
  sendUnstake,
  weiStrToZbx,
  type DelegationInfo,
  type StakingOverview,
  type StakingValidatorInfo,
} from "@/lib/staking";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ActionKind = "stake" | "unstake" | "redelegate" | "claim";

interface ActionTarget {
  kind: ActionKind;
  validator: StakingValidatorInfo;
  myShares?: bigint;
  myValueWei?: bigint;
}

const REFRESH_MS = 15_000;

export default function StakingPage() {
  const { active } = useWallet();
  const { toast } = useToast();

  const [overview, setOverview] = useState<StakingOverview | null>(null);
  const [myDelegs, setMyDelegs] = useState<DelegationInfo[]>([]);
  const [balanceZbx, setBalanceZbx] = useState<string>("—");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [action, setAction] = useState<ActionTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Race-safety: each refresh tags itself with a monotonically-increasing
  // epoch + the wallet address it was started for, and discards its result if
  // either has changed by the time it resolves. Prevents stale RPC responses
  // from overwriting newer wallet/state.
  const refreshEpoch = useRef(0);
  const refresh = useCallback(async () => {
    const myEpoch = ++refreshEpoch.current;
    const myAddress = active?.address ?? null;
    setRefreshing(true);
    try {
      const ov = await getStakingOverview();
      if (refreshEpoch.current !== myEpoch) return;
      setOverview(ov);
      if (myAddress) {
        const [delegResult, balResult] = await Promise.allSettled([
          getMyDelegations(myAddress),
          rpc<string>("zbx_getBalance", [myAddress]),
        ]);
        if (refreshEpoch.current !== myEpoch) return;
        if (active?.address !== myAddress) return; // wallet switched mid-flight
        if (delegResult.status === "fulfilled") {
          setMyDelegs(delegResult.value);
        } else {
          // Surface the error instead of silently showing "no delegations".
          setError(`Could not load your delegations: ${
            delegResult.reason instanceof Error
              ? delegResult.reason.message
              : String(delegResult.reason)
          }`);
        }
        setBalanceZbx(
          balResult.status === "fulfilled" ? weiHexToZbx(balResult.value) : "—",
        );
      } else {
        setMyDelegs([]);
        setBalanceZbx("—");
      }
      if (refreshEpoch.current === myEpoch) setError(null);
    } catch (e) {
      if (refreshEpoch.current !== myEpoch) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (refreshEpoch.current === myEpoch) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [active?.address]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Build a lookup so the validator table shows "your stake" inline.
  const myByValidator = useMemo(() => {
    const m = new Map<string, DelegationInfo>();
    for (const d of myDelegs) m.set(d.validator.toLowerCase(), d);
    return m;
  }, [myDelegs]);

  const totalMyStakeWei = useMemo(
    () =>
      myDelegs.reduce((acc, d) => acc + BigInt(d.value_wei || "0"), 0n),
    [myDelegs],
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mb-1">
            Staking Dashboard
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Bhai, delegate karo apna ZBX validators ko aur har epoch reward
            commission ke baad earn karo. Unbonding{" "}
            {overview?.unbonding_epochs ?? 7} epochs ka hota hai.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-primary/40 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      <NetworkStats overview={overview} loading={loading} />

      {!active ? (
        <NoWalletNotice />
      ) : (
        <MyStakeSummary
          address={active.address}
          balanceZbx={balanceZbx}
          totalStakeWei={totalMyStakeWei}
          delegationCount={myDelegs.length}
          canClaim={(overview?.validators?.length ?? 0) > 0}
          onClaimAny={() => {
            // Pick the user's first delegation if any, else the first active
            // validator. Either works — the chain releases drip+commission
            // for the signer regardless of which validator is referenced.
            const v =
              overview?.validators.find((vv) =>
                myDelegs.some((d) => d.validator.toLowerCase() === vv.address.toLowerCase()),
              ) ??
              overview?.validators.find((vv) => !vv.jailed) ??
              overview?.validators[0];
            if (v) setAction({ kind: "claim", validator: v });
          }}
        />
      )}

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-none" />
          <span>RPC error: {error}</span>
        </div>
      ) : null}

      <ValidatorTable
        overview={overview}
        myByValidator={myByValidator}
        loading={loading}
        canSign={!!active}
        onAction={(t) => setAction(t)}
      />

      {myDelegs.length > 0 && (
        <MyDelegationsList
          overview={overview}
          delegations={myDelegs}
          onAction={(t) => setAction(t)}
        />
      )}

      <ActionDialog
        target={action}
        onClose={() => setAction(null)}
        balanceZbx={balanceZbx}
        overview={overview}
        validators={overview?.validators ?? []}
        onSuccess={(msg) => {
          toast({ title: "Submitted", description: msg });
          setAction(null);
          // Mempool → block delay; refresh after a short pause.
          setTimeout(refresh, 1500);
          setTimeout(refresh, 5000);
        }}
        onError={(msg) =>
          toast({
            title: "Staking failed",
            description: msg,
            variant: "destructive",
          })
        }
      />
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function NetworkStats({
  overview,
  loading,
}: {
  overview: StakingOverview | null;
  loading: boolean;
}) {
  const totalStaked = useMemo(() => {
    if (!overview) return "—";
    const sum = overview.validators.reduce(
      (acc, v) => acc + BigInt(v.total_stake_wei || "0"),
      0n,
    );
    return weiStrToZbx(sum, 2);
  }, [overview]);

  const epochReward = overview ? weiStrToZbx(overview.epoch_reward_wei, 2) : "—";
  const minDelegation = overview ? weiStrToZbx(overview.min_delegation_wei, 0) : "—";

  const stats = [
    {
      icon: Users,
      label: "Active Validators",
      value: overview ? overview.active_set.length.toString() : "—",
      sub: `of ${overview?.validator_count ?? "—"} total`,
    },
    {
      icon: Coins,
      label: "Total Staked",
      value: `${totalStaked} ZBX`,
      sub: `${overview?.delegation_count ?? "—"} delegations`,
    },
    {
      icon: Award,
      label: "Epoch Reward",
      value: `${epochReward} ZBX`,
      sub: `every ${overview?.epoch_blocks ?? "—"} blocks`,
    },
    {
      icon: TrendingUp,
      label: "Min Delegation",
      value: `${minDelegation} ZBX`,
      sub: `unbonding ${overview?.unbonding_epochs ?? "—"} epochs`,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className="p-4 rounded-lg bg-card border border-border"
        >
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider mb-2">
            <s.icon className="h-3.5 w-3.5 text-primary" />
            {s.label}
          </div>
          <div className="text-xl font-bold text-foreground tabular-nums">
            {loading ? <span className="text-muted-foreground">…</span> : s.value}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{s.sub}</div>
        </div>
      ))}
    </div>
  );
}

function NoWalletNotice() {
  return (
    <div className="rounded-lg border border-border bg-card p-5 text-sm flex items-center gap-3">
      <WalletIcon className="h-5 w-5 text-primary" />
      <div>
        <div className="font-semibold">No wallet connected</div>
        <div className="text-muted-foreground text-xs mt-0.5">
          Bhai, top-right wallet picker se ek wallet add ya select karo to
          delegate / unstake / claim karne ke liye.
        </div>
      </div>
    </div>
  );
}

function MyStakeSummary({
  address,
  balanceZbx,
  totalStakeWei,
  delegationCount,
  canClaim,
  onClaimAny,
}: {
  address: string;
  balanceZbx: string;
  totalStakeWei: bigint;
  delegationCount: number;
  canClaim: boolean;
  onClaimAny: () => void;
}) {
  return (
    <div className="rounded-lg border border-primary/30 bg-gradient-to-br from-primary/5 to-transparent p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-widest text-primary/80">
            Your wallet
          </div>
          <div className="font-mono text-sm text-foreground mt-0.5 break-all">
            {address}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6 text-right">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">
              Balance
            </div>
            <div className="text-lg font-semibold tabular-nums">
              {balanceZbx} ZBX
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">
              Staked
            </div>
            <div className="text-lg font-semibold tabular-nums text-primary">
              {weiStrToZbx(totalStakeWei, 4)} ZBX
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">
              Delegations
            </div>
            <div className="text-lg font-semibold tabular-nums">
              {delegationCount}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!canClaim}
            onClick={onClaimAny}
            title={
              canClaim
                ? "Claim any unlocked staking rewards (drip + commission pool)"
                : "No validators available"
            }
          >
            <Award className="h-3.5 w-3.5 mr-1.5" />
            Claim Rewards
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">
        Locked-rewards drip releases ke baad har staker (delegator OR validator
        operator) wallet-level claim kar sakta hai — chahe currently delegation
        zero hi kyun na ho.
      </p>
    </div>
  );
}

function ValidatorTable({
  overview,
  myByValidator,
  loading,
  canSign,
  onAction,
}: {
  overview: StakingOverview | null;
  myByValidator: Map<string, DelegationInfo>;
  loading: boolean;
  canSign: boolean;
  onAction: (t: ActionTarget) => void;
}) {
  const sorted = useMemo(() => {
    if (!overview) return [];
    return [...overview.validators].sort(
      (a, b) =>
        Number(BigInt(b.total_stake_wei) > BigInt(a.total_stake_wei)) -
        Number(BigInt(b.total_stake_wei) < BigInt(a.total_stake_wei)),
    );
  }, [overview]);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="border-b border-border px-4 py-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Validators</h2>
        <span className="text-xs text-muted-foreground">
          {overview ? `${overview.validators.length} total` : ""}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Validator</th>
              <th className="text-right px-4 py-2 font-medium">Total Stake</th>
              <th className="text-right px-4 py-2 font-medium">Commission</th>
              <th className="text-right px-4 py-2 font-medium">Status</th>
              <th className="text-right px-4 py-2 font-medium">Your Stake</th>
              <th className="text-right px-4 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Loading validators…
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No validators registered yet.
                </td>
              </tr>
            ) : (
              sorted.map((v) => {
                const mine = myByValidator.get(v.address.toLowerCase());
                return (
                  <tr
                    key={v.address}
                    className="border-t border-border hover:bg-muted/20"
                  >
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs">
                        {shortAddr(v.address)}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                        op {shortAddr(v.operator)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {weiStrToZbx(v.total_stake_wei, 2)} ZBX
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {bpsToPct(v.commission_bps)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {v.jailed ? (
                        <span className="text-xs text-destructive font-semibold">
                          Jailed
                        </span>
                      ) : (
                        <span className="text-xs text-emerald-500">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {mine ? (
                        <span className="text-primary font-medium">
                          {weiStrToZbx(mine.value_wei, 4)} ZBX
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <Button
                          size="sm"
                          variant="default"
                          disabled={!canSign || v.jailed}
                          onClick={() =>
                            onAction({ kind: "stake", validator: v })
                          }
                        >
                          Stake
                        </Button>
                        {mine ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canSign}
                              onClick={() =>
                                onAction({
                                  kind: "unstake",
                                  validator: v,
                                  myShares: BigInt(mine.shares),
                                  myValueWei: BigInt(mine.value_wei),
                                })
                              }
                            >
                              Unstake
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!canSign}
                              onClick={() =>
                                onAction({ kind: "claim", validator: v })
                              }
                            >
                              Claim
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MyDelegationsList({
  overview,
  delegations,
  onAction,
}: {
  overview: StakingOverview | null;
  delegations: DelegationInfo[];
  onAction: (t: ActionTarget) => void;
}) {
  const validators = useMemo(() => {
    const m = new Map<string, StakingValidatorInfo>();
    for (const v of overview?.validators ?? []) {
      m.set(v.address.toLowerCase(), v);
    }
    return m;
  }, [overview]);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3 flex items-center gap-2">
        <Coins className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Your Delegations</h2>
      </div>
      <div className="divide-y divide-border">
        {delegations.map((d) => {
          const v = validators.get(d.validator.toLowerCase());
          if (!v) return null;
          return (
            <div
              key={d.validator}
              className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="font-mono text-xs">{shortAddr(v.address)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Commission {bpsToPct(v.commission_bps)} ·{" "}
                  {v.jailed ? (
                    <span className="text-destructive">jailed</span>
                  ) : (
                    "active"
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums text-primary">
                  {weiStrToZbx(d.value_wei, 4)} ZBX
                </div>
                <div className="text-[10px] text-muted-foreground tabular-nums">
                  {d.shares} shares
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onAction({
                      kind: "unstake",
                      validator: v,
                      myShares: BigInt(d.shares),
                      myValueWei: BigInt(d.value_wei),
                    })
                  }
                >
                  Unstake
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onAction({
                      kind: "redelegate",
                      validator: v,
                      myShares: BigInt(d.shares),
                      myValueWei: BigInt(d.value_wei),
                    })
                  }
                >
                  Redelegate
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onAction({ kind: "claim", validator: v })
                  }
                >
                  Claim
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Action dialog (stake / unstake / redelegate / claim) ────────────────────

function ActionDialog({
  target,
  onClose,
  balanceZbx,
  overview,
  validators,
  onSuccess,
  onError,
}: {
  target: ActionTarget | null;
  onClose: () => void;
  balanceZbx: string;
  overview: StakingOverview | null;
  validators: StakingValidatorInfo[];
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const { active } = useWallet();
  const [amount, setAmount] = useState("");
  const [percent, setPercent] = useState<number>(100);
  const [destValidator, setDestValidator] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset on open / target change.
  useEffect(() => {
    setAmount("");
    setPercent(100);
    setDestValidator("");
    setSubmitting(false);
  }, [target?.kind, target?.validator.address]);

  if (!target || !active) return null;

  const minDelegationZbx = overview
    ? weiStrToZbx(overview.min_delegation_wei, 0)
    : "10";

  const otherValidators = validators.filter(
    (v) =>
      !v.jailed &&
      v.address.toLowerCase() !== target.validator.address.toLowerCase(),
  );

  const titles: Record<ActionKind, string> = {
    stake: "Delegate to validator",
    unstake: "Unstake from validator",
    redelegate: "Redelegate to another validator",
    claim: "Claim staking rewards",
  };

  const submit = async () => {
    if (active.kind === "remote") {
      onError("Mobile wallet connected — staking actions must be approved on your phone. Disconnect from the topbar to stake with a stored key.");
      return;
    }
    setSubmitting(true);
    try {
      if (target.kind === "stake") {
        const a = Number(amount);
        if (!isFinite(a) || a <= 0) throw new Error("Enter a positive amount");
        const minZ = Number(minDelegationZbx.replace(/,/g, ""));
        if (a < minZ)
          throw new Error(`Minimum delegation is ${minDelegationZbx} ZBX`);
        const r = await sendStake({
          privateKeyHex: active.privateKey,
          validator: target.validator.address,
          amountZbx: amount,
        });
        onSuccess(`Stake submitted: ${a} ZBX → ${shortAddr(target.validator.address)} (tx ${r.hash || "pending"})`);
      } else if (target.kind === "unstake") {
        if (!target.myShares || target.myShares === 0n)
          throw new Error("No shares to unstake");
        const shares = (target.myShares * BigInt(percent)) / 100n;
        if (shares === 0n)
          throw new Error("Selected percentage rounds to zero shares");
        const r = await sendUnstake({
          privateKeyHex: active.privateKey,
          validator: target.validator.address,
          shares,
        });
        onSuccess(
          `Unstake queued (${percent}% · ${weiStrToZbx(
            (target.myValueWei ?? 0n) * BigInt(percent) / 100n,
            4,
          )} ZBX) · matures in ${overview?.unbonding_epochs ?? 7} epochs (tx ${r.hash || "pending"})`,
        );
      } else if (target.kind === "redelegate") {
        if (!target.myShares || target.myShares === 0n)
          throw new Error("No shares to redelegate");
        if (!destValidator) throw new Error("Pick a destination validator");
        const shares = (target.myShares * BigInt(percent)) / 100n;
        if (shares === 0n)
          throw new Error("Selected percentage rounds to zero shares");
        const r = await sendRedelegate({
          privateKeyHex: active.privateKey,
          fromValidator: target.validator.address,
          toValidator: destValidator,
          shares,
        });
        onSuccess(
          `Redelegated ${percent}% to ${shortAddr(destValidator)} (tx ${r.hash || "pending"})`,
        );
      } else if (target.kind === "claim") {
        const r = await sendClaimRewards({
          privateKeyHex: active.privateKey,
          validator: target.validator.address,
        });
        onSuccess(`Claim submitted (tx ${r.hash || "pending"})`);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titles[target.kind]}</DialogTitle>
          <DialogDescription className="break-all font-mono text-[11px]">
            {target.validator.address}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Row label="From" value={shortAddr(active.address)} mono />
          <Row label="Balance" value={`${balanceZbx} ZBX`} />
          <Row
            label="Commission"
            value={bpsToPct(target.validator.commission_bps)}
          />
          {target.myValueWei !== undefined && (
            <Row
              label="Your stake"
              value={`${weiStrToZbx(target.myValueWei, 4)} ZBX`}
            />
          )}

          {target.kind === "stake" && (
            <div className="space-y-1.5">
              <Label htmlFor="zbx-amount" className="text-xs">
                Amount (ZBX) — min {minDelegationZbx}
              </Label>
              <Input
                id="zbx-amount"
                type="number"
                inputMode="decimal"
                placeholder="100"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min={0}
                step="0.0001"
              />
            </div>
          )}

          {(target.kind === "unstake" || target.kind === "redelegate") && (
            <div className="space-y-1.5">
              <Label className="text-xs">Percent of your stake: {percent}%</Label>
              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={percent}
                onChange={(e) => setPercent(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <button
                  className="hover:text-primary"
                  onClick={() => setPercent(25)}
                >
                  25%
                </button>
                <button
                  className="hover:text-primary"
                  onClick={() => setPercent(50)}
                >
                  50%
                </button>
                <button
                  className="hover:text-primary"
                  onClick={() => setPercent(75)}
                >
                  75%
                </button>
                <button
                  className="hover:text-primary"
                  onClick={() => setPercent(100)}
                >
                  Max
                </button>
              </div>
              {target.myValueWei !== undefined && (
                <div className="text-xs text-muted-foreground tabular-nums">
                  ≈{" "}
                  {weiStrToZbx(
                    (target.myValueWei * BigInt(percent)) / 100n,
                    4,
                  )}{" "}
                  ZBX
                </div>
              )}
            </div>
          )}

          {target.kind === "redelegate" && (
            <div className="space-y-1.5">
              <Label htmlFor="dest-val" className="text-xs">
                Destination validator
              </Label>
              <select
                id="dest-val"
                value={destValidator}
                onChange={(e) => setDestValidator(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono"
              >
                <option value="">Select…</option>
                {otherValidators.map((v) => (
                  <option key={v.address} value={v.address}>
                    {shortAddr(v.address)} · {bpsToPct(v.commission_bps)} ·{" "}
                    {weiStrToZbx(v.total_stake_wei, 0)} ZBX staked
                  </option>
                ))}
              </select>
              {otherValidators.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  No other active validators available right now.
                </p>
              )}
            </div>
          )}

          {target.kind === "claim" && (
            <p className="text-xs text-muted-foreground">
              Yeh tx aapke locked-rewards drip + commission pool dono claim
              karega (jo bhi available hai).
            </p>
          )}

          {target.kind === "unstake" && (
            <p className="text-[11px] text-muted-foreground">
              Unstaked amount {overview?.unbonding_epochs ?? 7} epochs ke baad
              wallet mein wapis ayega.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Submitting…
              </>
            ) : (
              <>
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Confirm
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          mono
            ? "font-mono text-foreground"
            : "tabular-nums font-medium text-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}
