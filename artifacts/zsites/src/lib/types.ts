export interface SiteBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

export interface SiteTheme {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  radius: string;
  mode: "light" | "dark";
}

export interface SiteSeo {
  title: string;
  description: string;
  ogImageUrl?: string;
}

export const DEFAULT_THEME: SiteTheme = {
  primaryColor: "#7c5cff",
  accentColor: "#22d3ee",
  backgroundColor: "#0b0b14",
  textColor: "#f5f3ff",
  fontFamily: "Inter",
  radius: "0.75rem",
  mode: "dark",
};

export const BLOCK_TYPES = [
  { type: "nav", label: "Navigation" },
  { type: "hero", label: "Hero" },
  { type: "features", label: "Features" },
  { type: "pricing", label: "Pricing" },
  { type: "testimonials", label: "Testimonials" },
  { type: "faq", label: "FAQ" },
  { type: "cta", label: "Call to action" },
  { type: "text", label: "Text / Markdown" },
  { type: "image", label: "Image" },
  { type: "gallery", label: "Gallery" },
  { type: "lead_form", label: "Lead form" },
  { type: "crypto_checkout", label: "Crypto checkout" },
  { type: "footer", label: "Footer" },
] as const;

export function defaultPropsFor(type: string): Record<string, unknown> {
  switch (type) {
    case "nav":
      return { brandName: "My brand", links: [{ label: "Home", href: "#" }] };
    case "hero":
      return {
        eyebrow: "",
        headline: "A great headline goes here",
        subhead: "And a calm subhead that explains the value.",
        primaryCta: { label: "Get started", href: "#" },
        secondaryCta: { label: "Learn more", href: "#" },
      };
    case "features":
      return {
        title: "What we offer",
        items: [
          { title: "Fast", description: "Quick and reliable.", icon: "Zap" },
          { title: "Secure", description: "Built on solid foundations.", icon: "ShieldCheck" },
          { title: "Open", description: "Designed for your stack.", icon: "Boxes" },
        ],
      };
    case "pricing":
      return {
        title: "Pricing",
        plans: [
          {
            name: "Starter",
            price: "0",
            period: "ZBX / mo",
            features: ["1 project", "Community support"],
            cta: { label: "Get started", href: "#" },
            featured: false,
          },
          {
            name: "Pro",
            price: "29",
            period: "zUSD / mo",
            features: ["Unlimited projects", "Priority support"],
            cta: { label: "Pay with wallet", href: "#" },
            featured: true,
          },
        ],
      };
    case "testimonials":
      return {
        title: "What people say",
        items: [
          { quote: "Loved it.", author: "A user", role: "Engineer" },
        ],
      };
    case "faq":
      return {
        title: "Frequently asked",
        items: [{ q: "Is it good?", a: "Yes." }],
      };
    case "cta":
      return {
        headline: "Ready to ship?",
        subhead: "Get started in seconds.",
        button: { label: "Get started", href: "#" },
      };
    case "text":
      return { markdown: "## A heading\n\nSome paragraph text." };
    case "image":
      return { src: "", alt: "Image", caption: "" };
    case "gallery":
      return { images: [{ src: "", alt: "Photo 1" }] };
    case "lead_form":
      return {
        title: "Get in touch",
        subtitle: "We'll respond within a day.",
        fields: [
          { name: "email", label: "Email", type: "email", required: true },
        ],
        submitLabel: "Send",
      };
    case "crypto_checkout":
      return {
        productName: "Premium plan",
        description: "One month of access, paid on Zebvix L1.",
        asset: "zusd",
        amount: "29",
        recipientAddress: "",
        chainId: 7777,
        buttonLabel: "Pay 29 zUSD",
      };
    case "footer":
      return {
        tagline: "Made with Zebvix Sites.",
        columns: [
          { title: "Product", links: [{ label: "Home", href: "#" }] },
        ],
        copyright: "© 2025",
      };
    default:
      return {};
  }
}
