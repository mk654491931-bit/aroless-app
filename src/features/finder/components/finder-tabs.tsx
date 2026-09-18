import { useEffect, useState } from "react";
import { useMutation, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, Search, Wand2, Megaphone, Film, Loader2, Bookmark, Download, HeartOff, Target, ExternalLink } from "lucide-react";
import { CreditCost } from "@/components/credit-cost";
import { buyersPer1000 } from "@/lib/consistency";
import type { Platform, SeoKit, CreativeScript, FavoriteRow } from "@/lib/gemini.functions";
import { PLATFORMS } from "@/lib/gemini.functions";
import { setRunRef } from "../utils/seo-creative-bridge";
import { buildShopifyCsv, downloadFile, netMarginView } from "../utils/export";

function CopyButton({ text, label, compact }: { text: string; label?: string; compact?: boolean }) {
  const [ok, setOk] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setOk(true);
      setTimeout(() => setOk(false), 1200);
    } catch {
      toast.error("Copy failed");
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className={`text-[11px] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground ${compact ? "" : "mt-3"}`}
    >
      {ok ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />} {label ?? (ok ? "Copied" : "Copy")}
    </button>
  );
}

function KitBlock({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="glass rounded-xl p-5">
      <div className="text-sm font-semibold mb-3">{title}</div>
      <ul className="space-y-2">
        {items.map((t, i) => (
          <li key={i} className="flex items-start justify-between gap-3 text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-2">
            <span>{t}</span>
            <CopyButton text={t} compact />
          </li>
        ))}
      </ul>
    </div>
  );
}

