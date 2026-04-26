// Static starter templates for new sites. Each template is a complete site draft
// (blocks + theme + seo) that the user can clone and immediately publish.

type Block = { id: string; type: string; props: Record<string, unknown> };

interface Theme {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  radius: string;
  mode: "light" | "dark";
}

interface Seo {
  title: string;
  description: string;
  ogImageUrl?: string;
}

interface Draft {
  title: string;
  description: string;
  blocks: Block[];
  theme: Theme;
  seo: Seo;
  suggestedSubdomain: string;
}

interface Template {
  slug: string;
  name: string;
  category: string;
  description: string;
  previewImage?: string;
  draft: Draft;
}

const id = (() => {
  let n = 0;
  return () => `b_${++n}_${Date.now().toString(36)}`;
})();

function block(type: string, props: Record<string, unknown>): Block {
  return { id: id(), type, props };
}

const SAAS: Template = {
  slug: "saas",
  name: "Lumen — SaaS launch",
  category: "saas",
  description:
    "A premium SaaS launch page with crypto-native pricing, perfect for indie developers shipping a v1.",
  draft: {
    title: "Lumen",
    description: "Ship a beautiful changelog in minutes.",
    suggestedSubdomain: "lumen",
    blocks: [
      block("nav", {
        brandName: "Lumen",
        links: [
          { label: "Features", href: "#features" },
          { label: "Pricing", href: "#pricing" },
          { label: "Docs", href: "#" },
        ],
      }),
      block("hero", {
        eyebrow: "Now in public beta",
        headline: "The changelog your customers actually read.",
        subhead:
          "Lumen turns your Linear and GitHub activity into a polished public timeline — auto-grouped, auto-summarized, on-brand.",
        primaryCta: { label: "Start free", href: "#pricing" },
        secondaryCta: { label: "See live demo", href: "#" },
      }),
      block("features", {
        title: "Built for teams that ship every day",
        items: [
          {
            title: "Auto-grouping",
            description:
              "Bundle related PRs and issues into single, scannable updates without lifting a finger.",
            icon: "Layers",
          },
          {
            title: "Brand-true",
            description:
              "Custom domain, theme, fonts. It looks like your product, not a third-party tool.",
            icon: "Palette",
          },
          {
            title: "Crypto-paid plans",
            description:
              "Bill in stablecoins. Webhook-free, Stripe-free, settled on-chain in seconds.",
            icon: "Bitcoin",
          },
        ],
      }),
      block("pricing", {
        title: "Simple, on-chain pricing",
        plans: [
          {
            name: "Solo",
            price: "0",
            period: "ZBX / mo",
            features: [
              "1 project",
              "Public changelog",
              "Markdown editor",
              "Community support",
            ],
            cta: { label: "Start free", href: "#" },
            featured: false,
          },
          {
            name: "Team",
            price: "29",
            period: "zUSD / mo",
            features: [
              "Unlimited projects",
              "Custom domain",
              "Auto-grouping AI",
              "Priority support",
            ],
            cta: { label: "Pay with wallet", href: "#" },
            featured: true,
          },
          {
            name: "Studio",
            price: "99",
            period: "zUSD / mo",
            features: [
              "Multi-tenant",
              "White-label",
              "API access",
              "Dedicated support",
            ],
            cta: { label: "Pay with wallet", href: "#" },
            featured: false,
          },
        ],
      }),
      block("crypto_checkout", {
        productName: "Team plan — 1 month",
        description:
          "Pay 29 zUSD with any Zebvix wallet. Access unlocks the moment the tx confirms.",
        asset: "zusd",
        amount: "29",
        recipientAddress: "",
        chainId: 7777,
        buttonLabel: "Pay 29 zUSD",
      }),
      block("testimonials", {
        title: "Trusted by builders",
        items: [
          {
            quote:
              "Lumen replaced our weekly changelog email and our customer NPS jumped 12 points in a quarter.",
            author: "Marc T.",
            role: "Founder, Stack Eng",
          },
          {
            quote:
              "The crypto checkout was the first time I've ever shipped paid product without touching Stripe.",
            author: "Priya N.",
            role: "Indie hacker",
          },
        ],
      }),
      block("faq", {
        title: "FAQ",
        items: [
          {
            q: "What's a Zebvix wallet?",
            a: "Any EVM-compatible wallet that supports Zebvix L1 (chain id 7777). Most users use the Zebvix wallet itself.",
          },
          {
            q: "Can I migrate from another tool?",
            a: "Yes — import from Linear, GitHub, or paste markdown. We handle the formatting.",
          },
          {
            q: "Do you offer fiat?",
            a: "Not yet. We believe crypto-native checkout is faster, cheaper, and removes a 30-day refund window we don't need.",
          },
        ],
      }),
      block("cta", {
        headline: "Ship your changelog this afternoon.",
        subhead: "Free forever for solo projects. No card required.",
        button: { label: "Start free", href: "#" },
      }),
      block("footer", {
        tagline: "Lumen — changelogs that read themselves.",
        columns: [
          {
            title: "Product",
            links: [
              { label: "Features", href: "#" },
              { label: "Pricing", href: "#" },
              { label: "Changelog", href: "#" },
            ],
          },
          {
            title: "Company",
            links: [
              { label: "About", href: "#" },
              { label: "Contact", href: "#" },
            ],
          },
        ],
        copyright: "© Lumen. Built on Zebvix L1.",
      }),
    ],
    theme: {
      primaryColor: "#7c5cff",
      accentColor: "#22d3ee",
      backgroundColor: "#0b0b14",
      textColor: "#f5f3ff",
      fontFamily: "Inter",
      radius: "0.75rem",
      mode: "dark",
    },
    seo: {
      title: "Lumen — Changelogs your customers actually read",
      description:
        "Lumen turns your shipping into a beautiful, on-brand public timeline. Crypto-native pricing.",
    },
  },
};

