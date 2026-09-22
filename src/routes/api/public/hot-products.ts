import { createFileRoute } from "@tanstack/react-router";
import { guardPublic } from "@/lib/api-guard.server";
import type { HotProduct, ProductSignals } from "@/lib/hot-products";

/**
 * Live "most sellable right now" feed.
 *
 * 100% real-world data: Google-Search-grounded Gemini scan, refreshed once per
 * hour. Önemli: istek ASLA taramanın bitmesini uzun süre beklemez. Taramaya sert
 * bir zaman bütçesi uygulanır (`SCAN_WAIT_MS`, varsayılan 7 sn, üst sınır 25 sn);
 * bütçe aşılırsa istek anında bayat (stale) veri ya da `status: "warming"` ile
 * boş liste döner, tarama arka planda tamamlanıp önbelleğe yazılır.
 *
 * NOT: Vercel Hobby'de fonksiyon limiti artık **300 sn**'dir (fluid compute ile
 * varsayılan ve üst sınır); eski "60 sn" kuralı geçersizdir. Yine de bu uç
 * kasten kısa bekler: kullanıcı canlı ürünleri saniyeler içinde görmelidir.
 */

type Payload = {
  hour: string;
  refreshed_at: string;
  next_refresh_at: string;
  items: HotProduct[];
  niche?: string;
  status?: "ready" | "stale" | "warming";
};

const cache = new Map<string, Payload>();
const inflight = new Map<string, Promise<Payload>>();

/**
 * İstek içinde taramayı beklemek için sert üst sınır.
 *
 * Bu sayı KISA tutulur: tarama tipik olarak 20-40 sn sürer, kullanıcıyı bu
 * kadar bekletmek yerine eldeki gerçek veriyi hemen verip taze taramayı arka
 * planda başlatmak yeğlenir (bkz. `getPayload`). Değer yalnızca hiç önbellek
 * yokken ilk boyama gecikmesini sınırlar; istemci `warming`/`stale` durumunda
 * kısa aralıkla yoklar.
 */
const SCAN_WAIT_MS = Math.max(
  2_000,
  Math.min(25_000, Number(process.env["HOT_PRODUCTS_WAIT_MS"] ?? 7_000)),
);

/**
 * Kalıcı (Supabase `ai_cache`) önbellek anahtarı.
 *
 * Kritik: sunucusuz çalıştırmada `cache` Map'i örnek (instance) başına ve
 * geçicidir; soğuk örnekte boş olduğu için "Product Finger" her seferinde
 * taramayı baştan bekliyordu. Kalıcı katman sayesinde BİR kez tamamlanan tarama
 * tüm örneklerde ve tüm ziyaretçilerde anında servis edilir.
 */
function persistKey(niche: string): string {
  return `hot-products:v2:${niche.trim().toLowerCase() || "all"}`;
}

/** Taramayı mümkün olduğunca kalıcı katmana da yazar (en iyi çaba). */
async function persistPayload(niche: string, payload: Payload): Promise<void> {
  if (!payload.items.length) return;
  try {
    const { cacheSet } = await import("@/lib/ai-cache.server");
    await cacheSet(persistKey(niche), "hot-products", payload);
  } catch (e) {
    console.error("Hot products persist failed", e);
  }
}

/** Kalıcı katmandan son gerçek taramayı okur (bayat olsa da kullanılır). */
async function readPersisted(niche: string): Promise<Payload | null> {
  try {
    const { cacheGet } = await import("@/lib/ai-cache.server");
    const hit = await cacheGet<Payload>(persistKey(niche));
    return hit && Array.isArray(hit.items) && hit.items.length ? hit : null;
  } catch {
    return null;
  }
}

function hourKey(d = new Date()) {
  return d.toISOString().slice(0, 13);
}

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

const FLAGS: Record<string, string> = {
  US: "🇺🇸",
  UK: "🇬🇧",
  GB: "🇬🇧",
  DE: "🇩🇪",
  FR: "🇫🇷",
  TR: "🇹🇷",
  ES: "🇪🇸",
  IT: "🇮🇹",
  NL: "🇳🇱",
  CA: "🇨🇦",
  AU: "🇦🇺",
  AE: "🇦🇪",
  SA: "🇸🇦",
  BR: "🇧🇷",
  MX: "🇲🇽",
  JP: "🇯🇵",
  KR: "🇰🇷",
  IN: "🇮🇳",
  PL: "🇵🇱",
  SE: "🇸🇪",
};

/** Keeps a reported number only when it is a real, finite, positive value. */
function pnum(v: unknown, max = Number.MAX_SAFE_INTEGER): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, max);
}

