import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Hexagon, Zap, Shield, Globe, ArrowRight, Code, Blocks, LayoutTemplate } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { motion } from "framer-motion";

const features = [
  {
    icon: <Blocks className="h-6 w-6 text-[#00F0FF]" />,
    title: "Block-Based Engine",
    description: "Build incredibly fast with our visual block editor. No code required, just imagination.",
  },
  {
    icon: <Zap className="h-6 w-6 text-[#00F0FF]" />,
    title: "AI Generation",
    description: "Describe your business and let our AI assemble a beautiful, high-converting site instantly.",
  },
  {
    icon: <Shield className="h-6 w-6 text-[#00F0FF]" />,
    title: "Native Web3 Checkout",
    description: "Accept ZBX, zUSD, and BNB directly on your site. Zero setup, zero intermediaries.",
  },
  {
    icon: <Globe className="h-6 w-6 text-[#00F0FF]" />,
    title: "Instant Publishing",
    description: "One click to go live on the decentralized web. Your site is fast, secure, and globally available.",
  }
];

export default function Landing() {
  return (
    <AppShell>
      <div className="flex-1 flex flex-col">
        {/* Hero Section */}
        <section className="relative overflow-hidden pt-24 pb-32 md:pt-32 md:pb-40 px-4">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#00F0FF]/10 via-black to-black pointer-events-none" />
          
          <div className="container mx-auto max-w-5xl text-center relative z-10">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <div className="inline-flex items-center rounded-full border border-[#00F0FF]/30 bg-[#00F0FF]/10 px-3 py-1 text-sm font-medium text-[#00F0FF] mb-8">
                <span className="flex h-2 w-2 rounded-full bg-[#00F0FF] mr-2 animate-pulse"></span>
                Zebvix Sites is now in public beta
              </div>
              
              <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-8 leading-tight">
                Ship beautiful Web3 sites <br className="hidden md:block" />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00F0FF] to-[#0055FF]">
                  at the speed of thought.
                </span>
              </h1>
              
              <p className="text-xl text-zinc-400 mb-12 max-w-2xl mx-auto leading-relaxed">
                The premium website builder for founders, NFT projects, and creators. Generate with AI, customize with blocks, and accept crypto payments natively.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button asChild size="lg" className="h-14 px-8 bg-[#00F0FF] text-black hover:bg-[#00F0FF]/90 text-lg font-medium w-full sm:w-auto">
                  <Link href="/sign-up">
                    Start Building Free <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-14 px-8 border-white/20 hover:bg-white/5 text-lg font-medium w-full sm:w-auto text-white">
                  <Link href="/templates">
                    View Templates
                  </Link>
                </Button>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-24 bg-zinc-950 px-4 border-t border-white/5">
          <div className="container mx-auto max-w-6xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white mb-4">
                Everything you need to launch
              </h2>
              <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
                Stop wrestling with generic builders. Zebvix Sites is built specifically for the Web3 ecosystem.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              {features.map((feature, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  viewport={{ once: true }}
                  className="p-8 rounded-2xl bg-black border border-white/10 hover:border-[#00F0FF]/50 transition-colors group"
                >
                  <div className="h-12 w-12 rounded-xl bg-[#00F0FF]/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    {feature.icon}
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">{feature.title}</h3>
                  <p className="text-zinc-400 leading-relaxed">
                    {feature.description}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
