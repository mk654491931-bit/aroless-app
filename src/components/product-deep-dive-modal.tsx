import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Calculator,
  Download,
  FileText,
  Radar,
  Store,
  Swords,
  Target,
  X,
  Bot,
  Truck,
  Activity,
  Loader2,
  PackageSearch,
  ExternalLink,
} from "lucide-react";
import type { WinningProduct } from "@/lib/gemini.functions";
import { productSearchQuery } from "@/lib/sourcing-links";
import { buildProductCostBreakdown } from "@/lib/product-cost-breakdown";
import { calculateProfit } from "@/lib/profit-calculator";
import { ProductDeepDive } from "@/components/product-deep-dive";
import { CountryInfoBox } from "@/components/country-info-box";
import { CountryFlag } from "@/components/country-flag";
import { Sparkline } from "@/components/sparkline";
import { getMarketIntel } from "@/lib/market-data.functions";
import { useCountryMeta, useUsdRate } from "@/lib/rest-countries";
import { TARGET_COUNTRIES, countryByCode } from "@/lib/countries";

function Metric({
  label,
  value,
  tone = "",
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${tone}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[9px] text-muted-foreground/80">{hint}</div>}
    </div>
  );
}

/** Modelin İngilizce rekabet etiketini insan diline çevirir; yoksa "ölçülmedi" der. */
function competitionLabel(level?: string | null): string {
  switch ((level ?? "").trim().toLowerCase()) {
    case "low":
      return "Düşük";
    case "medium":
      return "Orta";
    case "high":
      return "Yüksek";
    default:
      return level?.trim() || "Ölçülmedi";
  }
}