const NFT: Template = {
  slug: "nft",
  name: "Aurelith — NFT mint",
  category: "nft",
  description:
    "A confident NFT project page with mint, roadmap, and a built-in crypto checkout for whitelist drops.",
  draft: {
    title: "Aurelith",
    description: "An on-chain anthology of 4,444 digital reliquaries.",
    suggestedSubdomain: "aurelith",
    blocks: [
      block("nav", {
        brandName: "Aurelith",
        links: [
          { label: "Mint", href: "#mint" },
          { label: "Collection", href: "#" },
          { label: "Lore", href: "#" },
        ],
      }),
      block("hero", {
        eyebrow: "Phase II — Whitelist live",
        headline: "Reliquaries for the chain age.",
        subhead:
          "4,444 hand-illustrated artifacts, minted on Zebvix L1. Each one a one-of-a-kind story.",
        primaryCta: { label: "Mint a piece", href: "#mint" },
        secondaryCta: { label: "Read the lore", href: "#" },
      }),
      block("features", {
        title: "Why Aurelith",
        items: [
          {
            title: "Hand-drawn",
            description:
              "Every reliquary is illustrated by a working artist. No AI slop, no mass-produced traits.",
            icon: "Palette",
          },
          {
            title: "On Zebvix L1",
            description:
              "Sub-second mints. Sub-cent gas. The mint feels instant because it is.",
            icon: "Zap",
          },
          {
            title: "Royalties on chain",
            description:
              "5% royalties enforced on chain — flowing back to the artists who made the work.",
            icon: "ShieldCheck",
          },
        ],
      }),
      block("crypto_checkout", {
        productName: "Aurelith — Whitelist mint (1 reliquary)",
        description:
          "0.05 ZBX gets you a guaranteed allocation. Mints open Friday 18:00 UTC.",
        asset: "zbx",
        amount: "0.05",
        recipientAddress: "",
        chainId: 7777,
        buttonLabel: "Mint for 0.05 ZBX",
      }),
      block("gallery", {
        images: [
          { src: "", alt: "Reliquary No. 0001" },
          { src: "", alt: "Reliquary No. 0002" },
          { src: "", alt: "Reliquary No. 0003" },
          { src: "", alt: "Reliquary No. 0004" },
        ],
      }),
      block("faq", {
        title: "Mint FAQ",
        items: [
          {
            q: "How many can I mint?",
            a: "Up to 5 per wallet on whitelist. Public mint opens 24h later with a 2-per-wallet cap.",
          },
          {
            q: "What's the supply?",
            a: "4,444. Forever. No expansion, no editions, no cope.",
          },
          {
            q: "Where do royalties go?",
            a: "Directly to the artist multisig. Verifiable on-chain.",
          },
        ],
      }),
      block("lead_form", {
        title: "Join the allowlist",
        subtitle: "Drop your wallet for the next phase.",
        fields: [
          { name: "wallet", label: "Wallet address", type: "wallet", required: true },
          { name: "email", label: "Email (optional)", type: "email", required: false },
        ],
        submitLabel: "Add me",
      }),
      block("footer", {
        tagline: "Aurelith — on-chain reliquaries.",
        columns: [
          {
            title: "Project",
            links: [
              { label: "Mint", href: "#" },
              { label: "Lore", href: "#" },
            ],
          },
          {
            title: "Community",
            links: [
              { label: "Discord", href: "#" },
              { label: "Twitter", href: "#" },
            ],
          },
        ],
        copyright: "© Aurelith Studio. Minted on Zebvix L1.",
      }),
    ],
    theme: {
      primaryColor: "#d4a373",
      accentColor: "#1f1b16",
      backgroundColor: "#0c0a09",
      textColor: "#fef9f3",
      fontFamily: "Cormorant Garamond",
      radius: "0.5rem",
      mode: "dark",
    },
    seo: {
      title: "Aurelith — On-chain reliquaries on Zebvix L1",
      description:
        "4,444 hand-illustrated digital reliquaries. Whitelist mint live.",
    },
  },
};

