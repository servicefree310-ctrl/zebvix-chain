import { Router, type IRouter, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { GenerateSiteWithAiBody } from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../../lib/auth";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

const SYSTEM_PROMPT = `You are an expert site designer for "Zebvix Sites", a Web3-native website builder.
You receive a short business description and (optionally) a category hint.
You return a SINGLE JSON object representing a complete site draft. Output ONLY JSON — no prose, no code fences.

The JSON has this exact shape:
{
  "title": "string (the site / brand title)",
  "description": "string (1-2 sentence brand summary)",
  "suggestedSubdomain": "string (lowercase a-z0-9-, 3-30 chars, no leading/trailing hyphen)",
  "blocks": [ { "id": "string", "type": "string", "props": { } } ],
  "theme": {
    "primaryColor": "#hex",
    "accentColor": "#hex",
    "backgroundColor": "#hex",
    "textColor": "#hex",
    "fontFamily": "Inter | Fraunces | Playfair Display | Cormorant Garamond | JetBrains Mono | Geist | DM Sans | Space Grotesk",
    "radius": "0.125rem | 0.25rem | 0.5rem | 0.75rem | 1rem",
    "mode": "light" | "dark"
  },
  "seo": { "title": "string", "description": "string" }
}

Block types you may use, with their props:
- nav: { brandName, links: [{label, href}] }
- hero: { eyebrow, headline, subhead, primaryCta:{label,href}, secondaryCta:{label,href} }
- features: { title, items: [{title, description, icon: lucide-icon-name}] }
- pricing: { title, plans: [{name, price, period, features: string[], cta:{label,href}, featured: boolean}] }
- testimonials: { title, items: [{quote, author, role}] }
- faq: { title, items: [{q, a}] }
- cta: { headline, subhead, button:{label,href} }
- text: { markdown }
- image: { src, alt, caption }
- gallery: { images: [{src, alt}] }
- lead_form: { title, subtitle, fields: [{name, label, type: "text"|"email"|"wallet"|"textarea", required: boolean}], submitLabel }
- crypto_checkout: { productName, description, asset: "zbx"|"zusd"|"bnb", amount: "decimal-string", recipientAddress: "", chainId: 7777, buttonLabel }
- footer: { tagline, columns: [{title, links: [{label, href}]}], copyright }

Rules:
- Build 7-11 blocks total. Always include nav and footer.
- Always include at least one of: lead_form, crypto_checkout. Web3 sites should usually include crypto_checkout.
- Pricing block is great for SaaS/agency. NFT projects use crypto_checkout for mint price.
- Use real, on-brand copy — never lorem ipsum, never placeholder text. Write like a real founder.
- Pick lucide icon names that exist (Layers, Palette, Zap, ShieldCheck, Sparkles, Wallet, Bitcoin, Flame, Users, Boxes, Calendar, Sprout, Utensils, RefreshCw, Heart, Star, Globe, Lock, Rocket, Compass, Camera, Coffee, Music, Sun, Moon, Cloud, Code, Cpu, Database, Server).
- Generate stable string ids (e.g. "b1", "b2", ..., or short uuids).
- Keep recipientAddress as "" — the user fills their wallet later.
- Subdomain must be unique-feeling and short (e.g. "lumen", "aurelith", "north-light").
- Theme should match the brand vibe: dark mode for crypto/tech/edgy brands, light mode for warm/restaurant/portfolio brands.
- Output ONLY JSON. No markdown fences, no prose, nothing else.`;

router.post(
  "/generate",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    const parsed = GenerateSiteWithAiBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const { prompt, category } = parsed.data;
    if (!prompt || prompt.trim().length < 4) {
      res.status(400).json({ error: "prompt_too_short" });
      return;
    }

    try {
      const userMsg =
        category && category.trim().length > 0
          ? `Category hint: ${category.trim()}\n\nDescription: ${prompt.trim()}`
          : prompt.trim();

      const resp = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }],
      });

      const textBlock = resp.content.find((b) => b.type === "text") as
        | { type: "text"; text: string }
        | undefined;
      if (!textBlock) {
        res.status(502).json({ error: "ai_no_text_response" });
        return;
      }
      let raw = textBlock.text.trim();
      // Strip ```json fences if the model wrapped output anyway.
      if (raw.startsWith("```")) {
        raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/m, "").trim();
      }
      let draft: Record<string, unknown>;
      try {
        draft = JSON.parse(raw);
      } catch (err) {
        logger.error(
          { err: String(err), preview: raw.slice(0, 400) },
          "ai_invalid_json",
        );
        res.status(502).json({ error: "ai_invalid_json" });
        return;
      }

      // Minimal post-validation + defaulting.
      const title = String(draft.title ?? "Untitled");
      const description = String(draft.description ?? "");
      const blocks = Array.isArray(draft.blocks) ? draft.blocks : [];
      const theme = (draft.theme as Record<string, unknown>) ?? {};
      const seo = (draft.seo as Record<string, unknown>) ?? {};
      const suggestedSubdomain =
        typeof draft.suggestedSubdomain === "string" && draft.suggestedSubdomain.length > 0
          ? draft.suggestedSubdomain
          : title
              .toLowerCase()
              .replace(/[^a-z0-9-]+/g, "-")
              .replace(/^-+|-+$/g, "")
              .slice(0, 30) || "my-site";

      // Ensure block ids exist.
      const safeBlocks = blocks.map((b: unknown, i: number) => {
        const block = (b ?? {}) as Record<string, unknown>;
        return {
          id: typeof block.id === "string" && block.id.length > 0 ? block.id : `b${i + 1}`,
          type: typeof block.type === "string" ? block.type : "text",
          props: (block.props as Record<string, unknown>) ?? {},
        };
      });

      const safeTheme = {
        primaryColor: String(theme.primaryColor ?? "#7c5cff"),
        accentColor: String(theme.accentColor ?? "#22d3ee"),
        backgroundColor: String(theme.backgroundColor ?? "#0b0b14"),
        textColor: String(theme.textColor ?? "#f5f3ff"),
        fontFamily: String(theme.fontFamily ?? "Inter"),
        radius: String(theme.radius ?? "0.5rem"),
        mode:
          theme.mode === "light" || theme.mode === "dark"
            ? theme.mode
            : "dark",
      };

      const safeSeo = {
        title: String(seo.title ?? title),
        description: String(seo.description ?? description),
        ...(typeof seo.ogImageUrl === "string" ? { ogImageUrl: seo.ogImageUrl } : {}),
      };

      res.json({
        title,
        description,
        blocks: safeBlocks,
        theme: safeTheme,
        seo: safeSeo,
        suggestedSubdomain,
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "ai_generate_failed",
      );
      res.status(500).json({ error: "ai_generate_failed" });
    }
  },
);

export default router;
