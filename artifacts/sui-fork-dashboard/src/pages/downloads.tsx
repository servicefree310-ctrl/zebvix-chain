import { Download, FileArchive, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const files = [
  {
    key: "newchain",
    title: "Zebvix Chain v0.1 (Scratch — Recommended)",
    desc: "Brand new Rust L1 — scratch se likhi hui clean chain. EVM-style 20-byte addresses, RocksDB, JSON-RPC, halving tokenomics. Build + deploy in minutes.",
    size: "13 KB source",
    badge: "NEW · Production",
    badgeColor: "bg-purple-500/20 text-purple-300 border-purple-500/40",
    items: [
      "150M ZBX cap · 10M founder pre-mine · 140M block-mined",
      "Initial reward 3 ZBX/block · halving every 25M blocks (~3.96 yrs)",
      "Single-validator PoA (v0.1) · multi-validator BFT roadmap (v0.2)",
      "EVM smart contracts coming via revm in v0.2",
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
    badgeColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
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
    badgeColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
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

export default function Downloads() {
  return (
    <div className="space-y-8 p-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Downloads</h1>
        <p className="text-slate-400">
          Zebvix chain files — patches ya full source, apni zaroorat ke hisaab se download karo
        </p>
      </div>

      {/* Audit badge */}
      <Card className="bg-emerald-950/30 border-emerald-500/30">
        <CardContent className="flex items-center gap-3 pt-5">
          <CheckCircle2 className="text-emerald-400 h-5 w-5 shrink-0" />
          <div className="text-sm text-emerald-300">
            <span className="font-semibold">Chain 100% audited</span>
            <span className="text-emerald-400/70 ml-2">— 53/53 checks passed, zero bugs</span>
          </div>
        </CardContent>
      </Card>

      {/* File cards */}
      <div className="grid gap-6 md:grid-cols-2">
        {files.map((f) => (
          <Card key={f.key} className="bg-slate-900/60 border-slate-700/50 flex flex-col">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <FileArchive className="h-6 w-6 text-slate-400 shrink-0 mt-0.5" />
                  <div>
                    <CardTitle className="text-white text-lg">{f.title}</CardTitle>
                    <span className="text-xs font-mono text-slate-500">{f.size}</span>
                  </div>
                </div>
                <Badge className={`text-xs border ${f.badgeColor} shrink-0`}>{f.badge}</Badge>
              </div>
              <CardDescription className="text-slate-400 text-sm mt-1">
                {f.desc}
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-4 flex-1">
              <ul className="space-y-1">
                {f.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-400">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>

              <div className="mt-auto space-y-2">
                <Button
                  asChild
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  <a href={getDownloadUrl(f.apiKey)} download>
                    <Download className="h-4 w-4 mr-2" />
                    Download {f.title}
                  </a>
                </Button>
                <p className="text-[11px] text-slate-500 text-center">
                  Direct link: <code className="text-slate-400">/api/download/{f.apiKey}</code>
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* VPS instructions */}
      <Card className="bg-slate-900/60 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-white text-base">VPS pe extract kaise karo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="bg-slate-950 rounded-lg p-4 font-mono text-xs text-emerald-300 space-y-1">
              <div className="text-slate-500"># Full source download karke VPS pe deploy karo</div>
              <div>scp zebvix-full-source.zip root@srv1266996:~/</div>
              <div>ssh root@srv1266996</div>
              <div>cd ~</div>
              <div>unzip zebvix-full-source.zip</div>
              <div>cd zebvix-full-source/zebvix-scripts</div>
              <div>chmod +x *.sh && bash apply_all.sh</div>
            </div>
            <div className="flex items-start gap-2 text-xs text-amber-400/80">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                <strong>Note:</strong> Full source (87.5 MB) download slow ho sakti hai — browser mein directly click karo, download manager use mat karo.
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