function KitView({ kit }: { kit: SeoKit }) {
  return (
    <div className="space-y-6">
      <KitBlock title="SEO Product Titles" items={kit.titles ?? []} />
      <KitBlock title="Meta Descriptions" items={kit.meta_descriptions ?? []} />
      {kit.keywords?.length > 0 && (
        <div className="glass rounded-xl p-5">
          <div className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Search size={14} /> SEO Keywords
          </div>
          <div className="flex flex-wrap gap-1.5">
            {kit.keywords.map((k, i) => (
              <span key={i} className="text-xs bg-white/5 border border-white/10 rounded-full px-2.5 py-1">
                {k}
              </span>
            ))}
          </div>
          <CopyButton text={kit.keywords.join(", ")} label="Copy all keywords" />
        </div>
      )}
      {kit.ad_copy?.length > 0 && (
        <div className="glass rounded-xl p-5">
          <div className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Megaphone size={14} /> Platform Ad Copy
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {kit.ad_copy.map((a, i) => (
              <div key={i} className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-wider text-[oklch(0.68_0.15_255)] mb-1">{a.platform}</div>
                <div className="text-sm font-semibold">{a.hook}</div>
                <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{a.primary}</p>
                <div className="text-[11px] mt-2 inline-block rounded-full bg-gradient-to-r from-[oklch(0.62_0.17_255)]/25 to-[oklch(0.52_0.15_262)]/25 border border-white/10 px-2 py-0.5">
                  CTA: {a.cta}
                </div>
                <CopyButton text={`${a.hook}\n\n${a.primary}\n\n${a.cta}`} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SeoTab({
  seoFn,
  onOutOfCredits,
  qc,
}: {
  seoFn: (opts: { data: { product: string; audience: string; platform: Platform } }) => Promise<SeoKit>;
  onOutOfCredits: () => void;
  qc: QueryClient;
}) {
  const [product, setProduct] = useState("");
  const [audience, setAudience] = useState("");
  const [platform, setPlatform] = useState<Platform>("Shopify");
  const [kit, setKit] = useState<SeoKit | null>(null);

  const mut = useMutation({
    mutationFn: (v: { product: string; audience: string; platform: Platform }) => seoFn({ data: v }),
    onSuccess: (res) => {
      setKit(res);
      qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success("SEO kit generated!");
    },
    onError: (err: Error) => {
      if (err.message.includes("NO_CREDITS")) {
        toast.error("Out of credits.");
        onOutOfCredits();
      } else toast.error(err.message);
    },
  });

  useEffect(() => {
    setRunRef("seo", (name: string) => {
      setProduct(name);
      mut.mutate({ product: name, audience, platform });
    });
    return () => setRunRef("seo", null);
  }, [mut, audience, platform]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!product.trim()) return toast.error("Enter a product");
    mut.mutate({ product, audience, platform });
  };

  return (
    <>
      <div className="text-center mb-8">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
          <span className="text-gradient">SEO & Marketing</span> Tools
        </h1>
        <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
          Generate high-converting titles, meta descriptions, keywords, and platform-specific ad copy.
        </p>
        <div className="mt-3">
          <CreditCost amount={1} label="Her üretim 1 kredi" />
        </div>
      </div>

      <form onSubmit={onSubmit} className="glass rounded-2xl p-4 md:p-6 max-w-4xl mx-auto space-y-3">
        <div className="grid md:grid-cols-[1fr_1fr_180px] gap-3">
          <input
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="Product name (e.g. Portable Ice Maker XR-500)"
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
          />
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="Target audience (optional)"
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
          />
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
          >
            {PLATFORMS.map((p) => (
              <option key={p} className="bg-[oklch(0.20_0.035_255)]">
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={mut.isPending}
            className="rounded-lg bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-5 py-2.5 text-sm font-semibold text-white glow disabled:opacity-60 flex items-center gap-2"
          >
            {mut.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Generating…
              </>
            ) : (
              <>
                <Wand2 size={16} /> Generate Kit
              </>
            )}
          </button>
        </div>
      </form>

      <section className="mt-8 max-w-5xl mx-auto">
        {mut.isPending && (
          <div className="grid gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="glass rounded-xl h-40 animate-pulse" />
            ))}
          </div>
        )}
        {!mut.isPending && !kit && (
          <div className="text-center text-sm text-muted-foreground py-16">
            <Wand2 className="mx-auto mb-3 text-[oklch(0.68_0.15_255)]" />
            Enter a product to generate a complete SEO & ad-copy kit.
          </div>
        )}
        {!mut.isPending && kit && <KitView kit={kit} />}
      </section>
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}

function ScriptCard({ s }: { s: CreativeScript }) {
  const full = `${s.format} — ${s.title}\n\nHOOK:\n${s.hook}\n\nSTORYLINE:\n${s.storyline}\n\nVOICEOVER:\n${s.voiceover}\n\nVISUALS:\n${(s.visuals || []).map((v) => `• ${v}`).join("\n")}\n\nCTA: ${s.cta}\n\n${(s.hashtags || []).join(" ")}`;
  return (
    <article className="premium-card grain rounded-xl p-5 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider text-[oklch(0.68_0.15_255)] flex items-center gap-1">
          <Film size={12} /> {s.format}
        </div>
        <div className="text-[10px] rounded-full bg-white/5 border border-white/10 px-2 py-0.5">{s.duration_seconds}s</div>
      </div>
      <h3 className="font-bold text-lg leading-tight">{s.title}</h3>
      <div className="mt-3 space-y-3 text-sm">
        <Section label="Hook (0-2s)">
          <p className="font-semibold">{s.hook}</p>
        </Section>
        <Section label="Storyline">
          <p className="whitespace-pre-wrap text-muted-foreground">{s.storyline}</p>
        </Section>
        <Section label="Voiceover">
          <p className="whitespace-pre-wrap text-muted-foreground">{s.voiceover}</p>
        </Section>
        {s.visuals?.length > 0 && (
          <Section label="Visuals / Shot list">
            <ul className="space-y-1">
              {s.visuals.map((v, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  • {v}
                </li>
              ))}
            </ul>
          </Section>
        )}
        <div className="text-xs inline-block rounded-full bg-gradient-to-r from-[oklch(0.62_0.17_255)]/25 to-[oklch(0.52_0.15_262)]/25 border border-white/10 px-3 py-1">
          CTA: {s.cta}
        </div>
        {s.hashtags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {s.hashtags.map((h, i) => (
              <span key={i} className="text-[11px] bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
                {h.startsWith("#") ? h : `#${h}`}
              </span>
            ))}
          </div>
        )}
      </div>
      <CopyButton text={full} label="Copy full script" />
    </article>
  );
}

export function CreativeTab({
  scriptsFn,
  onOutOfCredits,
  qc,
}: {
  scriptsFn: (opts: { data: { product: string; audience: string; platform: Platform } }) => Promise<{ scripts: CreativeScript[] }>;
  onOutOfCredits: () => void;
  qc: QueryClient;
}) {
  const [product, setProduct] = useState("");
  const [audience, setAudience] = useState("");
  const [platform, setPlatform] = useState<Platform>("Shopify");
  const [scripts, setScripts] = useState<CreativeScript[]>([]);

  const mut = useMutation({
    mutationFn: (v: { product: string; audience: string; platform: Platform }) => scriptsFn({ data: v }),
    onSuccess: (res) => {
      setScripts(res.scripts);
      qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Scripts ready!");
    },
    onError: (err: Error) => {
      if (err.message.includes("NO_CREDITS")) {
        toast.error("Out of credits.");
        onOutOfCredits();
      } else toast.error(err.message);
    },
  });

  useEffect(() => {
    setRunRef("creative", (name: string) => {
      setProduct(name);
      mut.mutate({ product: name, audience, platform });
    });
    return () => setRunRef("creative", null);
  }, [mut, audience, platform]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!product.trim()) return toast.error("Enter a product");
    mut.mutate({ product, audience, platform });
  };

  return (
    <>
      <div className="text-center mb-8">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
          <span className="text-gradient">Creative Studio</span>
        </h1>
        <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
          Viral TikTok & Instagram Reels scripts — hook, storyline, visuals, and CTA, ready to shoot.
        </p>
        <div className="mt-3">
          <CreditCost amount={1} label="Her üretim 1 kredi" />
        </div>
      </div>

      <form onSubmit={onSubmit} className="glass rounded-2xl p-4 md:p-6 max-w-4xl mx-auto space-y-3">
        <div className="grid md:grid-cols-[1fr_1fr_180px] gap-3">
          <input
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder="Product name"
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
          />
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="Audience (optional)"
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
          />
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm outline-none focus:border-[oklch(0.62_0.17_255)]"
          >
            {PLATFORMS.map((p) => (
              <option key={p} className="bg-[oklch(0.20_0.035_255)]">
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={mut.isPending}
            className="rounded-lg bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-5 py-2.5 text-sm font-semibold text-white glow disabled:opacity-60 flex items-center gap-2"
          >
            {mut.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Writing…
              </>
            ) : (
              <>
                <Film size={16} /> Generate Scripts
              </>
            )}
          </button>
        </div>
      </form>

      <section className="mt-8 max-w-5xl mx-auto">
        {mut.isPending && (
          <div className="grid md:grid-cols-2 gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="glass rounded-xl h-80 animate-pulse" />
            ))}
          </div>
        )}
        {!mut.isPending && scripts.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-16">
            <Film className="mx-auto mb-3 text-[oklch(0.68_0.15_255)]" />
            Enter a product to generate viral short-form video scripts.
          </div>
        )}
        {!mut.isPending && scripts.length > 0 && (
          <div className="grid md:grid-cols-2 gap-4">
            {scripts.map((s, i) => (
              <ScriptCard key={i} s={s} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  highlight,
  danger,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-2 ${danger ? "bg-destructive/15 border-destructive/40" : highlight ? "bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 border-emerald-500/20" : "bg-white/5 border-white/10"}`}
    >
      <div className={`text-[10px] uppercase ${danger ? "text-destructive" : highlight ? "text-emerald-300/80" : "text-muted-foreground"}`}>
        {label}
      </div>
      <div className={`text-xs font-semibold mt-0.5 ${danger ? "text-destructive" : highlight ? "text-emerald-300" : ""}`}>{value}</div>
    </div>
  );
}

export function LibraryTab({
  favorites,
  loading,
  onDelete,
  onSeo,
  onCreative,
}: {
  favorites: FavoriteRow[];
  loading: boolean;
  onDelete: (id: string) => void;
  onSeo: (name: string) => void;
  onCreative: (name: string) => void;
}) {
  const exportCsv = () => {
    if (favorites.length === 0) return toast.error("No products to export");
    const csv = buildShopifyCsv(favorites.map((f) => f.product));
    downloadFile(csv, "aroless-shopify-products.csv", "text/csv;charset=utf-8;");
    toast.success(`Exported ${favorites.length} product${favorites.length === 1 ? "" : "s"}`);
  };

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            My <span className="text-gradient">Product Library</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Saved winners — export directly to Shopify.</p>
        </div>
        <button
          onClick={exportCsv}
          disabled={favorites.length === 0}
          className="rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-2.5 text-sm font-semibold text-white flex items-center gap-2 disabled:opacity-40 whitespace-nowrap self-start md:self-auto"
        >
          <Download size={16} /> Export to Shopify CSV
        </button>
      </div>

      {loading && (
        <div className="grid grid-cols-1 min-[430px]:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass rounded-xl h-56 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && favorites.length === 0 && (
        <div className="text-center text-sm text-muted-foreground py-16">
          <Bookmark className="mx-auto mb-3 text-[oklch(0.68_0.15_255)]" />
          Your library is empty. Tap the heart icon on any product to save it here.
        </div>
      )}

      {!loading && favorites.length > 0 && (
        <div className="grid grid-cols-1 min-[430px]:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {favorites.map((f) => {
            const p = f.product;
            return (
              <article key={f.id} className="premium-card grain card-lift rounded-xl p-5 flex flex-col hover:-translate-y-1">
                <div className="flex items-start justify-between mb-2">
                  <div className="text-3xl">{p.emoji || "🛍️"}</div>
                  <button
                    onClick={() => onDelete(f.id)}
                    className="p-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-rose-500/20 hover:border-rose-500/40 text-muted-foreground hover:text-rose-300"
                    title="Remove"
                  >
                    <HeartOff size={13} />
                  </button>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-white/10 bg-white/5 text-muted-foreground">
                    {f.collection_name || "Default"}
                  </span>
                  {f.tags?.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] px-1.5 py-0.5 rounded-full border border-[oklch(0.62_0.17_255)]/30 bg-[oklch(0.62_0.17_255)]/10 text-[oklch(0.78_0.13_255)]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <h3 className="font-bold text-lg leading-tight">{p.name}</h3>
                {f.notes && <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2">{f.notes}</p>}
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{p.description}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <Stat label="Supplier" value={p.supplier_price_usd} />
                  <Stat label="Sell" value={p.selling_price_usd} />
                  {(() => {
                    const nm = netMarginView(p);
                    return <Stat label="Margin" value={nm.text} highlight={!nm.bad} danger={nm.bad} />;
                  })()}
                </div>
                <div className="mt-2 flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1">
                    <Target size={11} /> Buyers / 1,000
                  </span>
                  <span className="text-sm font-black text-aurora">{buyersPer1000(p).value}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {p.supplier_links?.slice(0, 1).map((u, i) => (
                    <a
                      key={i}
                      href={u}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 px-2.5 py-1"
                    >
                      <ExternalLink size={10} /> AliExpress
                    </a>
                  ))}
                  {p.alibaba_links?.slice(0, 1).map((u, i) => (
                    <a
                      key={i}
                      href={u}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 px-2.5 py-1"
                    >
                      <ExternalLink size={10} /> Alibaba
                    </a>
                  ))}
                </div>
                <div className="mt-auto pt-4 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onSeo(p.name)}
                    className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Wand2 size={12} /> SEO Kit
                  </button>
                  <button
                    onClick={() => onCreative(p.name)}
                    className="rounded-lg border border-white/10 bg-gradient-to-r from-[oklch(0.62_0.17_255)]/20 to-[oklch(0.52_0.15_262)]/20 hover:from-[oklch(0.62_0.17_255)]/35 hover:to-[oklch(0.52_0.15_262)]/35 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Film size={12} /> Reels
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