function normalizeSignals(raw: any): ProductSignals | undefined {
  const s = raw ?? {};
  const out: ProductSignals = {
    search_volume_monthly: pnum(s.search_volume_monthly),
    social_views_now: pnum(s.social_views_now),
    social_views_7d_ago: pnum(s.social_views_7d_ago),
    active_stores: pnum(s.active_stores, 5000),
    ads_running_14d: pnum(s.ads_running_14d, 5000),
    amazon_sellers: pnum(s.amazon_sellers, 5000),
    review_count: pnum(s.review_count),
    quality_complaint_pct: pnum(s.quality_complaint_pct, 100),
    sizing_complaint_pct: pnum(s.sizing_complaint_pct, 100),
    shipping_complaint_pct: pnum(s.shipping_complaint_pct, 100),
    on_time_delivery_pct: pnum(s.on_time_delivery_pct, 100),
    stock_stability_pct: pnum(s.stock_stability_pct, 100),
    lead_time_days: pnum(s.lead_time_days, 120),
    cpc_usd: pnum(s.cpc_usd, 50),
    cvr_pct: pnum(s.cvr_pct, 30),
    sources: Array.isArray(s.sources) ? s.sources.slice(0, 6).map(String) : undefined,
  };
  for (const k of Object.keys(out) as Array<keyof ProductSignals>) {
    if (out[k] === undefined) delete out[k];
  }
  return Object.keys(out).length ? out : undefined;
}

function normalize(raw: any, i: number): HotProduct | null {
  const name = String(raw?.name ?? "").trim();
  if (!name) return null;
  const country = String(raw?.country ?? "US")
    .toUpperCase()
    .slice(0, 3);
  const comp = String(raw?.competition ?? "Medium");
  return {
    id: `${slug(name)}-${i}`,
    name: name.slice(0, 90),
    why_now: String(raw?.why_now ?? "").slice(0, 240),
    country,
    country_flag: FLAGS[country] ?? "🌍",
    marketplace: String(raw?.marketplace ?? "Shopify"),
    budget_usd: String(raw?.budget_usd ?? "$500 - $1,500"),
    supplier_cost_usd: String(raw?.supplier_cost_usd ?? "—"),
    retail_price_usd: String(raw?.retail_price_usd ?? "—"),
    margin_pct: Math.max(0, Math.min(95, Math.round(Number(raw?.margin_pct) || 0))),
    demand_signal: String(raw?.demand_signal ?? "").slice(0, 220),
    competition: comp === "Low" || comp === "High" ? comp : "Medium",
    audience: String(raw?.audience ?? "").slice(0, 160),
    ad_angle: String(raw?.ad_angle ?? "").slice(0, 220),
    sourcing: String(raw?.sourcing ?? "AliExpress / 1688"),
    lead_time: String(raw?.lead_time ?? "8-15 days"),
    first_week_plan: Array.isArray(raw?.first_week_plan)
      ? raw.first_week_plan.slice(0, 6).map(String)
      : [],
    risks: Array.isArray(raw?.risks) ? raw.risks.slice(0, 4).map(String) : [],
    score: Math.max(0, Math.min(100, Math.round(Number(raw?.score) || 70))),
    signals: normalizeSignals(raw?.signals),
  };
}

function nextHour(now: Date): string {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next.toISOString();
}

function emptyPayload(niche: string): Payload {
  const now = new Date();
  return {
    hour: hourKey(now),
    refreshed_at: now.toISOString(),
    next_refresh_at: nextHour(now),
    items: [],
    ...(niche ? { niche } : {}),
  };
}

async function build(niche: string): Promise<Payload> {
  const { callAiMesh, extractJson } = await import("@/lib/ai.server");
  const now = new Date();
  const focus = niche
    ? `NICHE FOCUS: every product must belong to the "${niche}" niche/category. If the niche is narrow, still return the 10 strongest real SKUs inside it.`
    : `NICHE FOCUS: none — cover a spread of niches, countries and marketplaces.`;

  const prompt = `You are a live e-commerce market scanner with web access. Using CURRENT real web data (${now.toISOString().slice(0, 10)}, hour ${now.getUTCHours()}:00 UTC), list the 10 products that are MOST SELLABLE RIGHT NOW for a dropshipper/e-commerce seller.

${focus}

Rules:
- Real, specific, nameable SKUs currently selling online. No categories, no invented items.
- Use real supplier price bands (AliExpress/1688/CJ) and real retail bands.
- Pick the single best COUNTRY market and the single best MARKETPLACE/channel for each.
- State the realistic STARTING BUDGET (USD range) needed to launch it profitably.
- "signals" must contain measured, web-evidenced numbers. OMIT any signal field you cannot ground in real data — never guess, never fill a placeholder. List the domains you used in signals.sources.

Return ONLY JSON:
{"items":[{"name":string,"why_now":string,"country":string (2-letter ISO code),"marketplace":string,"budget_usd":string (e.g. "$800 - $2,000"),"supplier_cost_usd":string,"retail_price_usd":string,"margin_pct":number,"demand_signal":string (real search/social/marketplace evidence),"competition":"Low"|"Medium"|"High","audience":string,"ad_angle":string,"sourcing":string,"lead_time":string,"first_week_plan":string[4],"risks":string[3],"score":number 1-100,
"signals":{"search_volume_monthly":number,"social_views_now":number,"social_views_7d_ago":number,"active_stores":number,"ads_running_14d":number,"amazon_sellers":number,"review_count":number,"quality_complaint_pct":number,"sizing_complaint_pct":number,"shipping_complaint_pct":number,"on_time_delivery_pct":number,"stock_stability_pct":number,"lead_time_days":number,"cpc_usd":number,"cvr_pct":number,"sources":string[]}}]}`;

  // Çok motorlu yol: zeminli Gemini (canlı web verisi) → cevap vermezse JSON
  // modunda TÜM anahtar havuzu. Eskiden yalnız Gemini çağrılıyordu; anahtar
  // kotaya takılınca uç nokta sessizce BOŞ liste döndürüyordu.
  const parseItems = (text: string) => {
    const parsed = extractJson<{ items?: any[] }>(text, { items: [] });
    return (parsed.items ?? [])
      .map((r, i) => normalize(r, i))
      .filter((x): x is HotProduct => !!x)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  };

  let items = parseItems(
    await callAiMesh(prompt, { temperature: 0.6, grounded: true, models: ["gemini-flash-latest"] }),
  );
  // Boş ya da tek ürünlük yanıt geldiyse daha kısa/kuralı gevşek bir tur daha
  // denenir — "bir ürün bulup bırakmak" ekranı boş bırakmaktan kötüdür.
  if (items.length < 3) {
    const relaxed = `${prompt}\n\nIf web grounding is unavailable, answer from your own knowledge of currently selling products. Still return 10 items in the same JSON shape.`;
    const retry = parseItems(await callAiMesh(relaxed, { temperature: 0.7, grounded: false }));
    if (retry.length > items.length) items = retry;
  }

  return {
    hour: hourKey(now),
    refreshed_at: now.toISOString(),
    next_refresh_at: nextHour(now),
    items,
    ...(niche ? { niche } : {}),
  };
}

