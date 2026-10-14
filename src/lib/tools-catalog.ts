/**
 * ARAÇ KATALOĞU — public (/tools) sayfası ile uygulamanın ortak gerçeği.
 *
 * NEDEN VAR: /tools sayfası araçları tanıtmak için yazıldı, ama araç listesi
 * başka bir yerde elle tutulursa kaçınılmaz olarak koddan kopar: sunucuya yeni
 * bir `ToolId` eklenir, tanıtım sayfası onu göstermez (ya da kaldırılan bir
 * aracı göstermeye devam eder). Bu dosya listeyi TEK yerde tutar.
 *
 * SÖZLEŞME (test: `tools-catalog.test.ts`):
 *   - `TOOL_HUBS` içindeki kimliklerin birleşimi, `tools-prompts.server.ts`
 *     içindeki `ToolId` listesiyle BİREBİR aynı olmalıdır. Araya yeni araç
 *     eklenip buraya yazılmazsa test kırmızıya döner.
 *   - Aynı araç iki modülde birden görünemez (rota çakışması olurdu).
 *
 * `route`: aracın gerçekten çalıştığı ekran. Public sayfa bu rotaya link verir;
 * giriş yapmamış ziyaretçiyi uygulamanın kendi kapısı (`ProRouteGate`) karşılar.
 *
 * Metinler (başlık/özet/araç adları) public sayfanın DOM'unda görünür; altı dil
 * karşılıkları `auto-i18n/public-copy.ts` içinde tutulur ve `public-copy.test.ts`
 * bu dosyayı kaynak olarak tarar.
 */
import type { ToolId } from "./tools-prompts.server";

export type ToolEntry = {
  id: ToolId;
  /** Uygulamadaki araç kartıyla aynı ad. */
  label: string;
};

/**
 * Araç ekranlarının gerçek rotaları. Bilerek literal birleşim (union): public
 * sayfadaki link yanlış yazılırsa derleme değil, sayfa ölü link verirdi.
 */
export type ToolRoute =
  "/tools/sourcing" | "/tools/finance" | "/tools/growth" | "/tools/listing" | "/news";

export type ToolHub = {
  /** Modül kimliği; public sayfada anchor/link hedefi. */
  id: string;
  emoji: string;
  title: string;
  summary: string;
  /** Aracın gerçekten çalıştığı ekran. */
  route: ToolRoute;
  tools: ToolEntry[];
};

export const TOOL_HUBS: ToolHub[] = [
  {
    id: "sourcing",
    emoji: "📦",
    title: "Sourcing & Factory Hub",
    summary:
      "Fabrika pazarlığından tedarikçi doğrulamaya kadar sourcing sürecini tek akışta yönet.",
    route: "/tools/sourcing",
    tools: [
      { id: "supplier-negotiator", label: "AI Supplier Negotiator" },
      { id: "offer-analyzer", label: "Supplier Offer Analyzer" },
      { id: "legitimacy-detector", label: "Supplier Legitimacy Detector" },
      { id: "review-spec-sheet", label: "Review ➔ Spec Sheet" },
      { id: "compliance-check", label: "Pazaryeri Uyum & Gating Denetçisi" },
    ],
  },
  {
    id: "finance",
    emoji: "💰",
    title: "Financial & Cost Engine",
    summary: "Depoziti göndermeden gerçek maliyeti, gereken sermayeyi ve ödeme riskini hesapla.",
    route: "/tools/finance",
    tools: [
      { id: "reverse-cost", label: "Reverse Cost Engineer" },
      { id: "landed-cost", label: "Landed Cost Calculator" },
      { id: "capital-planner", label: "Minimum Capital Planner" },
      { id: "desi-optimizer", label: "Packaging & Desi Optimizer" },
      { id: "milestone-shield", label: "Supplier Milestone Shield" },
      { id: "hs-classifier", label: "HS Kodu & Gümrük Vergisi" },
    ],
  },
  {
    id: "growth",
    emoji: "🚀",
    title: "Growth & Market AI",
    summary: "Ürünü üç motorla puanla, sepeti büyüt, stok tarihini kaçırma, rakip reklamını çöz.",
    route: "/tools/growth",
    tools: [
      { id: "consensus", label: "Multi-AI Consensus Score" },
      { id: "bundle-booster", label: "Bundle & AOV Booster" },
      { id: "lead-time", label: "Lead-Time Countdown" },
      { id: "arbitrage-matrix", label: "Arbitrage Matrix" },
      { id: "ad-hook-extractor", label: "Competitor Ad Hook Extractor" },
      { id: "competitor-intel", label: "Rakip İlan İstihbaratı" },
    ],
  },
  {
    id: "listing",
    emoji: "📝",
    title: "Listing & Conversion Studio",
    summary:
      "Trafiği satışa çeviren katman: arama görünürlüğü, görsel brief, yorum sinyali ve fiyat stratejisi.",
    route: "/tools/listing",
    tools: [
      { id: "listing-seo", label: "Listing SEO Optimizer" },
      { id: "listing-visual", label: "Görsel & A+ İçerik Brief" },
      { id: "review-sentiment", label: "Yorum Sentiment Radarı" },
      { id: "price-strategy", label: "Fiyat & Buy Box Stratejisi" },
    ],
  },
  {
    id: "news",
    emoji: "📰",
    title: "E-Com News Explainer",
    summary: "Sektör haberini ürün ve fiyat kararına bağlayan açıklayıcı katman.",
    route: "/news",
    tools: [{ id: "news", label: "News & AI Explainer" }],
  },
];

/** Katalogdaki tüm araçlar (modül sırası korunur). */
export const ALL_TOOL_ENTRIES: ToolEntry[] = TOOL_HUBS.flatMap((hub) => hub.tools);

/** Araç sayısı — test ve arayüz aynı sayıyı okur. */
export const TOOL_ENTRY_COUNT = ALL_TOOL_ENTRIES.length;
