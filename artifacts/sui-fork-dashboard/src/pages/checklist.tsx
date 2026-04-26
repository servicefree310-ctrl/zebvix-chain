import React from "react";
import { useChecklist } from "@/hooks/useChecklist";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Info, RotateCcw, ListChecks, CheckCircle2, ListTodo, Activity, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card/60">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide mb-2">
        <Icon className="w-3.5 h-3.5" />
        <span>{label}</span>
      </div>
      <div className="text-2xl font-mono font-bold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </div>
  );
}

export default function Checklist() {
  const { items, toggleItem, progress, resetAll, categoriesOrdered } = useChecklist();

  // Group items by category, preserving the operator-defined order
  const itemsByCategory: Record<string, typeof items> = {};
  for (const item of items) {
    (itemsByCategory[item.category] ||= []).push(item);
  }
  
  const completedCount = items.filter(i => i.completed).length;
  const totalCount = items.length;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-primary border-primary/40">
            Operations
          </Badge>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">
            Sign-off
          </Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <ListChecks className="w-7 h-7 text-primary" />
          Launch Checklist
        </h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Operator sign-off list for bringing a fresh Zebvix L1 chain online. Items are ordered by execution sequence; categories 1 → 9 are concrete operations, category 10 is a mandatory trust-model acknowledgement. State is saved in your browser only.
        </p>

        <div className="border-l-4 border-l-emerald-500/50 bg-emerald-500/5 p-3 rounded-md flex gap-3 max-w-3xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="text-foreground font-semibold">Scope of this page</div>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>
                Use this <strong className="text-emerald-400">BEFORE</strong> touching production.
              </li>
              <li>
                For the live phase log, see the <strong className="text-emerald-400">Implementation Roadmap</strong>.
              </li>
              <li>
                References point at specific files in <code className="bg-muted px-1 rounded">zebvix-chain/src/</code> or RPC methods.
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          icon={ListTodo}
          label="Progress"
          value={`${progress}%`}
          sub="Overall completion"
        />
        <StatTile
          icon={CheckCircle2}
          label="Completed"
          value={`${completedCount}/${totalCount}`}
          sub="Checklist items"
        />
        <StatTile
          icon={Server}
          label="Categories"
          value={`${categoriesOrdered.length}`}
          sub="Phases"
        />
        <StatTile
          icon={Activity}
          label="Storage"
          value="Local"
          sub="Browser only"
        />
      </div>

      {/* Progress + reset */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex justify-between items-end">
            <div className="space-y-1">
              <CardTitle>Sign-off Progress</CardTitle>
              <CardDescription>Track your deployment readiness</CardDescription>
            </div>
            <button
              onClick={() => {
                if (window.confirm("Reset all checkboxes? This only clears local browser state, never touches the chain.")) {
                  resetAll();
                }
              }}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border hover:bg-muted/40 transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Reset all
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Categories */}
      <div className="space-y-6">
        {categoriesOrdered.map((cat) => {
          const catItems = itemsByCategory[cat.name] ?? [];
          if (catItems.length === 0) return null;
          const done = catItems.filter((i) => i.completed).length;
          const catProgress = Math.round((done / catItems.length) * 100);

          return (
            <Card key={cat.name}>
              <CardHeader className="pb-3 border-b border-border/40">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{cat.name}</CardTitle>
                  <Badge variant="outline" className={catProgress === 100 ? "text-emerald-400 border-emerald-500/40" : "text-muted-foreground"}>
                    {done}/{catItems.length} · {catProgress}%
                  </Badge>
                </div>
                <CardDescription>{cat.description}</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 space-y-2">
                {catItems.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-start space-x-3 p-3 rounded-md transition-colors ${
                      item.completed
                        ? "bg-primary/5 border border-primary/20"
                        : "bg-muted/30 border border-transparent hover:bg-muted/50"
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
                        <div className="text-[11px] font-mono text-muted-foreground/70 break-all bg-background/50 px-1.5 py-0.5 rounded w-fit mt-1">
                          {item.ref}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