const AGENCY: Template = {
  slug: "agency",
  name: "North & Light — Agency",
  category: "agency",
  description:
    "A confident creative-agency portfolio with project case studies and a contact form.",
  draft: {
    title: "North & Light",
    description: "An independent design studio. Brand systems and digital products.",
    suggestedSubdomain: "northandlight",
    blocks: [
      block("nav", {
        brandName: "North & Light",
        links: [
          { label: "Work", href: "#work" },
          { label: "Studio", href: "#studio" },
          { label: "Contact", href: "#contact" },
        ],
      }),
      block("hero", {
        eyebrow: "Brand systems · Digital products",
        headline: "We design things that age well.",
        subhead:
          "An independent studio of seven, working with founders who treat design as the product, not the wrapping.",
        primaryCta: { label: "See our work", href: "#work" },
        secondaryCta: { label: "Start a project", href: "#contact" },
      }),
      block("features", {
        title: "How we work",
        items: [
          {
            title: "Embedded",
            description:
              "We sit inside your team for the duration. No hand-offs, no Figma archaeology.",
            icon: "Users",
          },
          {
            title: "Systems first",
            description:
              "Every project leaves you with a system you can extend without us.",
            icon: "Boxes",
          },
          {
            title: "Six engagements a year",
            description:
              "We choose work carefully. Most projects start with a paid two-week sprint.",
            icon: "Calendar",
          },
        ],
      }),
      block("gallery", {
        images: [
          { src: "", alt: "Brand system — Helio" },
          { src: "", alt: "Product design — Stack" },
          { src: "", alt: "Identity — Bay Coffee" },
          { src: "", alt: "App — Field Notes" },
        ],
      }),
      block("testimonials", {
        title: "Words from clients",
        items: [
          {
            quote:
              "Working with North & Light reset our standard for what design partners look like.",
            author: "Hannah B.",
            role: "Founder, Helio",
          },
          {
            quote:
              "They shipped a brand system we're still extending three years later.",
            author: "Ravi M.",
            role: "Head of design, Stack",
          },
        ],
      }),
      block("lead_form", {
        title: "Start a conversation",
        subtitle: "Tell us a little about your project. We respond within two business days.",
        fields: [
          { name: "name", label: "Name", type: "text", required: true },
          { name: "email", label: "Email", type: "email", required: true },
          { name: "project", label: "What are you working on?", type: "textarea", required: true },
        ],
        submitLabel: "Send",
      }),
      block("footer", {
        tagline: "North & Light — independent design studio, est. 2017.",
        columns: [
          {
            title: "Studio",
            links: [
              { label: "Work", href: "#" },
              { label: "Approach", href: "#" },
              { label: "Contact", href: "#" },
            ],
          },
        ],
        copyright: "© North & Light Studio.",
      }),
    ],
    theme: {
      primaryColor: "#0f172a",
      accentColor: "#f59e0b",
      backgroundColor: "#fafaf9",
      textColor: "#1c1917",
      fontFamily: "Fraunces",
      radius: "0.25rem",
      mode: "light",
    },
    seo: {
      title: "North & Light — Independent design studio",
      description:
        "Brand systems and digital products for founders who care about craft.",
    },
  },
};

