import { useState } from "react";
import { DynamicIcon } from "./icon";
import { CryptoCheckoutModal } from "./CryptoCheckoutModal";
import { useSubmitLead } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type Props = Record<string, unknown>;

function get<T = unknown>(props: Props, key: string, fallback: T): T {
  const v = props[key];
  return (v === undefined || v === null ? fallback : v) as T;
}

interface RenderContext {
  siteId: number;
  ownerWallet?: string;
  isPreview?: boolean;
}

export function NavBlock({ props }: { props: Props }) {
  const brandName = get<string>(props, "brandName", "");
  const links = get<{ label: string; href: string }[]>(props, "links", []);
  return (
    <nav className="flex items-center justify-between border-b border-current/10 px-6 py-4">
      <div className="text-lg font-semibold">{brandName}</div>
      <div className="hidden gap-6 md:flex">
        {links.map((l, i) => (
          <a
            key={i}
            href={l.href || "#"}
            className="text-sm opacity-80 hover:opacity-100 transition"
          >
            {l.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

export function HeroBlock({ props }: { props: Props }) {
  const eyebrow = get<string>(props, "eyebrow", "");
  const headline = get<string>(props, "headline", "");
  const subhead = get<string>(props, "subhead", "");
  const primary = get<{ label: string; href: string } | undefined>(props, "primaryCta", undefined);
  const secondary = get<{ label: string; href: string } | undefined>(props, "secondaryCta", undefined);
  const imageUrl = get<string>(props, "imageUrl", "");
  return (
    <section className="px-6 py-24 md:py-32">
      <div className="mx-auto max-w-4xl text-center">
        {eyebrow ? (
          <div className="mb-4 inline-flex items-center rounded-full border border-current/20 px-3 py-1 text-xs uppercase tracking-wider opacity-80">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight">{headline}</h1>
        {subhead ? (
          <p className="mx-auto mt-6 max-w-2xl text-lg opacity-80">{subhead}</p>
        ) : null}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {primary ? (
            <a
              href={primary.href || "#"}
              className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold"
              style={{ background: "var(--zs-primary)", color: "var(--zs-bg)" }}
            >
              {primary.label}
              <ArrowRight className="h-4 w-4" />
            </a>
          ) : null}
          {secondary ? (
            <a
              href={secondary.href || "#"}
              className="inline-flex items-center gap-2 rounded-full border border-current/20 px-6 py-3 text-sm font-semibold opacity-90 hover:opacity-100"
            >
              {secondary.label}
            </a>
          ) : null}
        </div>
        {imageUrl ? (
          <img src={imageUrl} alt="" className="mx-auto mt-12 max-w-3xl rounded-2xl" />
        ) : null}
      </div>
    </section>
  );
}

export function FeaturesBlock({ props }: { props: Props }) {
  const title = get<string>(props, "title", "");
  const items = get<{ title: string; description: string; icon: string }[]>(props, "items", []);
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        {title ? (
          <h2 className="text-3xl font-bold tracking-tight text-center mb-12">{title}</h2>
        ) : null}
        <div className="grid gap-6 md:grid-cols-3">
          {items.map((it, i) => (
            <div
              key={i}
              className="rounded-2xl border border-current/10 p-6"
            >
              <DynamicIcon name={it.icon} className="h-6 w-6 mb-4" />
              <div className="text-lg font-semibold">{it.title}</div>
              <p className="mt-2 text-sm opacity-80">{it.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function PricingBlock({ props }: { props: Props }) {
  const title = get<string>(props, "title", "");
  const plans = get<
    {
      name: string;
      price: string;
      period: string;
      features: string[];
      cta: { label: string; href: string };
      featured: boolean;
    }[]
  >(props, "plans", []);
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        {title ? (
          <h2 className="text-3xl font-bold tracking-tight text-center mb-12">{title}</h2>
        ) : null}
        <div className="grid gap-6 md:grid-cols-3">
          {plans.map((plan, i) => (
            <div
              key={i}
              className={`rounded-2xl border p-6 ${plan.featured ? "border-current shadow-lg" : "border-current/10"}`}
              style={
                plan.featured
                  ? { background: "var(--zs-primary)", color: "var(--zs-bg)" }
                  : {}
              }
            >
              <div className="text-sm font-semibold uppercase tracking-wider opacity-80">
                {plan.name}
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <div className="text-4xl font-bold">{plan.price}</div>
                <div className="text-sm opacity-70">{plan.period}</div>
              </div>
              <ul className="mt-6 space-y-2 text-sm">
                {(plan.features ?? []).map((f, j) => (
                  <li key={j} className="flex items-center gap-2">
                    <Check className="h-4 w-4 opacity-70" /> {f}
                  </li>
                ))}
              </ul>
              {plan.cta ? (
                <a
                  href={plan.cta.href || "#"}
                  className={`mt-8 inline-flex w-full items-center justify-center rounded-full px-4 py-2 text-sm font-semibold ${
                    plan.featured
                      ? "bg-current/90 text-white"
                      : "border border-current/20"
                  }`}
                  style={
                    plan.featured
                      ? { background: "var(--zs-bg)", color: "var(--zs-primary)" }
                      : {}
                  }
                >
                  {plan.cta.label}
                </a>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function TestimonialsBlock({ props }: { props: Props }) {
  const title = get<string>(props, "title", "");
  const items = get<{ quote: string; author: string; role: string }[]>(props, "items", []);
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-5xl">
        {title ? (
          <h2 className="text-3xl font-bold tracking-tight text-center mb-12">{title}</h2>
        ) : null}
        <div className="grid gap-6 md:grid-cols-2">
          {items.map((t, i) => (
            <figure key={i} className="rounded-2xl border border-current/10 p-6">
              <blockquote className="text-lg leading-relaxed">"{t.quote}"</blockquote>
              <figcaption className="mt-4 text-sm opacity-70">
                — {t.author}, {t.role}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FaqBlock({ props }: { props: Props }) {
  const title = get<string>(props, "title", "");
  const items = get<{ q: string; a: string }[]>(props, "items", []);
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-3xl">
        {title ? (
          <h2 className="text-3xl font-bold tracking-tight text-center mb-12">{title}</h2>
        ) : null}
        <div className="space-y-3">
          {items.map((it, i) => (
            <details key={i} className="rounded-xl border border-current/10 p-5 group">
              <summary className="cursor-pointer font-semibold">{it.q}</summary>
              <p className="mt-3 text-sm opacity-80">{it.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CtaBlock({ props }: { props: Props }) {
  const headline = get<string>(props, "headline", "");
  const subhead = get<string>(props, "subhead", "");
  const button = get<{ label: string; href: string } | undefined>(props, "button", undefined);
  return (
    <section className="px-6 py-20">
      <div
        className="mx-auto max-w-5xl rounded-3xl border border-current/10 px-8 py-16 text-center"
        style={{ background: "color-mix(in oklab, var(--zs-primary) 8%, transparent)" }}
      >
        <h2 className="text-3xl md:text-4xl font-bold">{headline}</h2>
        {subhead ? <p className="mt-4 opacity-80">{subhead}</p> : null}
        {button ? (
          <a
            href={button.href || "#"}
            className="mt-8 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold"
            style={{ background: "var(--zs-primary)", color: "var(--zs-bg)" }}
          >
            {button.label}
          </a>
        ) : null}
      </div>
    </section>
  );
}

function MarkdownLite({ source }: { source: string }) {
  // Minimal markdown renderer: ## headings, **bold**, paragraphs, lists.
  const lines = source.split("\n");
  const parts: React.ReactNode[] = [];
  let listBuf: string[] = [];
  function flushList() {
    if (listBuf.length === 0) return;
    parts.push(
      <ul key={parts.length} className="my-4 list-disc pl-6 space-y-1">
        {listBuf.map((li, i) => (
          <li key={i}>{renderInline(li)}</li>
        ))}
      </ul>,
    );
    listBuf = [];
  }
  function renderInline(s: string): React.ReactNode {
    const out: React.ReactNode[] = [];
    const re = /\*\*([^*]+)\*\*/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) out.push(s.slice(last, m.index));
      out.push(<strong key={out.length}>{m[1]}</strong>);
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  }
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      flushList();
      parts.push(
        <h2 key={parts.length} className="text-2xl font-bold mt-8 mb-3">
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith("# ")) {
      flushList();
      parts.push(
        <h1 key={parts.length} className="text-3xl font-bold mt-8 mb-3">
          {line.slice(2)}
        </h1>,
      );
    } else if (/^- /.test(line)) {
      listBuf.push(line.slice(2));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      parts.push(
        <p key={parts.length} className="my-3 leading-relaxed">
          {renderInline(line)}
        </p>,
      );
    }
  }
  flushList();
  return <>{parts}</>;
}

export function TextBlock({ props }: { props: Props }) {
  const md = get<string>(props, "markdown", "");
  return (
    <section className="px-6 py-12">
      <div className="mx-auto max-w-3xl prose-invert">
        <MarkdownLite source={md} />
      </div>
    </section>
  );
}

export function ImageBlock({ props }: { props: Props }) {
  const src = get<string>(props, "src", "");
  const alt = get<string>(props, "alt", "");
  const caption = get<string>(props, "caption", "");
  return (
    <section className="px-6 py-12">
      <div className="mx-auto max-w-4xl">
        {src ? (
          <img src={src} alt={alt} className="w-full rounded-2xl" />
        ) : (
          <div className="aspect-video w-full rounded-2xl border border-dashed border-current/30 flex items-center justify-center text-sm opacity-60">
            Add an image source
          </div>
        )}
        {caption ? (
          <p className="mt-3 text-center text-sm opacity-70">{caption}</p>
        ) : null}
      </div>
    </section>
  );
}

export function GalleryBlock({ props }: { props: Props }) {
  const images = get<{ src: string; alt: string }[]>(props, "images", []);
  return (
    <section className="px-6 py-12">
      <div className="mx-auto max-w-6xl grid gap-4 grid-cols-2 md:grid-cols-4">
        {images.map((im, i) =>
          im.src ? (
            <img key={i} src={im.src} alt={im.alt} className="rounded-xl" />
          ) : (
            <div
              key={i}
              className="aspect-square rounded-xl border border-dashed border-current/30 flex items-center justify-center text-xs opacity-60"
            >
              {im.alt || `Photo ${i + 1}`}
            </div>
          ),
        )}
      </div>
    </section>
  );
}

export function LeadFormBlock({
  props,
  ctx,
}: {
  props: Props;
  ctx: RenderContext;
}) {
  const title = get<string>(props, "title", "");
  const subtitle = get<string>(props, "subtitle", "");
  const fields = get<
    { name: string; label: string; type: string; required: boolean }[]
  >(props, "fields", []);
  const submitLabel = get<string>(props, "submitLabel", "Send");
  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const submitLead = useSubmitLead();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (ctx.isPreview) {
      toast.message("Preview mode — submission disabled");
      return;
    }
    const email = values.email ?? Object.entries(values).find(([k]) => /email/i.test(k))?.[1];
    const wallet =
      values.wallet ??
      values.walletAddress ??
      Object.entries(values).find(([k]) => /wallet/i.test(k))?.[1];
    try {
      await submitLead.mutateAsync({
        siteId: ctx.siteId,
        data: {
          email: email && email.length > 0 ? email : undefined,
          walletAddress: wallet && wallet.length > 0 ? wallet : undefined,
          fields: values,
        },
      });
      setDone(true);
      toast.success("Thanks! We'll be in touch.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-xl rounded-2xl border border-current/10 p-8">
        {title ? <h2 className="text-2xl font-bold">{title}</h2> : null}
        {subtitle ? <p className="mt-2 opacity-80">{subtitle}</p> : null}
        {done ? (
          <div className="mt-6 rounded-xl border border-current/10 p-4 text-sm">
            Got it — thanks for reaching out.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {fields.map((f, i) => (
              <div key={i} className="space-y-1">
                <label className="text-xs uppercase tracking-wider opacity-70">
                  {f.label} {f.required ? "*" : ""}
                </label>
                {f.type === "textarea" ? (
                  <Textarea
                    required={f.required}
                    value={values[f.name] ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [f.name]: e.target.value }))
                    }
                  />
                ) : (
                  <Input
                    type={f.type === "email" ? "email" : "text"}
                    required={f.required}
                    value={values[f.name] ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [f.name]: e.target.value }))
                    }
                  />
                )}
              </div>
            ))}
            <Button
              type="submit"
              className="w-full"
              disabled={submitLead.isPending}
            >
              {submitLabel}
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}

export function CryptoCheckoutBlock({
  props,
  ctx,
}: {
  props: Props;
  ctx: RenderContext;
}) {
  const productName = get<string>(props, "productName", "Premium");
  const description = get<string>(props, "description", "");
  const asset = get<string>(props, "asset", "zusd");
  const amount = get<string>(props, "amount", "0");
  const recipientAddress =
    (get<string>(props, "recipientAddress", "") || ctx.ownerWallet) ?? "";
  const chainId = get<number>(props, "chainId", 7777);
  const buttonLabel = get<string>(
    props,
    "buttonLabel",
    `Pay ${amount} ${asset.toUpperCase()}`,
  );
  const [open, setOpen] = useState(false);

  return (
    <section className="px-6 py-20">
      <div
        className="mx-auto max-w-xl rounded-2xl border border-current/10 p-8 text-center"
        style={{ background: "color-mix(in oklab, var(--zs-primary) 6%, transparent)" }}
      >
        <ShieldCheck className="mx-auto mb-4 h-8 w-8 opacity-80" />
        <h2 className="text-2xl font-bold">{productName}</h2>
        {description ? <p className="mt-2 opacity-80">{description}</p> : null}
        <div className="mt-6">
          <div className="text-4xl font-bold">
            {amount} {asset.toUpperCase()}
          </div>
          <div className="text-xs opacity-70 mt-1">on Zebvix L1</div>
        </div>
        <Button
          className="mt-8"
          size="lg"
          onClick={() => {
            if (ctx.isPreview) {
              toast.message("Preview mode — checkout disabled");
              return;
            }
            setOpen(true);
          }}
          disabled={!recipientAddress && !ctx.isPreview}
        >
          {buttonLabel}
        </Button>
        {!recipientAddress ? (
          <div className="mt-3 text-xs opacity-60">
            Owner has not set a payout wallet yet.
          </div>
        ) : null}
      </div>
      {!ctx.isPreview ? (
        <CryptoCheckoutModal
          open={open}
          onOpenChange={setOpen}
          siteId={ctx.siteId}
          productName={productName}
          description={description}
          asset={asset}
          amount={amount}
          recipientAddress={recipientAddress}
          chainId={chainId}
        />
      ) : null}
    </section>
  );
}

export function FooterBlock({ props }: { props: Props }) {
  const tagline = get<string>(props, "tagline", "");
  const columns = get<
    { title: string; links: { label: string; href: string }[] }[]
  >(props, "columns", []);
  const copyright = get<string>(props, "copyright", "");
  return (
    <footer className="border-t border-current/10 px-6 py-12">
      <div className="mx-auto max-w-6xl grid gap-8 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="text-sm opacity-80">{tagline}</p>
        </div>
        {columns.map((c, i) => (
          <div key={i}>
            <div className="text-sm font-semibold mb-3">{c.title}</div>
            <ul className="space-y-2">
              {(c.links ?? []).map((l, j) => (
                <li key={j}>
                  <a
                    href={l.href || "#"}
                    className="text-sm opacity-70 hover:opacity-100"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-8 max-w-6xl text-xs opacity-60">{copyright}</div>
    </footer>
  );
}