/** Sayı varsa yazar; yoksa 0/uydurma sayı yerine açıkça "ölçülmedi" der. */
function measured(value: number | null | undefined, suffix = ""): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value}${suffix}` : "Ölçülmedi";
}

/** Radar-style bar chart of the market breakdown for the selected country. */
function MarketRadar({ bars }: { bars: { label: string; value: number }[] }) {
  return (
    <div className="space-y-2">
      {bars.map((b) => (
        <div key={b.label}>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{b.label}</span>
            <span className="text-foreground font-semibold">{Math.round(b.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)]"
              style={{ width: `${Math.max(2, Math.min(100, b.value))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProductDeepDiveModal({
  product,
  onClose,
  onSendToSimulator,
}: {
  product: WinningProduct | null;
  onClose: () => void;
  onSendToSimulator?: (p: WinningProduct) => void;
}) {
  const nav = useNavigate();
  const [country, setCountry] = useState(product?.hybrid?.target_country ?? "GLOBAL");
  const c = countryByCode(country);
  const meta = useCountryMeta(country);
  const localCur = meta.currency || c.currency;
  const rate = useUsdRate(localCur);
  const [showLocal, setShowLocal] = useState(false);

  const breakdown = useMemo(() => (product ? buildProductCostBreakdown(product) : null), [product]);

  const defaults = useMemo(() => {
    // ÖNEMLİ: burada varsayılan fiyat ÜRETİLMEZ. Eski kod satış fiyatı yoksa
    // $49, tedarik yoksa satışın %30'u, kargo yoksa $6 yazıyordu; kullanıcı
    // bunları ölçülmüş sanıyordu. Artık yoksa alan BOŞ kalır.
    const money = (v: unknown, allowZero = false): number | null => {
      if (v === null || v === undefined) return null;
      const raw = String(v).trim();
      if (raw === "") return null;
      const n = Number(raw.replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(n)) return null;
      if (n > 0) return n;
      return allowZero && n === 0 ? 0 : null;
    };
    return {
      price: money(product?.selling_price_usd),
      cogs: breakdown?.supplier.usd ?? money(product?.supplier_price_usd),
      // Kargo/komisyon/CAC: ölçülmüş değer varsa o, yoksa yayınlanmış
      // tarifelerden hesaplanmış model değeri. İkisi de kaynak etiketli.
      ship: breakdown?.shipping.usd ?? null,
      platformFee: breakdown?.platformFee.usd ?? null,
      ad: breakdown?.adSpend.usd ?? null,
    };
  }, [product, breakdown]);

  const [price, setPrice] = useState<number | "">(defaults.price ?? "");
  const [cogs, setCogs] = useState<number | "">(defaults.cogs ?? "");
  const [fees, setFees] = useState<number | "">(defaults.ship ?? "");
  const [platformFee, setPlatformFee] = useState<number | "">(defaults.platformFee ?? "");
  const [adCost, setAdCost] = useState<number | "">(defaults.ad ?? "");
  const [autoFilled, setAutoFilled] = useState(false);

  // Ürün değişince önceki ürünün fiyatları yeni ürüne taşınmasın.
  useEffect(() => {
    setPrice(defaults.price ?? "");
    setCogs(defaults.cogs ?? "");
    setFees(defaults.ship ?? "");
    setPlatformFee(defaults.platformFee ?? "");
    setAdCost(defaults.ad ?? "");
    setAutoFilled(false);
    setCountry(product?.hybrid?.target_country ?? "GLOBAL");
  }, [product, defaults]);

  // Arama sorgusu pazarlama dolgularından arındırılır; canlı kaynaklar
  // (Trends/AliExpress) ürünün gerçek kimliğiyle aranır.
  const intelQuery = productSearchQuery(product?.name ?? "");

  // Free external enrichment: Google Trends + AliExpress sourcing + Open Products Facts.
  const intelFn = useServerFn(getMarketIntel);
  const intel = useQuery({
    queryKey: ["market-intel", intelQuery, country],
    enabled: Boolean(product?.name),
    staleTime: 10 * 60 * 1000,
    queryFn: () =>
      intelFn({
        data: {
          query: intelQuery,
          country,
          // Satış fiyatı yoksa 0 gönderilir; sunucunun "tahmini" tedarik
          // çarpanı aşağıda gizlenir. Ölçülmüş AliExpress fiyatı ise kullanılır.
          selling_price_usd: defaults.price ?? 0,
          barcode: String((product as { barcode?: string } | null)?.barcode ?? ""),
        },
      }),
  });

  const rawSourcing = intel.data?.sourcing;
  // "estimated" kaynağı satış fiyatından türetilir; satış fiyatı ölçülmediyse
  // onu da göstermeyiz. Gerçek AliExpress medyanı her durumda kullanılabilir.
  const sourcing =
    rawSourcing && (rawSourcing.source === "aliexpress" || defaults.price !== null)
      ? rawSourcing
      : undefined;
  useEffect(() => {
    if (!sourcing || autoFilled) return;
    // Kullanıcının yazdığı değeri ezme; yalnız boş alanı doldur.
    if (sourcing.source === "aliexpress") {
      setCogs((prev) => (prev === "" ? sourcing.supplier_price_usd : prev));
      setFees((prev) => (prev === "" ? sourcing.shipping_usd : prev));
    }
    setAutoFilled(true);
  }, [sourcing, autoFilled]);

  if (!product) return null;
  const { vat, net, marginPct } = calculateProfit({
    price: typeof price === "number" ? price : null,
    cogs: typeof cogs === "number" ? cogs : null,
    shipping: typeof fees === "number" ? fees : 0,
    platformFee: typeof platformFee === "number" ? platformFee : 0,
    adSpend: typeof adCost === "number" ? adCost : 0,
    vatPct: c.vat_pct,
  });

  const canLocal = showLocal && rate > 0 && localCur !== "USD";
  const sym = canLocal ? meta.currencySymbol || localCur : "$";
  const fx = (usd: number) => (canLocal ? usd * rate : usd);
  const fmt = (usd: number, digits = 2) =>
    `${sym}${fx(usd).toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

  const trends = intel.data?.trends;
  const physical = intel.data?.physical;

  const h = product.hybrid;
  const hasHybridScores = [h?.ai_1_score, h?.ai_2_score, h?.calculated_score].some(
    (v) => typeof v === "number" && Number.isFinite(v),
  );
  // Eski radar, model yokken 50/50/50 ve 12 gün varsayıp gerçek grafik çiziyordu.
  // Artık yalnız GERÇEKTEN üretilmiş skorlar çizilir; yoksa açık boş durum gösterilir.
  const bars = hasHybridScores
    ? [
        ...(typeof h?.ai_1_score === "number"
          ? [{ label: "Pazar talebi (Groq)", value: h.ai_1_score }]
          : []),
        ...(typeof h?.ai_2_score === "number"
          ? [{ label: "Kâr & lojistik (Gemini)", value: h.ai_2_score }]
          : []),
        ...(typeof h?.calculated_score === "number"
          ? [{ label: "Hibrit skor", value: h.calculated_score }]
          : []),
        { label: "Vergi yükü (ters)", value: Math.max(0, Math.min(100, 100 - c.vat_pct * 3)) },
        ...(typeof h?.estimated_shipping_days === "number"
          ? [
              {
                label: "Teslimat hızı",
                value: Math.max(5, 100 - h.estimated_shipping_days * 4),
              },
            ]
          : []),
      ]
    : [];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-3"
      onClick={onClose}
    >
      <div
        className="premium-card grain rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <span className="text-2xl">{product.emoji || "🛍️"}</span> {product.name}
            </h2>
            <p className="text-xs text-muted-foreground">
              Derinlemesine pazar, kârlılık ve AI analizi
            </p>
            {product.source_url && (
              <a
                href={product.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[10px] text-sky-300 hover:underline"
              >
                Kaynak sayfayı aç <ExternalLink size={10} />
              </a>
            )}
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10" aria-label="Kapat">
            <X size={16} />
          </button>
        </div>

        {/* 1 — Target market breakdown */}
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Radar size={14} /> Hedef Pazar Analizi
            </h3>
            <div className="flex items-center gap-2">
              <CountryFlag code={country} size={14} />
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs outline-none focus:border-[oklch(0.62_0.17_255)]"
              >
                {TARGET_COUNTRIES.map((tc) => (
                  <option key={tc.code} value={tc.code} className="bg-[oklch(0.20_0.035_255)]">
                    {tc.flag} {tc.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {bars.length > 0 ? (
              <MarketRadar bars={bars} />
            ) : (
              <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.02] p-3 text-xs">
                <p className="font-semibold text-foreground">
                  Hibrit pazar skoru bu kayıt için üretilmedi
                </p>
                <p className="mt-1 text-muted-foreground leading-relaxed">
                  Kaynak taraması ürünü buldu; Groq/Gemini pazar ve lojistik puanlaması bu kayıtta
                  çalışmadı. Boş bir grafik yerine ölçülen fiyat/puan alanları ve kaynak sayfası
                  gösteriliyor.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {product.selling_price_usd && (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px]">
                      Ölçülen fiyat: ${product.selling_price_usd}
                    </span>
                  )}
                  {typeof product.measured?.rating === "number" && (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px]">
                      Puan: {product.measured.rating.toFixed(1)}/5
                    </span>
                  )}
                  {typeof product.measured?.ratingCount === "number" && (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px]">
                      {product.measured.ratingCount.toLocaleString("tr-TR")} değerlendirme
                    </span>
                  )}
                  {product.source_url && (
                    <a
                      href={product.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-300 hover:bg-sky-500/20"
                    >
                      Kaynağı doğrula
                    </a>
                  )}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Metric
                label="Hibrit skor"
                value={measured(h?.calculated_score, "/100")}
                hint={hasHybridScores ? "AI modeli" : "bu kayıt için üretilmedi"}
              />
              <Metric
                label="Rekabet"
                value={competitionLabel(h?.local_competition_level)}
                hint={h?.local_competition_level ? "AI modeli" : "ölçülmedi"}
              />
              <Metric
                label="Teslimat"
                value={measured(h?.estimated_shipping_days, " gün")}
                hint={typeof h?.estimated_shipping_days === "number" ? "AI modeli" : "ölçülmedi"}
              />
              <Metric label="Vergi" value={c.vat_label} hint="resmî oran" />
            </div>
          </div>
        </section>

        {/* 1b — Google Trends search interest */}
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Activity size={14} /> Arama İlgisi — Google Trends
            </h3>
            {intel.isPending ? (
              <Loader2 size={13} className="animate-spin text-muted-foreground" />
            ) : trends ? (
              <span
                className={`text-xs font-semibold ${trends.momentum_pct >= 0 ? "text-emerald-400" : "text-rose-400"}`}
              >
                30g momentum: {trends.momentum_pct > 0 ? "+" : ""}
                {trends.momentum_pct}%
              </span>
            ) : null}
          </div>
          {intel.isPending ? (
            <p className="text-xs text-muted-foreground">Canlı arama ilgisi yükleniyor…</p>
          ) : trends ? (
            <>
              <Sparkline values={trends.yearly} />
              <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Son 12 ay</span>
                <span>
                  {trends.source === "google-trends"
                    ? "Kaynak: Google Trends"
                    : "Tahmini seri (Trends erişilemedi)"}
                </span>
              </div>
              <div className="mt-3">
                <Sparkline values={trends.monthly} height={28} />
                <div className="text-[10px] text-muted-foreground mt-1">Son 30 gün</div>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Google Trends bu ürün için seri döndürmedi; boş grafik çizilmiyor.</span>
              <button
                type="button"
                onClick={() => intel.refetch()}
                className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] hover:bg-white/10"
              >
                Tekrar dene
              </button>
            </div>
          )}
        </section>

        <div className="mb-4">
          <CountryInfoBox code={country} niche={intelQuery || product.name} />
        </div>

        {/* 2 — Profitability calculator */}
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Calculator size={14} /> Kârlılık Hesaplayıcı (
              <CountryFlag code={country} size={12} /> {c.vat_label})
            </h3>
            <div className="inline-flex rounded-lg border border-white/10 bg-white/5 p-0.5 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setShowLocal(false)}
                className={`px-2.5 py-1 rounded-md ${!showLocal ? "bg-white/10 text-foreground" : "text-muted-foreground"}`}
              >
                USD $
              </button>
              <button
                type="button"
                onClick={() => setShowLocal(true)}
                disabled={rate <= 0 || localCur === "USD"}
                className={`px-2.5 py-1 rounded-md disabled:opacity-40 ${showLocal ? "bg-white/10 text-foreground" : "text-muted-foreground"}`}
              >
                {localCur} {meta.currencySymbol}
              </button>
            </div>
          </div>
          {canLocal && (
            <p className="text-[10px] text-muted-foreground mb-2">
              Frankfurter canlı kuru: 1 USD = {rate.toFixed(4)} {localCur} · girişler USD, sonuçlar{" "}
              {localCur}
            </p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {(
              [
                ["Satış fiyatı ($)", price, setPrice],
                ["Tedarik / COGS ($)", cogs, setCogs],
                ["FBA + kargo ($)", fees, setFees],
                ["Platform komisyonu ($)", platformFee, setPlatformFee],
                ["Reklam / CAC ($)", adCost, setAdCost],
              ] as const
            ).map(([label, val, set]) => (
              <label
                key={label}
                className="text-[11px] uppercase tracking-wider text-muted-foreground"
              >
                {label}
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={val}
                  placeholder="Ölçülmedi"
                  onChange={(e) =>
                    set(e.target.value === "" ? "" : Math.max(0, Number(e.target.value) || 0))
                  }
                  className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-[oklch(0.62_0.17_255)]"
                />
              </label>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground leading-relaxed">
            Boş alan “ölçülmedi” demektir; varsayılan fiyat üretilmez. Hesaplama için satış ve
            tedarik fiyatı gerekir. Boş kargo/komisyon/CAC kalemleri 0 sayılır. Önceden doldurulan
            kargo, komisyon ve CAC; ürün kaydındaki ölçüm yoksa yayınlanmış platform tarifelerinden
            hesaplanmış model değerleridir — düzenleyebilirsin.
          </p>
          {defaults.price === null && (
            <p className="mt-1 text-[10px] text-amber-300/90">
              Satış fiyatı kaynakta ölçülmedi; tedarik tahmini de otomatik doldurulmadı.
            </p>
          )}
          {sourcing && (
            <p className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1.5">
              <PackageSearch size={11} />
              {sourcing.source === "aliexpress"
                ? `AliExpress'te ${sourcing.samples ?? 0} ilan okundu; tedarik medyanı ~$${sourcing.supplier_price_usd}.`
                : `Tedarik maliyeti satış fiyatından tahmin edildi (~$${sourcing.supplier_price_usd}) — ölçüm değil.`}
              {physical?.found && physical.weight_g
                ? ` · Ürün ağırlığı ${physical.weight_g}g (Open Products Facts) — kargo/KDV hesabına eklendi.`
                : ""}
            </p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
            <Metric
              label={`KDV / Gümrük (${c.vat_pct}%)`}
              value={vat !== null ? `-${fmt(vat)}` : "Ölçülmedi"}
              tone={vat !== null ? "text-amber-300" : "text-muted-foreground"}
              hint={vat !== null ? "satış fiyatından" : "satış fiyatı gir"}
            />
            <Metric
              label="Net kâr / adet"
              value={net !== null ? fmt(net) : "Hesaplanamadı"}
              tone={
                net !== null
                  ? net >= 0
                    ? "text-emerald-400"
                    : "text-rose-400"
                  : "text-muted-foreground"
              }
              hint={net !== null ? undefined : "satış + tedarik gerekli"}
            />
            <Metric
              label="Net marj"
              value={marginPct !== null ? `${marginPct.toFixed(1)}%` : "Hesaplanamadı"}
              tone={
                marginPct !== null
                  ? marginPct >= 20
                    ? "text-emerald-400"
                    : "text-rose-400"
                  : "text-muted-foreground"
              }
              hint={marginPct !== null ? undefined : "girdi gerekli"}
            />
            <Metric
              label="100 satışta"
              value={net !== null ? fmt(net * 100, 0) : "Hesaplanamadı"}
              hint={net !== null ? undefined : "girdi gerekli"}
            />
          </div>
        </section>

        {/* 3 — Raw dual-agent reports */}
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <BarChart3 size={14} /> AI Çift-Ajan Ham Raporu
          </h3>
          {h ? (
            <>
              <div className="grid md:grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-[10px] uppercase tracking-wider text-[oklch(0.85_0.15_255)] mb-1 flex items-center gap-1.5">
                    <Target size={11} /> Groq — Talep &amp; Rekabet (
                    {measured(h.ai_1_score, "/100")})
                  </div>
                  <p className="text-muted-foreground">
                    {h.market_note || "Bu ürün için pazar notu üretilmedi."}
                  </p>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-[10px] uppercase tracking-wider text-[oklch(0.85_0.15_255)] mb-1 flex items-center gap-1.5">
                    <Truck size={11} /> Gemini — Lojistik &amp; Vergi (
                    {measured(h.ai_2_score, "/100")})
                  </div>
                  <p className="text-muted-foreground">
                    {h.logistics_note || "Lojistik notu üretilmedi."}
                  </p>
                </div>
              </div>
              {h.tooltip && (
                <p className="mt-2 text-xs text-muted-foreground flex items-start gap-1.5">
                  <Bot size={12} className="mt-0.5" /> {h.tooltip}
                </p>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.02] p-3 text-xs">
              <p className="font-semibold text-foreground">
                Bu kayıt için çift-ajan raporu üretilmedi
              </p>
              <p className="mt-1 text-muted-foreground leading-relaxed">
                Kaynak taraması Groq/Gemini pazar ve lojistik notlarını çalıştırmadı. Boş iki kart
                göstermek yerine ölçülen fiyat, puan ve kaynak alanları geçerli; aşağıdaki derin
                analiz planı model katmanını ayrıca etiketler.
              </p>
              {product.source_url && (
                <a
                  href={product.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[10px] text-sky-300 hover:underline"
                >
                  Kaynak sayfayı aç <ExternalLink size={10} />
                </a>
              )}
            </div>
          )}
        </section>

        <ProductDeepDive p={product} />

        {/* 4 — One-click actions */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-5">
          <button
            onClick={() => window.print()}
            className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <FileText size={13} /> PDF Dışa Aktar
          </button>
          <button
            onClick={() => {
              onSendToSimulator?.(product);
              onClose();
            }}
            className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Store size={13} /> Simülatöre Gönder
          </button>
          <button
            onClick={() =>
              nav({
                to: "/competitor-analysis",
                search: { q: intelQuery || product.name, country },
              })
            }
            className="rounded-lg bg-gradient-to-r from-[oklch(0.62_0.17_255)] to-[oklch(0.52_0.15_262)] px-3 py-2 text-xs font-semibold text-white flex items-center justify-center gap-1.5"
          >
            <Swords size={13} /> Rakipleri Analiz Et
          </button>
          <button
            onClick={() => {
              const blob = new Blob([JSON.stringify(product, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${product.name.replace(/\s+/g, "-").toLowerCase()}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Download size={13} /> Ürünü Takip Et / İndir
          </button>
        </div>
      </div>
    </div>
  );
}