/** Arka planda tarama başlatır (aynı niş için tek sefer). */
function startScan(cacheKey: string, niche: string): Promise<Payload> {
  const pending = inflight.get(cacheKey);
  if (pending) return pending;
  const p = build(niche)
    .then(async (payload) => {
      if (payload.items.length) {
        cache.set(cacheKey, payload);
        if (cache.size > 40) cache.delete(cache.keys().next().value as string);
        // Kalıcı katman: sunucusuzda örnek değişse bile aynı tarama yeniden
        // kullanılır, yani tarama başına bir kez AI çağrısı yapılır.
        await persistPayload(cacheKey, payload);
      }
      return payload;
    })
    .finally(() => {
      inflight.delete(cacheKey);
    });
  inflight.set(cacheKey, p);
  // Arka planda biten taramanın hatası isteği düşürmesin.
  p.catch((e) => console.error("Hot products background scan failed", e));
  return p;
}

/** Verilen süre içinde bitmezse reddeden yardımcı (tarama arka planda sürer). */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("scan-timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function getPayload(niche: string): Promise<Payload> {
  const cacheKey = niche.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached?.items.length && cached.hour === hourKey()) return { ...cached, status: "ready" };

  const scan = startScan(cacheKey, niche);
  // Elimizde geçen saatin verisi varsa beklemeden onu dön; yenisi arka planda gelir.
  if (cached?.items.length) return { ...cached, status: "stale" };

  // Bu örnekte ısınma yok: kalıcı katmana bak. Bir kez tamamlanmış tarama
  // varsa (başka örnek/ziyaretçi üretmiş olabilir) ANINDA onu döneriz ve
  // taze tarama arka planda sürer. Böylece "Product Finger" dakikalarca
  // boş ekran göstermez — gerçek (bayat işaretli) veri ilk saniyede gelir.
  const persisted = await readPersisted(cacheKey);
  if (persisted?.items.length) {
    if (persisted.hour === hourKey()) {
      cache.set(cacheKey, persisted);
      return { ...persisted, status: "ready" };
    }
    cache.set(cacheKey, persisted);
    return { ...persisted, status: "stale", refreshed_at: persisted.refreshed_at };
  }

  try {
    const fresh = await withDeadline(scan, SCAN_WAIT_MS);
    return { ...fresh, status: fresh.items.length ? "ready" : "warming" };
  } catch {
    return { ...emptyPayload(niche), status: "warming" };
  }
}

export const Route = createFileRoute("/api/public/hot-products")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const limited = await guardPublic(request, "hot-products", 40, 60);
        if (limited) return limited;
        const niche = (new URL(request.url).searchParams.get("niche") ?? "").slice(0, 60).trim();
        try {
          const payload = await getPayload(niche);
          const fresh = payload.status === "ready";
          return new Response(JSON.stringify(payload), {
            headers: {
              "Content-Type": "application/json",
              // Isınma/bayat yanıtlar kısa süre önbelleklenir ki istemci kısa
              // sürede tazesini alabilsin.
              "Cache-Control": fresh
                ? "public, max-age=600, s-maxage=3600"
                : "public, max-age=15, s-maxage=15",
            },
          });
        } catch (e) {
          console.error("Hot products scan failed", e);
          return new Response(
            JSON.stringify({
              items: [],
              status: "warming",
              error: "Market scan temporarily unavailable",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
            },
          );
        }
      },
    },
  },
});