const RESTAURANT: Template = {
  slug: "restaurant",
  name: "Mela — Restaurant",
  category: "restaurant",
  description:
    "A warm restaurant page with menu, reservations, and a tip-the-chef crypto block.",
  draft: {
    title: "Mela",
    description:
      "A wood-fire kitchen in the Mission. Seasonal Italian, ten tables, no shortcuts.",
    suggestedSubdomain: "mela",
    blocks: [
      block("nav", {
        brandName: "Mela",
        links: [
          { label: "Menu", href: "#menu" },
          { label: "Reservations", href: "#book" },
          { label: "Visit", href: "#visit" },
        ],
      }),
      block("hero", {
        eyebrow: "Now serving Tuesday to Sunday",
        headline: "Wood-fire dinners in the Mission.",
        subhead:
          "Seasonal Italian, ten tables, two seatings nightly. Reserve a week ahead.",
        primaryCta: { label: "Book a table", href: "#book" },
        secondaryCta: { label: "See the menu", href: "#menu" },
      }),
      block("features", {
        title: "What we're about",
        items: [
          {
            title: "Wood fire",
            description:
              "Almond and apple wood. Everything that touches a plate touches the fire first.",
            icon: "Flame",
          },
          {
            title: "Seasonal",
            description:
              "The menu shifts every two weeks. Whatever the farmers are bringing on Tuesday, you're eating on Friday.",
            icon: "Sprout",
          },
          {
            title: "Ten tables",
            description:
              "We took out the bar so we could fit ten tables and one chef. That was the deal.",
            icon: "Utensils",
          },
        ],
      }),
      block("text", {
        markdown:
          "## Tonight's menu\n\n**Antipasti** — Burrata, charred peach, bay leaf oil · 18\n**Primi** — Hand-cut pappardelle, slow-cooked rabbit, pecorino · 26\n**Secondi** — Whole branzino, salt-baked over fire, lemon, fennel pollen · 38\n**Dolci** — Olive oil cake, blackberry, crème fraîche · 12\n\nMenu changes every two weeks.",
      }),
      block("lead_form", {
        title: "Reservations",
        subtitle: "Two seatings nightly: 5:30pm and 8:00pm. We confirm by email.",
        fields: [
          { name: "name", label: "Name", type: "text", required: true },
          { name: "email", label: "Email", type: "email", required: true },
          { name: "party", label: "Party size + preferred date", type: "textarea", required: true },
        ],
        submitLabel: "Request a table",
      }),
      block("crypto_checkout", {
        productName: "Tip the kitchen",
        description: "Send the chefs a thank-you in zUSD. Goes straight to staff.",
        asset: "zusd",
        amount: "10",
        recipientAddress: "",
        chainId: 7777,
        buttonLabel: "Tip 10 zUSD",
      }),
      block("footer", {
        tagline: "Mela — 2410 Valencia Street, San Francisco.",
        columns: [
          {
            title: "Visit",
            links: [
              { label: "Hours", href: "#" },
              { label: "Directions", href: "#" },
            ],
          },
          {
            title: "Follow",
            links: [
              { label: "Instagram", href: "#" },
            ],
          },
        ],
        copyright: "© Mela. Wood, fire, salt.",
      }),
    ],
    theme: {
      primaryColor: "#9a3412",
      accentColor: "#fde68a",
      backgroundColor: "#fffbeb",
      textColor: "#1c1917",
      fontFamily: "Playfair Display",
      radius: "0.125rem",
      mode: "light",
    },
    seo: {
      title: "Mela — Wood-fire dinners in the Mission",
      description:
        "Seasonal Italian, ten tables, two seatings nightly. Reservations open weekly.",
    },
  },
};

