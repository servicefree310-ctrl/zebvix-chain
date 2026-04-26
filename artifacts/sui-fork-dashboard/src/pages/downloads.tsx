import React from "react";
import { Download, FileArchive, CheckCircle2, AlertCircle, Cpu, Shield, Layers, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/ui/code-block";

const files = [
  {
    key: "newchain",
    title: "Zebvix Chain v0.1 (Scratch — Recommended)",
    desc: "Brand new Rust L1 — scratch se likhi hui clean chain. ZVM-style 20-byte addresses, RocksDB, JSON-RPC, halving tokenomics. Build + deploy in minutes.",
    size: "13 KB source",
    badge: "NEW · Production",
    badgeColor: "text-violet-400 border-violet-500/40",
    items: [
      "150M ZBX cap · 10M founder pre-mine · 140M block-mined",
      "Initial reward 3 ZBX/block · halving every 25M blocks (~3.96 yrs)",
      "Single-validator PoA (v0.1) · multi-validator BFT roadmap (v0.2)",
      "ZVM smart contracts coming via revm in v0.2",
      "Chain ID 7878 · 5s block time · Ed25519 signatures",
      "8 Rust files · 1027 lines · builds in ~3 min on VPS",
    ],
    apiKey: "newchain",
  },
  {
    key: "patches",
    title: "Zebvix Sui-Fork Patches (Legacy)",
    desc: "Sirf patch files — Move contracts, shell scripts, genesis config. Existing Sui codebase pe apply karo.",
    size: "27 KB",
    badge: "Legacy",
    badgeColor: "text-blue-400 border-blue-500/40",
    items: [
      "staking_pool.move (node bond + 5 bug fixes)",
      "zbx_token.move, pay_id.move, master_pool.move, sub_pool.move, founder_admin.move",
      "step1–6 shell scripts (Node.js, no python3)",
      "genesis_template.yaml, fullnode.yaml, validator.yaml",
    ],
    apiKey: "patches",
  },
  {
    key: "fullsource",
    title: "Zebvix Full Sui-Fork Source (Legacy)",
    desc: "Complete patched Sui source code — VPS pe directly deploy kar sakte ho.",
    size: "87.5 MB",
    badge: "Legacy · Full Deploy",
    badgeColor: "text-amber-400 border-amber-500/40",
    items: [
      "Sui codebase + all Zebvix Move packages",
      "zebvix-scripts/ (apply_all.sh, step1–6)",
      "Node bond 100 ZBX, gas BPS 2200+3000+2000+1800+1000",
      "53/53 audit checks passed — zero bugs",
    ],
    apiKey: "fullsource",
  },
];

function getDownloadUrl(key: string) {
  const base = window.location.origin;
  return `${base}/api/download/${key}`;
}

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

export default function Downloads() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Hero */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-primary border-primary/40">
            Releases
          </Badge>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">
            LIVE
          </Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Download className="w-7 h-7 text-primary" />
          Downloads
        </h1>
        <p className="text-lg text-muted-foreground max-w-3xl">
          Zebvix chain files — patches ya full source, apni zaroorat ke hisaab se download karo.
        </p>

        <div className="border-l-4 border-l-emerald-500/50 bg-emerald-500/5 p-3 rounded-md flex gap-3 max-w-3xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="text-foreground font-semibold">Chain 100% audited</div>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>
                <strong className="text-emerald-400">53/53</strong> checks passed
              </li>
              <li>
                <strong className="text-emerald-400">Zero bugs</strong> found
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          icon={Layers}
          label="Releases"
          value="3"
          sub="Active packages"
        />
        <StatTile
          icon={Cpu}
          label="ZVM Fork"
          value="v0.1"
          sub="Latest Version"
        />
        <StatTile
          icon={Shield}
          label="Audits"
          value="53/53"
          sub="Checks Passed"
        />
        <StatTile
          icon={Hash}
          label="Network"
          value="7878"
          sub="Chain ID"
        />
      </div>

      {/* File cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {files.map((f) => (
          <Card key={f.key} className="flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileArchive className="h-5 w-5 text-primary shrink-0" />
                  <CardTitle className="text-base leading-tight">{f.title}</CardTitle>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Badge variant="outline" className={f.badgeColor}>{f.badge}</Badge>
                <span className="text-xs font-mono text-muted-foreground">{f.size}</span>
              </div>
              <CardDescription className="text-xs mt-2 text-foreground/80">
                {f.desc}
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-4 flex-1">
              <ul className="space-y-1.5 flex-1">
                {f.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>

              <div className="mt-auto pt-4 border-t border-border/40 space-y-3">
                <Button
                  asChild
                  className="w-full"
                >
                  <a href={getDownloadUrl(f.apiKey)} download>
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </a>
                </Button>
                <p className="text-[10px] text-muted-foreground text-center font-mono">
                  GET /api/download/{f.apiKey}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* VPS instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="w-5 h-5 text-primary" />
            VPS Deploy Instructions
          </CardTitle>
          <CardDescription>
            How to extract and run on your VPS.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CodeBlock
            language="bash"
            code={`# Full source download karke VPS pe deploy karo
scp zebvix-full-source.zip root@srv1266996:~/
ssh root@srv1266996
cd ~
unzip zebvix-full-source.zip
cd zebvix-full-source/zebvix-scripts
chmod +x *.sh && bash apply_all.sh`}
          />
          <div className="border-l-4 border-l-amber-500/50 bg-amber-500/5 p-3 rounded-md flex gap-3 text-xs">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-muted-foreground">
              <strong className="text-foreground">Note:</strong> Full source (87.5 MB) download slow ho sakti hai — browser mein directly click karo, download manager use mat karo.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
