import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FolderOpen,
  Folder,
  FileCode2,
  FileText,
  FileJson,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
  Copy,
  Check,
  Download,
  Compass,
  Wrench,
  Package,
  Search as SearchIcon,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

// ─────────────────────────────────────────────────────────────────────────────
// Service / Source Code Browser — categorized view of the dashboard's own
// source files (artifacts/sui-fork-dashboard/src). Backed by /api/dashboard/*.
//
// The page is split into three logical buckets so the user can grab "just the
// explorer code" or "just the wallet/services code" for a VPS deploy without
// hand-picking individual files. Categorization happens server-side in
// dashboard-code.ts via EXPLORE_PAGES / SERVICE_PAGES sets — keep both lists
// in sync if a new page belongs to either bucket.
// ─────────────────────────────────────────────────────────────────────────────

interface FileEntry {
  name: string;
  path: string;
  size: number;
  lines: number;
}

interface CategoryGroup {
  key: "explore" | "services" | "extra";
  label: string;
  description: string;
  files: FileEntry[];
}

interface TreeResp {
  categories: CategoryGroup[];
  stats: {
    files: number;
    lines: number;
    size: number;
    explore: number;
    services: number;
    extra: number;
  };
}

interface FileResp {
  path: string;
  size: number;
  lines: number;
  content: string;
}

const CATEGORY_META: Record<
  CategoryGroup["key"],
  { icon: typeof Compass; tone: string; toneBorder: string; toneBg: string; toneText: string }
> = {
  explore: {
    icon: Compass,
    tone: "emerald",
    toneBorder: "border-emerald-500/40",
    toneBg: "bg-emerald-500/10",
    toneText: "text-emerald-300",
  },
  services: {
    icon: Wrench,
    tone: "cyan",
    toneBorder: "border-cyan-500/40",
    toneBg: "bg-cyan-500/10",
    toneText: "text-cyan-300",
  },
  extra: {
    icon: Package,
    tone: "violet",
    toneBorder: "border-violet-500/40",
    toneBg: "bg-violet-500/10",
    toneText: "text-violet-300",
  },
};

function fileIcon(name: string) {
  if (name.endsWith(".tsx") || name.endsWith(".ts"))
    return <FileCode2 className="h-3.5 w-3.5 text-blue-400" />;
  if (name.endsWith(".json"))
    return <FileJson className="h-3.5 w-3.5 text-amber-400" />;
  if (name.endsWith(".css"))
    return <FileCode2 className="h-3.5 w-3.5 text-pink-400" />;
  if (name.endsWith(".md"))
    return <FileText className="h-3.5 w-3.5 text-emerald-400" />;
  return <FileText className="h-3.5 w-3.5 text-slate-500" />;
}

