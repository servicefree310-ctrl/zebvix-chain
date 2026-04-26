import { Header } from "./Header";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col font-sans selection:bg-[#00F0FF]/30 selection:text-[#00F0FF]">
      <Header />
      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  );
}
