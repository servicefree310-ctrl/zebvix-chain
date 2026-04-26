import { useEffect, useState } from "react";
import { Plus, Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const STORAGE_KEY = "zbx-custom-tokens-v1";

const CHAINS = [
  { id: "zebvix", label: "Zebvix L1", color: "emerald" },
  { id: "bsc", label: "BSC", color: "amber" },
  { id: "ethereum", label: "Ethereum", color: "indigo" },
  { id: "polygon", label: "Polygon", color: "purple" },
  { id: "arbitrum", label: "Arbitrum", color: "sky" },
] as const;

type ChainId = (typeof CHAINS)[number]["id"];

export interface CustomToken {
  chain: ChainId;
  symbol: string;
  contract: string;
  decimals: number;
  name?: string;
  addedAt: number;
}

export function loadCustomTokens(chain?: ChainId): CustomToken[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as CustomToken[];
    return chain ? list.filter((t) => t.chain === chain) : list;
  } catch {
    return [];
  }
}

function saveCustomTokens(list: CustomToken[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

interface Props {
  open: boolean;
  onClose: () => void;
  defaultChain?: ChainId;
  onAdded?: (t: CustomToken) => void;
}

export function AddTokenDialog({
  open,
  onClose,
  defaultChain = "bsc",
  onAdded,
}: Props) {
  const { toast } = useToast();
  const [chain, setChain] = useState<ChainId>(defaultChain);
  const [input, setInput] = useState("");
  const [symbol, setSymbol] = useState("");
  const [contract, setContract] = useState("");
  const [decimals, setDecimals] = useState("18");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setChain(defaultChain);
      setInput("");
      setSymbol("");
      setContract("");
      setDecimals("18");
      setError(null);
    }
  }, [open, defaultChain]);

  if (!open) return null;

  const isZebvix = chain === "zebvix";

  const lookup = async () => {
    setError(null);
    setBusy(true);
    try {
      let url: string;
      if (isZebvix) {
        const sym = input.trim();
        if (!sym) throw new Error("Enter token symbol");
        url = `/api/tokens/zebvix/by-symbol/${encodeURIComponent(sym)}`;
      } else {
        const addr = input.trim();
        if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
          throw new Error("Enter a valid 0x… contract address");
        }
        url = `/api/tokens/lookup/${chain}/${addr}`;
      }
      const r = await fetch(url);
      if (r.status === 404) {
        throw new Error(
          isZebvix
            ? `Symbol '${input.toUpperCase()}' not registered on Zebvix yet.`
            : "No ERC20-like token found at that contract.",
        );
      }
      if (!r.ok) throw new Error(`Lookup failed (${r.status})`);
      const j = (await r.json()) as {
        symbol: string;
        contract?: string;
        decimals: number;
        name?: string;
      };
      setSymbol(j.symbol.toUpperCase());
      setContract(j.contract ?? "");
      setDecimals(String(j.decimals ?? 18));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    setError(null);
    const sym = symbol.trim().toUpperCase();
    const addr = contract.trim();
    const dec = Number(decimals);
    if (!sym || sym.length > 16) return setError("Invalid symbol");
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return setError("Invalid contract");
    if (!Number.isInteger(dec) || dec < 0 || dec > 36)
      return setError("Invalid decimals");

    const list = loadCustomTokens();
    if (chain === "zebvix") {
      const dup = list.find(
        (t) =>
          t.chain === "zebvix" &&
          t.symbol.toUpperCase() === sym &&
          t.contract.toLowerCase() !== addr.toLowerCase(),
      );
      if (dup) return setError(`Symbol '${sym}' already exists on Zebvix`);
    }
    const idx = list.findIndex(
      (t) => t.chain === chain && t.contract.toLowerCase() === addr.toLowerCase(),
    );
    const tok: CustomToken = {
      chain,
      symbol: sym,
      contract: addr,
      decimals: dec,
      addedAt: Date.now(),
    };
    if (idx >= 0) list[idx] = tok;
    else list.push(tok);
    saveCustomTokens(list);
    toast({ title: "Token added", description: `${sym} on ${chain}` });
    onAdded?.(tok);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <Card className="w-full max-w-md p-5 bg-zinc-950 border border-emerald-500/20 relative">
        <button
          aria-label="Close"
          onClick={onClose}
          className="absolute right-3 top-3 text-zinc-400 hover:text-white"
          data-testid="button-add-token-close"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 mb-3">
          <Plus className="w-5 h-5 text-emerald-400" />
          <h2 className="text-lg font-semibold text-white">Add Custom Token</h2>
        </div>

        <div className="text-xs text-zinc-400 mb-2">Chain</div>
        <div className="flex flex-wrap gap-2 mb-4">
          {CHAINS.map((c) => (
            <button
              key={c.id}
              onClick={() => setChain(c.id)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                chain === c.id
                  ? "bg-emerald-500/15 border-emerald-500/60 text-emerald-300"
                  : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white"
              }`}
              data-testid={`button-chain-${c.id}`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="text-xs text-zinc-400 mb-1">
          {isZebvix
            ? "Search by symbol — Zebvix has 1 symbol = 1 token"
            : "Paste contract address"}
        </div>
        <div className="flex gap-2 mb-2">
          <Input
            value={input}
            onChange={(e) =>
              setInput(isZebvix ? e.target.value.toUpperCase() : e.target.value)
            }
            placeholder={isZebvix ? "e.g. USDz" : "0x…"}
            spellCheck={false}
            data-testid="input-token-search"
          />
          <Button
            type="button"
            variant="outline"
            onClick={lookup}
            disabled={busy || !input.trim()}
            data-testid="button-token-lookup"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Lookup"}
          </Button>
        </div>

        {(symbol || contract) && (
          <div className="rounded-md border border-zinc-800 p-3 mb-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Symbol</span>
              <Badge variant="outline">{symbol || "—"}</Badge>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Contract</span>
              <span className="font-mono text-zinc-200">
                {contract
                  ? `${contract.slice(0, 8)}…${contract.slice(-6)}`
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Decimals</span>
              <span>{decimals}</span>
            </div>
          </div>
        )}

        <details className="mb-3">
          <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300">
            Or enter manually
          </summary>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="Symbol"
              data-testid="input-token-symbol"
            />
            <Input
              value={decimals}
              onChange={(e) => setDecimals(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="Decimals"
              data-testid="input-token-decimals"
            />
            <Input
              value={contract}
              onChange={(e) => setContract(e.target.value)}
              placeholder="0x…"
              className="col-span-2 font-mono"
              data-testid="input-token-contract"
            />
          </div>
        </details>

        {error && <div className="text-xs text-red-400 mb-2">{error}</div>}

        <Button
          type="button"
          className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-semibold"
          onClick={save}
          data-testid="button-token-save"
        >
          <Check className="w-4 h-4 mr-2" /> Save token
        </Button>
      </Card>
    </div>
  );
}