function CategorySection({
  cat,
  open,
  onToggle,
  selected,
  onSelect,
  filter,
}: {
  cat: CategoryGroup;
  open: boolean;
  onToggle: () => void;
  selected: string | null;
  onSelect: (p: string) => void;
  filter: string;
}) {
  const meta = CATEGORY_META[cat.key];
  const Icon = meta.icon;
  const f = filter.trim().toLowerCase();
  const filtered = f
    ? cat.files.filter((file) => file.path.toLowerCase().includes(f))
    : cat.files;
  const totalLines = filtered.reduce((s, x) => s + x.lines, 0);

  return (
    <div className={`rounded-lg border ${meta.toneBorder} ${meta.toneBg} overflow-hidden`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 hover-elevate text-left"
        data-testid={`cat-toggle-${cat.key}`}
        aria-label={`${open ? "Collapse" : "Expand"} ${cat.label} category (${cat.files.length} files)`}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className={`h-3.5 w-3.5 ${meta.toneText}`} />
        ) : (
          <ChevronRight className={`h-3.5 w-3.5 ${meta.toneText}`} />
        )}
        <Icon className={`h-4 w-4 ${meta.toneText}`} />
        <span className={`text-xs font-bold uppercase tracking-wide ${meta.toneText}`}>
          {cat.label}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto font-mono">
          {filtered.length} / {cat.files.length} files · {totalLines.toLocaleString()} lines
        </span>
      </button>
      {open && (
        <div className="px-2 pb-2">
          <p className="text-[10px] text-muted-foreground px-2 pb-2 leading-snug">
            {cat.description}
          </p>
          {filtered.length === 0 ? (
            <div className="text-[11px] text-muted-foreground px-2 py-2">
              No files match the filter.
            </div>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((file) => {
                const isSel = selected === file.path;
                return (
                  <li key={file.path}>
                    <button
                      onClick={() => onSelect(file.path)}
                      className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left text-[11px] hover-elevate ${
                        isSel
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "text-slate-300"
                      }`}
                      data-testid={`file-${file.path}`}
                      title={file.path}
                      aria-label={`Open ${file.path} (${file.lines} lines)`}
                      aria-pressed={isSel}
                    >
                      {fileIcon(file.name)}
                      <span className="font-mono truncate flex-1">{file.path}</span>
                      <span className="text-[9px] text-muted-foreground font-mono">
                        {file.lines}L
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CodeView({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <pre className="text-[11px] font-mono leading-relaxed">
      <code>
        {lines.map((line, i) => (
          <div key={i} className="flex">
            <span className="text-slate-600 select-none w-12 pr-3 text-right shrink-0">
              {i + 1}
            </span>
            <span className="text-slate-300 whitespace-pre">{line || " "}</span>
          </div>
        ))}
      </code>
    </pre>
  );
}

export default function ServiceCode() {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({
    explore: true,
    services: true,
    extra: false,
  });
  const [copied, setCopied] = useState(false);

  const { data: tree, isLoading: treeLoading, error: treeError } = useQuery<TreeResp>({
    queryKey: ["dashboard-tree"],
    queryFn: async () => {
      const r = await fetch("/api/dashboard/tree");
      if (!r.ok) throw new Error("Failed to load tree");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const { data: file, isLoading: fileLoading } = useQuery<FileResp>({
    queryKey: ["dashboard-file", selected],
    queryFn: async () => {
      const r = await fetch(
        `/api/dashboard/file?path=${encodeURIComponent(selected!)}`,
      );
      if (!r.ok) throw new Error("Failed to load file");
      return r.json();
    },
    enabled: !!selected,
  });

  // Auto-select the first file of the first non-empty category once the tree
  // loads — keeps the right pane from showing "Select a file" forever on a
  // page that has obvious defaults to display.
  useEffect(() => {
    if (!selected && tree?.categories) {
      for (const cat of tree.categories) {
        if (cat.files.length > 0) {
          setSelected(cat.files[0]!.path);
          break;
        }
      }
    }
  }, [tree, selected]);

  // Reset the "Copied!" badge a moment after the click so repeated copies
  // continue to give visual feedback.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const onCopy = async () => {
    if (!file) return;
    try {
      await navigator.clipboard.writeText(file.content);
      setCopied(true);
    } catch {
      // ignore — clipboard API may be unavailable in non-secure contexts
    }
  };

  const onDownload = () => {
    if (!file) return;
    const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const filename = file.path.split("/").pop() || "file.txt";
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const fileCountByCat = useMemo(() => {
    if (!tree) return null;
    return tree.categories.reduce<Record<string, number>>((acc, c) => {
      acc[c.key] = c.files.length;
      return acc;
    }, {});
  }, [tree]);

  return (
    <div className="space-y-6 p-2">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Service & Page Source Code</h1>
        <p className="text-slate-400 text-sm">
          Dashboard ka pura source code — 3 categories mein bata hua. Har file ko copy ya download karke
          apne VPS pe alag-alag deploy kar sakte ho.
        </p>
      </div>

      {tree && (
        <div className="flex flex-wrap gap-2">
          <Badge className="bg-slate-700/40 text-slate-200 border-slate-600/40 border">
            {tree.stats.files} files
          </Badge>
          <Badge className="bg-blue-500/15 text-blue-300 border-blue-500/30 border">
            {tree.stats.lines.toLocaleString()} lines
          </Badge>
          <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 border">
            Explore · {fileCountByCat?.["explore"] ?? 0}
          </Badge>
          <Badge className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30 border">
            Services · {fileCountByCat?.["services"] ?? 0}
          </Badge>
          <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/30 border">
            Extra · {fileCountByCat?.["extra"] ?? 0}
          </Badge>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] gap-4">
        {/* Categorized tree */}
        <Card className="bg-slate-900/60 border-slate-700/50 h-[75vh]">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-slate-400" />
              Categories
            </CardTitle>
            <div className="relative mt-2">
              <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter files (e.g. wallet, swap, payid)…"
                className="w-full pl-7 pr-7 py-1.5 text-xs rounded bg-slate-950/80 border border-slate-700 focus:border-emerald-500/50 outline-none text-slate-200"
                data-testid="input-file-filter"
              />
              {filter && (
                <button
                  onClick={() => setFilter("")}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-700/40 rounded"
                  aria-label="Clear filter"
                >
                  <X className="h-3 w-3 text-slate-400" />
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            <ScrollArea className="h-[58vh] pr-2">
              {treeLoading && (
                <div className="flex items-center gap-2 text-slate-400 text-xs px-2 py-3">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </div>
              )}
              {treeError && (
                <div className="flex items-start gap-2 text-red-400 text-xs px-2 py-3">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>API server reachable nahi hai (or this build is production-locked).</span>
                </div>
              )}
              {tree && (
                <div className="space-y-2">
                  {tree.categories.map((cat) => (
                    <CategorySection
                      key={cat.key}
                      cat={cat}
                      open={!!openCats[cat.key]}
                      onToggle={() =>
                        setOpenCats((p) => ({ ...p, [cat.key]: !p[cat.key] }))
                      }
                      selected={selected}
                      onSelect={setSelected}
                      filter={filter}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Code viewer */}
        <Card className="bg-slate-950 border-slate-700/50 h-[75vh] flex flex-col">
          <CardHeader className="pb-2 pt-4 border-b border-slate-800">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-sm font-mono text-emerald-400 truncate flex items-center gap-2 min-w-0">
                <Folder className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="truncate">{selected || "Select a file"}</span>
              </CardTitle>
              <div className="flex items-center gap-1.5 shrink-0">
                {file && (
                  <span className="text-[10px] text-slate-500 font-mono mr-1">
                    {file.lines} lines · {(file.size / 1024).toFixed(1)} KB
                  </span>
                )}
                <button
                  onClick={onCopy}
                  disabled={!file}
                  className="px-2 py-1 rounded text-[11px] border border-border hover:bg-muted/30 inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                  data-testid="btn-copy-file"
                  aria-label="Copy file contents to clipboard"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" /> Copy
                    </>
                  )}
                </button>
                <button
                  onClick={onDownload}
                  disabled={!file}
                  className="px-2 py-1 rounded text-[11px] border border-border hover:bg-muted/30 inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                  data-testid="btn-download-file"
                  aria-label="Download this file"
                >
                  <Download className="h-3 w-3" /> Download
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              {fileLoading && (
                <div className="flex items-center gap-2 text-slate-400 text-xs px-4 py-6">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading file…
                </div>
              )}
              {file && <CodeView content={file.content} />}
              {!selected && !fileLoading && (
                <div className="text-slate-500 text-xs px-4 py-6">
                  Left tree se file select karo. Phir Copy ya Download button se file le sakte ho.
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
