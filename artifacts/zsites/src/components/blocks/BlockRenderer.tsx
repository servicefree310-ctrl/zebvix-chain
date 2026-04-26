import type { SiteBlock, SiteTheme } from "@/lib/types";
import {
  NavBlock,
  HeroBlock,
  FeaturesBlock,
  PricingBlock,
  TestimonialsBlock,
  FaqBlock,
  CtaBlock,
  TextBlock,
  ImageBlock,
  GalleryBlock,
  LeadFormBlock,
  CryptoCheckoutBlock,
  FooterBlock,
} from "./blocks";

export interface BlockRendererProps {
  block: SiteBlock;
  siteId: number;
  ownerWallet?: string;
  isPreview?: boolean;
}

export function BlockRenderer({ block, siteId, ownerWallet, isPreview }: BlockRendererProps) {
  const ctx = { siteId, ownerWallet, isPreview };
  switch (block.type) {
    case "nav":
      return <NavBlock props={block.props} />;
    case "hero":
      return <HeroBlock props={block.props} />;
    case "features":
      return <FeaturesBlock props={block.props} />;
    case "pricing":
      return <PricingBlock props={block.props} />;
    case "testimonials":
      return <TestimonialsBlock props={block.props} />;
    case "faq":
      return <FaqBlock props={block.props} />;
    case "cta":
      return <CtaBlock props={block.props} />;
    case "text":
      return <TextBlock props={block.props} />;
    case "image":
      return <ImageBlock props={block.props} />;
    case "gallery":
      return <GalleryBlock props={block.props} />;
    case "lead_form":
      return <LeadFormBlock props={block.props} ctx={ctx} />;
    case "crypto_checkout":
      return <CryptoCheckoutBlock props={block.props} ctx={ctx} />;
    case "footer":
      return <FooterBlock props={block.props} />;
    default:
      return (
        <div className="px-6 py-8 text-center text-sm opacity-60">
          Unknown block type: {block.type}
        </div>
      );
  }
}

export function ThemedSite({
  blocks,
  theme,
  siteId,
  ownerWallet,
  isPreview,
}: {
  blocks: SiteBlock[];
  theme: SiteTheme;
  siteId: number;
  ownerWallet?: string;
  isPreview?: boolean;
}) {
  const style: React.CSSProperties = {
    background: theme.backgroundColor,
    color: theme.textColor,
    fontFamily: `${theme.fontFamily}, system-ui, sans-serif`,
    // Custom CSS variables for blocks to read.
    ["--zs-primary" as never]: theme.primaryColor,
    ["--zs-accent" as never]: theme.accentColor,
    ["--zs-bg" as never]: theme.backgroundColor,
    ["--zs-text" as never]: theme.textColor,
    ["--zs-radius" as never]: theme.radius,
  };
  return (
    <div style={style} className="min-h-screen">
      {blocks.map((b) => (
        <BlockRenderer
          key={b.id}
          block={b}
          siteId={siteId}
          ownerWallet={ownerWallet}
          isPreview={isPreview}
        />
      ))}
    </div>
  );
}
