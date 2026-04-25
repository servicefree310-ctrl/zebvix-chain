import React from "react";
import { useChecklist } from "@/hooks/useChecklist";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Info, RotateCcw } from "lucide-react";

export default function Checklist() {
  const { items, toggleItem, progress, resetAll, categoriesOrdered } = useChecklist();

  // Group items by category, preserving the operator-defined order
  const itemsByCategory: Record<string, typeof items> = {};
  for (const item of items) {
    (itemsByCategory[item.category] ||= []).push(item);
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-3">
          Launch Checklist
        </h1>
        <p className="text-lg text-muted-foreground">
          Operator sign-off list for bringing a fresh Zebvix L1 chain online. Items are ordered by execution sequence; categories 1 → 9 are concrete operations, category 10 is a mandatory trust-model acknowledgement covering the documented limitations of the current code. State is saved in your browser only.
        </p>
      </div>

      {/* Scope clarifier */}
      <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 text-sm flex gap-3">
        <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-primary">Scope of this page</div>
          <div className="text-muted-foreground text-xs leading-relaxed">
            Use this BEFORE touching production. For the live phase log of what shipped vs what is pending, see the{" "}
            <strong className="text-foreground">Implementation Roadmap</strong>; for day-1 build steps see{" "}
            <strong className="text-foreground">Environment Setup</strong>. References under each item point at the
            specific file in <code className="text-xs bg-muted px-1 rounded">zebvix-chain/src/</code>, RPC method, or CLI
            command that the action touches.
          </div>
        </div>
      </div>

      {/* Progress + reset */}
      <div className="p-6 bg-card border border-border rounded-lg shadow-sm">
        <div className="flex justify-between items-end mb-4">
          <div>
            <h3 className="text-2xl font-bold text-primary">{progress}%</h3>
            <p className="text-sm text-muted-foreground">Overall sign-off</p>
          </div>
          <button
            onClick={() => {
              if (window.confirm("Reset all checkboxes? This only clears local browser state, never touches the chain.")) {
                resetAll();
              }
            }}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border hover:bg-muted/40 transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Reset all
          </button>
        </div>
        <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Categories */}
      <div className="space-y-8">
        {categoriesOrdered.map((cat) => {
          const catItems = itemsByCategory[cat.name] ?? [];
          if (catItems.length === 0) return null;
          const done = catItems.filter((i) => i.completed).length;
          const catProgress = Math.round((done / catItems.length) * 100);

          return (
            <div key={cat.name} className="space-y-3">
              <div className="border-b border-border pb-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">{cat.name}</h2>
                  <span className="text-xs font-mono text-muted-foreground">
                    {done}/{catItems.length} · {catProgress}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{cat.description}</p>
              </div>
              <div className="space-y-2">
                {catItems.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-start space-x-3 p-3 rounded-md transition-colors ${
                      item.completed
                        ? "bg-primary/5 border border-primary/20"
                        : "bg-card/30 border border-transparent hover:bg-card/80"
                    }`}
                  >
                    <Checkbox
                      id={item.id}
                      checked={item.completed}
                      onCheckedChange={() => toggleItem(item.id)}
                      className="mt-1"
                    />
                    <div className="grid gap-1 leading-snug min-w-0 flex-1">
                      <Label
                        htmlFor={item.id}
                        className={`text-sm cursor-pointer leading-relaxed ${
                          item.completed
                            ? "text-muted-foreground line-through"
                            : "text-foreground font-medium"
                        }`}
                      >
                        {item.text}
                      </Label>
                      {item.ref && (
                        <div className="text-[11px] font-mono text-muted-foreground/80 break-all">
                          {item.ref}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
