import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Folder,
  FolderOpen,
  FileCode2,
  FileText,
  FileJson,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
  children?: TreeNode[];
}

interface TreeResp {
  tree: TreeNode[];
  stats: { files: number; lines: number };
}

interface FileResp {
  path: string;
  size: number;
  lines: number;
  content: string;
}

function fileIcon(name: string) {
  if (name.endsWith(".rs")) return <FileCode2 className="h-3.5 w-3.5 text-orange-400" />;
  if (name.endsWith(".sol")) return <FileCode2 className="h-3.5 w-3.5 text-purple-400" />;
  if (name.endsWith(".toml")) return <FileText className="h-3.5 w-3.5 text-yellow-400" />;
  if (name.endsWith(".json")) return <FileJson className="h-3.5 w-3.5 text-blue-400" />;
  if (name.endsWith(".md")) return <FileText className="h-3.5 w-3.5 text-emerald-400" />;
  return <FileText className="h-3.5 w-3.5 text-slate-500" />;
}

function TreeView({
  nodes,
  depth = 0,
  onSelect,
  selected,
  expanded,
  toggle,
}: {
  nodes: TreeNode[];
  depth?: number;
  onSelect: (path: string) => void;
  selected: string | null;
  expanded: Set<string>;
  toggle: (path: string) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((n) => {
        const isOpen = expanded.has(n.path);
        const isSel = selected === n.path;
        return (
          <li key={n.path}>
            <button
              onClick={() => (n.type === "dir" ? toggle(n.path) : onSelect(n.path))}
              className={`w-full flex items-center gap-1.5 text-left px-2 py-1 rounded hover-elevate text-xs ${
                isSel ? "bg-emerald-500/15 text-emerald-300" : "text-slate-300"
              }`}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              data-testid={`tree-${n.type}-${n.path}`}
            >
              {n.type === "dir" ? (
                <>
                  {isOpen ? (
                    <ChevronDown className="h-3 w-3 text-slate-500 shrink-0" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-slate-500 shrink-0" />
                  )}
                  {isOpen ? (
                    <FolderOpen className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  ) : (
                    <Folder className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  )}
                </>
              ) : (
                <>
                  <span className="w-3 shrink-0" />
                  {fileIcon(n.name)}
                </>
              )}
              <span className="truncate font-mono">{n.name}</span>
              {n.type === "file" && n.size != null && (
                <span className="ml-auto text-[10px] text-slate-500">
                  {n.size < 1024 ? `${n.size}B` : `${(n.size / 1024).toFixed(1)}K`}
                </span>
              )}
            </button>
            {n.type === "dir" && isOpen && n.children && (
              <TreeView
                nodes={n.children}
                depth={depth + 1}
                onSelect={onSelect}
                selected={selected}
                expanded={expanded}
                toggle={toggle}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CodeView({ path, content }: { path: string; content: string }) {
  const lines = content.split("\n");
  return (
    <pre className="text-xs leading-relaxed font-mono overflow-x-auto">
      <code>
        {lines.map((line, i) => (
          <div key={i} className="flex hover:bg-slate-800/40">
            <span className="select-none text-slate-600 pr-4 pl-3 text-right w-12 shrink-0 border-r border-slate-800 mr-3">
              {i + 1}
            </span>
            <span className="text-slate-300 whitespace-pre">{line || " "}</span>
          </div>
        ))}
      </code>
    </pre>
  );
}

export default function ChainCode() {
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["src"]));

  const { data: tree, isLoading: treeLoading, error: treeError } = useQuery<TreeResp>({
    queryKey: ["chain-tree"],
    queryFn: async () => {
      const r = await fetch("/api/chain/tree");
      if (!r.ok) throw new Error("Failed to load tree");
      return r.json();
    },
    refetchInterval: 30000,
  });

  const { data: file, isLoading: fileLoading } = useQuery<FileResp>({
    queryKey: ["chain-file", selected],
    queryFn: async () => {
      const r = await fetch(`/api/chain/file?path=${encodeURIComponent(selected!)}`);
      if (!r.ok) throw new Error("Failed to load file");
      return r.json();
    },
    enabled: !!selected,
  });

  // auto-select main.rs on first load
  useEffect(() => {
    if (!selected && tree?.tree) {
      const findFirst = (nodes: TreeNode[]): string | null => {
        for (const n of nodes) {
          if (n.path === "src/main.rs") return n.path;
          if (n.children) {
            const r = findFirst(n.children);
            if (r) return r;
          }
        }
        return null;
      };
      const first = findFirst(tree.tree);
      if (first) setSelected(first);
    }
  }, [tree, selected]);

  const toggle = (p: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  return (
    <div className="space-y-6 p-2">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Chain Source Code</h1>
        <p className="text-slate-400 text-sm">
          Zebvix L1 — full source browser. Auto-refreshes every 30 seconds; any new feature you ship surfaces here automatically.
        </p>
      </div>

      {tree && (
        <div className="flex flex-wrap gap-2">
          <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 border">
            {tree.stats.files} files
          </Badge>
          <Badge className="bg-blue-500/15 text-blue-300 border-blue-500/30 border">
            {tree.stats.lines.toLocaleString()} lines
          </Badge>
          <Badge className="bg-purple-500/15 text-purple-300 border-purple-500/30 border">
            Rust · zebvix-chain v0.1
          </Badge>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
        {/* Tree */}
        <Card className="bg-slate-900/60 border-slate-700/50 h-[70vh]">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm text-slate-300">Files</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            <ScrollArea className="h-[60vh] pr-2">
              {treeLoading && (
                <div className="flex items-center gap-2 text-slate-400 text-xs px-2 py-3">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </div>
              )}
              {treeError && (
                <div className="flex items-start gap-2 text-red-400 text-xs px-2 py-3">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>API server is not reachable</span>
                </div>
              )}
              {tree && (
                <TreeView
                  nodes={tree.tree}
                  onSelect={setSelected}
                  selected={selected}
                  expanded={expanded}
                  toggle={toggle}
                />
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Code */}
        <Card className="bg-slate-950 border-slate-700/50 h-[70vh] flex flex-col">
          <CardHeader className="pb-2 pt-4 border-b border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-mono text-emerald-400 truncate">
                {selected || "Select a file"}
              </CardTitle>
              {file && (
                <span className="text-[10px] text-slate-500 font-mono shrink-0">
                  {file.lines} lines · {(file.size / 1024).toFixed(1)} KB
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              {fileLoading && (
                <div className="flex items-center gap-2 text-slate-400 text-xs px-4 py-6">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading file…
                </div>
              )}
              {file && <CodeView path={file.path} content={file.content} />}
              {!selected && !fileLoading && (
                <div className="text-slate-500 text-xs px-4 py-6">
                  Select a file from the tree on the left
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