const PORTFOLIO: Template = {
  slug: "portfolio",
  name: "Iris — Portfolio",
  category: "portfolio",
  description:
    "A focused personal portfolio with projects, writing, and an on-chain hire-me block.",
  draft: {
    title: "Iris Tanaka",
    description: "Product engineer. Tokyo, sometimes San Francisco.",
    suggestedSubdomain: "iris",
    blocks: [
      block("nav", {
        brandName: "Iris Tanaka",
        links: [
          { label: "Work", href: "#work" },
          { label: "Writing", href: "#writing" },
          { label: "Hire me", href: "#hire" },
        ],
      }),
      block("hero", {
        eyebrow: "Available — Q3",
        headline: "I build the parts of products you don't see.",
        subhead:
          "Currently freelance. Eight years across infra, payments, and AI tooling. Half my best work happens in the seam between teams.",
        primaryCta: { label: "See selected work", href: "#work" },
        secondaryCta: { label: "Read recent writing", href: "#writing" },
      }),
      block("features", {
        title: "Recent work",
        items: [
          {
            title: "Stack — payments rewrite",
            description:
              "Re-architected the entire ledger to support multi-currency settlement in 6 weeks.",
            icon: "Wallet",
          },
          {
            title: "Helio — AI evals",
            description:
              "Designed and shipped the eval harness now used across 11 product surfaces.",
            icon: "Sparkles",
          },
          {
            title: "Field — sync engine",
            description:
              "Built an offline-first sync engine that powers the iOS app's three core flows.",
            icon: "RefreshCw",
          },
        ],
      }),
      block("text", {
        markdown:
          "## Writing\n\n- *On payments rewrites* — what I'd tell my younger self about ledger design (March)\n- *The eval harness* — building feedback loops you can trust (January)\n- *Sync without tears* — a CRDT primer for product engineers (November)",
      }),
      block("crypto_checkout", {
        productName: "Discovery call (60 min)",
        description:
          "Book a paid 60-minute call to talk through your project. Refundable if we don't end up working together.",
        asset: "zusd",
        amount: "200",
        recipientAddress: "",
        chainId: 7777,
        buttonLabel: "Book for 200 zUSD",
      }),
      block("lead_form", {
        title: "Send me a brief",
        subtitle: "Email is fine, but a few sentences here helps me reply faster.",
        fields: [
          { name: "name", label: "Name", type: "text", required: true },
          { name: "email", label: "Email", type: "email", required: true },
          { name: "brief", label: "What are you working on?", type: "textarea", required: true },
        ],
        submitLabel: "Send brief",
      }),
      block("footer", {
        tagline: "Iris Tanaka — product engineer.",
        columns: [
          {
            title: "Elsewhere",
            links: [
              { label: "GitHub", href: "#" },
              { label: "Read.cv", href: "#" },
              { label: "Twitter", href: "#" },
            ],
          },
        ],
        copyright: "© Iris Tanaka.",
      }),
    ],
    theme: {
      primaryColor: "#10b981",
      accentColor: "#0f172a",
      backgroundColor: "#f8fafc",
      textColor: "#0f172a",
      fontFamily: "Inter",
      radius: "0.5rem",
      mode: "light",
    },
    seo: {
      title: "Iris Tanaka — Product engineer",
      description:
        "Eight years across infra, payments, and AI tooling. Currently freelance.",
    },
  },
};

export const SITE_TEMPLATES: Template[] = [SAAS, NFT, AGENCY, RESTAURANT, PORTFOLIO];
