import type { WinningProduct } from "@/lib/gemini.functions";

/** "$24.99", "24,99 USD", 24.99 -> 24.99 */
export function num(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return fallback;
  const m = v.replace(/,/g, ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : fallback;
}

const usd = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** AI'dan gelen kısmi listeyi tam uzunlukta varsayılan listeyle tamamlar. */
function mergeByIndex<T>(actual: T[] | undefined, fallback: T[]): T[] {
  const src = Array.isArray(actual) ? actual : [];
  return fallback.map((def, i) => {
    const got = src[i] as Record<string, unknown> | undefined;
    if (!got) return def;
    const merged: Record<string, unknown> = { ...(def as Record<string, unknown>) };
    for (const [k, v] of Object.entries(got)) {
      if (v === null || v === undefined || v === "") continue;
      if (Array.isArray(v) && v.length === 0) continue;
      merged[k] = v;
    }
    return merged as T;
  }).concat(src.slice(fallback.length));
}

/**
 * AI yanıtında eksik kalan strateji/projeksiyon bölümlerini ürünün kendi
 * rakamlarından türeterek doldurur. Var olan alanlara asla dokunmaz.
 */
export function completeDeepDive(p: WinningProduct): WinningProduct {
  const sell = num(p.selling_price_usd, 29.9);
  const cost = num(p.cost_breakdown?.supplier_cost ?? p.supplier_price_usd, sell * 0.3);
  const ship = num(p.cost_breakdown?.shipping_cost, sell * 0.08);
  const fee = num(p.cost_breakdown?.platform_fee, sell * 0.06);
  const ad = num(p.cost_breakdown?.ad_spend, sell * 0.2);
  const netUnit = Math.max(1, num(p.cost_breakdown?.net_profit, sell - cost - ship - fee - ad));
  const marginPct = p.cost_breakdown?.net_margin_pct ?? p.profit_margin_pct ?? Math.round((netUnit / sell) * 100);
  const cpa = Math.max(1, num(p.unit_economics?.target_cpa_usd, netUnit * 0.55));
  const capital = Math.max(300, num(p.startup_cost_usd, 800));
  const comp = p.competition_level ?? "Medium";
  const compFactor = comp === "Low" ? 1.25 : comp === "High" ? 0.75 : 1;
  const channel = p.platform_fit?.[0] ?? "Shopify";
  const second = p.platform_fit?.[1] ?? "TikTok";
  const out: WinningProduct = { ...p };

  // ---- 30 günlük lansman yol haritası (3 faz, 30 günü tam kapsar) ----
  const b = capital;
  const defaultRoadmap: NonNullable<WinningProduct["launch_roadmap"]> = [
    {
      phase: "Faz 1 — Ön ısınma & doğrulama",
      days: "Gün 1-10",
      actions: [
        `${p.name} için 3 tedarikçiden numune iste ve teslim sürelerini karşılaştır`,
        "Rakip fiyatlarını ve yorumlardaki şikâyetleri tabloya çıkar",
        `${channel} üzerinde tek ürünlü açılış sayfasını kur`,
        "3 farklı hook ile 5-8 kısa video kreatifi çek",
        "Ön kayıt / bekleme listesi ile ilk talebi ölç",
      ],
      budget_usd: usd(b * 0.2),
      kpi: "2 doğrulanmış tedarikçi, hazır ürün sayfası ve 8 kreatif",
    },
    {
      phase: "Faz 2 — Lansman & trafik",
      days: "Gün 11-20",
      actions: [
        `${second} ve ${channel} üzerinde günlük ${usd(Math.max(15, b * 0.03))} bütçeyle yayına çık`,
        "3 gün sonra CPA'sı hedefin 1.5 katını aşan kreatifleri kapat",
        "İlk 20 siparişte kargo ve iade sürecini uçtan uca dene",
        "UGC için 2 mikro içerik üreticisiyle anlaş",
      ],
      budget_usd: usd(b * 0.45),
      kpi: `CPA ≤ ${usd(cpa)} ve ROAS ≥ ${(sell / Math.max(1, cpa)).toFixed(1)}x`,
    },
    {
      phase: "Faz 3 — Optimizasyon & yeniden hedefleme",
      days: "Gün 21-30",
      actions: [
        "Kazanan kreatifin bütçesini her 48 saatte %20 artır",
        "Sepeti terk edenlere retargeting + e-posta/SMS akışı kur",
        "Sepet artırıcı paket ve satış sonrası upsell ekle",
        "Tedarikçiyle adet başı fiyatı yeniden pazarlık et",
      ],
      budget_usd: usd(b * 0.35),
      kpi: `Aylık ${Math.round((b * 0.35) / Math.max(1, cpa))}+ sipariş, net marj ≥ %${Math.max(15, Math.round(marginPct * 0.8))}`,
    },
  ];
  out.launch_roadmap = mergeByIndex(out.launch_roadmap, defaultRoadmap);

  // ---- 90 günlük finansal projeksiyon (1., 2. ve 3. ay ayrı satır) ----
  const m1 = Math.max(20, Math.round(((capital * 0.5) / Math.max(1, cpa)) * compFactor));
  const defaultProjection = [1, 2.4, 4.6].map((r, i) => {
    const units = Math.round(m1 * r);
    const revenue = units * sell;
    const adSpend = units * cpa * (i === 0 ? 1.15 : i === 1 ? 1 : 0.9);
    const net = units * (sell - cost - ship - fee) - adSpend;
    return {
      month: `${i + 1}. Ay`,
      units,
      revenue_usd: usd(revenue),
      ad_spend_usd: usd(adSpend),
      net_profit_usd: usd(net),
    };
  });
  out.financial_projection = mergeByIndex(out.financial_projection, defaultProjection);

  // ---- 4 haftalık içerik takvimi ----
  const defaultCalendar: NonNullable<WinningProduct["content_calendar"]> = [
    {
      week: "1. Hafta",
      theme: "Ürün tanıtımı & sorun farkındalığı",
      posts: [
        `${p.target_audience ?? "Hedef kitlenin"} yaşadığı sorunu 15 saniyede gösteren video`,
        "Ürünü kutudan çıkarma (unboxing) klibi",
        "Sık sorulan 3 soruya hızlı yanıt karuseli",
      ],
    },
    {
      week: "2. Hafta",
      theme: "Sosyal kanıt & kullanıcı yorumları",
      posts: [
        "İlk müşteri yorumları ekran görüntüsü derlemesi",
        "UGC: gerçek kullanıcı videosu paylaşımı",
        "Rakip ürünle yan yana test",
      ],
    },
    {
      week: "3. Hafta",
      theme: "Problem – çözüm & kullanım senaryoları",
      posts: [
        "Öncesi / sonrası karşılaştırma videosu",
        "Günlük rutine yerleştirme videosu",
        "3 yaratıcı kullanım fikri",
      ],
    },
    {
      week: "4. Hafta",
      theme: "Aciliyet & kampanya",
      posts: [
        "Sınırlı stok / geri sayım duyurusu",
        "Paket teklifi ve kargo bedava kampanyası",
        "Müşteri hikâyesi + net eylem çağrısı",
      ],
    },
  ];
  out.content_calendar = mergeByIndex(out.content_calendar, defaultCalendar);


  // ---- Ölçekleme oyun kitabı & çıkış kriterleri ----
  if (!out.scaling_playbook) {
    out.scaling_playbook =
      `İlk 30 günde CPA ${usd(cpa)} altında kalan kreatifleri belirle ve bütçeyi yalnızca onlara kaydır. ` +
      `${channel} üzerinde günlük ${usd(Math.max(20, capital * 0.05))} ile başlayıp her 48 saatte %20 artışla ölçekle; ` +
      `ROAS ${(sell / Math.max(1, cpa)).toFixed(1)}x altına düşerse artışı durdur. ` +
      `60. günden itibaren ${second} ve e-posta/SMS ile ikinci kanalı aç, paket satışıyla sepet ortalamasını ${usd(sell * 1.35)} seviyesine taşı. ` +
      `Aylık 300+ adette tedarikçiyle birim fiyatı %10-15 aşağı çekip marjı %${Math.min(70, Math.round(marginPct + 8))} bandına getir.`;
  }
  if (!out.exit_criteria || out.exit_criteria.length === 0) {
    out.exit_criteria = [
      `Yayının 14. gününde CPA hâlâ ${usd(cpa * 1.6)} üzerindeyse durdur`,
      `Net marj iki ay üst üste %${Math.max(10, Math.round(marginPct * 0.5))} altına inerse ürünü bırak`,
      "İade/şikâyet oranı %8'i aşarsa tedarikçiyi değiştir veya çık",
    ];
  }

  // ---- Pazar doygunluğu ----
  if (!out.market_saturation) {
    const score = comp === "Low" ? 32 : comp === "High" ? 78 : 55;
    out.market_saturation = {
      score,
      active_sellers: comp === "Low" ? "50-200 satıcı" : comp === "High" ? "2.000+ satıcı" : "300-900 satıcı",
      ad_activity: comp === "Low" ? "Düşük reklam yoğunluğu" : comp === "High" ? "Yoğun reklam rekabeti" : "Orta reklam yoğunluğu",
      entry_window: comp === "Low" ? "4-6 ay" : comp === "High" ? "3-6 hafta" : "2-3 ay",
      verdict:
        comp === "High"
          ? "Pazar kalabalık; yalnızca güçlü farklılaşma ve üstün kreatifle girilmeli."
          : "Giriş penceresi açık; hızlı test edip kazanan kreatifle ölçeklemek mantıklı.",
    };
  }

  // ---- Fiyat basamakları ----
  if (!out.pricing_ladder || out.pricing_ladder.length === 0) {
    out.pricing_ladder = [
      { tier: "Giriş", price_usd: usd(sell * 0.85), positioning: "Hızlı ilk satış ve yorum toplamak için agresif fiyat.", expected_cvr_pct: 3.2 },
      { tier: "Ana", price_usd: usd(sell), positioning: "Marjı koruyan referans fiyat; varsayılan teklif.", expected_cvr_pct: 2.4 },
      { tier: "Premium paket", price_usd: usd(sell * 1.45), positioning: "Aksesuar/2'li paketle sepet ortalamasını yükseltir.", expected_cvr_pct: 1.5 },
    ];
  }

  return out;
}
