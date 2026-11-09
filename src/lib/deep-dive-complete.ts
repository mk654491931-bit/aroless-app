import type { WinningProduct } from "@/lib/gemini.functions";
import { parseNumber } from "@/lib/money";
import { buildProductCostBreakdown } from "@/lib/product-cost-breakdown";

/**
 * Sayı yardımcısı — tek para/sayı parserı (`src/lib/money.ts`).
 *
 * NOT: eski `completeDeepDive`, eksik plan bölümlerini rastgele varsayılan
 * sayılarla dolduruyordu. Bu sürüm aynı bölümleri GERİ GETİRİR ama:
 *   • maliyet/projeksiyon için `buildProductCostBreakdown`ın kaynak etiketli
 *     modelini kullanır (satış fiyatı yoksa projeksiyon üretmez),
 *   • tedarikçi adı/fiyatı uydurmaz (canlı teklif yoksa UI arama aksiyonu verir),
 *   • üretilen her plan bölümü arayüzde "AI/model tahmini — ölçüm değil"
 *     etiketiyle gösterilir.
 */
export function num(v: unknown, fallback = 0): number {
  return parseNumber(v) ?? fallback;
}

const usd = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n * 100) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** AI'dan gelen kısmi listeyi tam uzunlukta varsayılan listeyle tamamlar. */
function mergeByIndex<T>(actual: T[] | undefined, fallback: T[]): T[] {
  const src = Array.isArray(actual) ? actual : [];
  return fallback
    .map((def, i) => {
      const got = src[i] as Record<string, unknown> | undefined;
      if (!got) return def;
      const merged: Record<string, unknown> = { ...(def as Record<string, unknown>) };
      for (const [k, v] of Object.entries(got)) {
        if (v === null || v === undefined || v === "") continue;
        if (Array.isArray(v) && v.length === 0) continue;
        merged[k] = v;
      }
      return merged as T;
    })
    .concat(src.slice(fallback.length));
}

/**
 * Eksik strateji/plan bölümlerini ürünün KENDİ ölçüm ve model çıktısından
 * türetir. Var olan AI içeriğine asla dokunmaz.
 *
 * DÜRÜSTLÜK SINIRI:
 *   • `supplier_shortlist` ÜRETİLMEZ — firma adı/fiyatı uydurmak olurdu.
 *   • Tedarik fiyatı ölçülmediyse net kâr "ölçülmüş" gibi gösterilmez; model
 *     projeksiyonu ayrıca etiketlenir.
 *   • Pazar doygunluğundaki "aktif satıcı" sayısı yalnız ölçülmüş ilan varsa
 *     yazılır; yoksa "ölçülmedi" der.
 */
export function completeDeepDive(p: WinningProduct): WinningProduct {
  const out: WinningProduct = { ...p };
  const costs = buildProductCostBreakdown(p);
  const model = costs.model;
  const sell = num(p.selling_price_usd);
  const channel =
    p.platform_fit?.[0] ||
    p.market_verdict?.channels?.[0]?.platform ||
    p.real_economics?.context?.platform ||
    "seçili kanal";
  const secondChannel =
    p.platform_fit?.find((value) => value && value !== channel) ||
    p.market_verdict?.channels?.find((value) => value.platform !== channel)?.platform ||
    "ikinci kanal";
  const audience = p.target_audience || "Hedef kitle";
  const netUnit = costs.netProfit.usd ?? model?.net_per_unit ?? null;
  const marginPct =
    costs.netMarginPct ??
    model?.net_margin_pct ??
    (Number.isFinite(p.profit_margin_pct) && p.profit_margin_pct > 0 ? p.profit_margin_pct : null);
  const cpa = model?.cac && model.cac > 0 ? model.cac : netUnit && netUnit > 0 ? netUnit * 0.55 : 0;
  const startup = num(p.startup_cost_usd);
  const budgetBase = startup > 0 ? startup : (model?.monthly.ad_budget_usd ?? 0);
  const budgetLabel = (fraction: number) =>
    budgetBase > 0 ? usd(budgetBase * fraction) : "Model bütçesi ölçülmedi";
  const competition = p.competition_level ?? "Medium";

  // ---- 30 günlük lansman yol haritası (3 faz, 30 günü tam kapsar) ----
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
      budget_usd: budgetLabel(0.2),
      kpi: "2 doğrulanmış tedarikçi, hazır ürün sayfası ve 8 kreatif",
    },
    {
      phase: "Faz 2 — Lansman & trafik",
      days: "Gün 11-20",
      actions: [
        cpa > 0
          ? `${secondChannel} ve ${channel} üzerinde günlük ${usd(Math.max(15, budgetBase * 0.03))} bütçeyle yayına çık`
          : `${secondChannel} ve ${channel} üzerinde küçük bütçeli bir test yayını başlat`,
        "3 gün sonra CPA'sı hedefin 1.5 katını aşan kreatifleri kapat",
        "İlk 20 siparişte kargo ve iade sürecini uçtan uca dene",
        "UGC için 2 mikro içerik üreticisiyle anlaş",
      ],
      budget_usd: budgetLabel(0.45),
      kpi:
        cpa > 0
          ? `CPA ≤ ${usd(cpa)} ve ROAS ≥ ${(sell / Math.max(1, cpa)).toFixed(1)}x`
          : "İlk 20 siparişte dönüşümü ve teslimat süresini doğrula",
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
      budget_usd: budgetLabel(0.35),
      kpi:
        cpa > 0
          ? `Aylık ${Math.max(
              10,
              Math.round((budgetBase * 0.35) / Math.max(1, cpa)),
            )}+ sipariş, net marj ≥ %${Math.max(0, Math.round((marginPct ?? 0) * 0.8))}`
          : "Tekrarlayan satın alma ve sepet ortalaması sinyalini ölç",
    },
  ];
  out.launch_roadmap = mergeByIndex(out.launch_roadmap, defaultRoadmap);

  // ---- 90 günlük finansal projeksiyon (yalnız satış fiyatı varsa) ----
  // Tedarik ölçülmediyse bu bir MODEL projeksiyonudur; UI "hesaplandı" der.
  // Satış fiyatı yoksa hiç üretilmez: 29,9$ varsayıp tablo doldurmak, ürünün
  // fiyatı hakkında olmayan bir iddia olurdu.
  if (sell > 0 && model && netUnit !== null) {
    const baseUnits = Math.max(10, Math.round(model.monthly.units || 0));
    const baseAd = Math.max(0, model.monthly.ad_budget_usd || 0);
    const overhead = Math.max(0, model.monthly.overhead_usd || 0);
    const defaultProjection = [1, 1.25, 1.5].map((growth, i) => {
      const units = Math.round(baseUnits * growth);
      const revenue = units * sell;
      const adSpend = baseAd * (1 + i * 0.25);
      // Net, CAC/reklam dahil BİRİM kârdan hesaplanır. Reklam sütunu plan
      // bütçesidir; ayrıca düşülürse CAC iki kez sayılırdı (eski hatanın
      // düzeltmesi). Sabit gider ayrıca düşülür.
      const net = units * netUnit - overhead;
      return {
        month: `${i + 1}. Ay`,
        units,
        revenue_usd: usd(revenue),
        ad_spend_usd: usd(adSpend),
        net_profit_usd: usd(net),
      };
    });
    out.financial_projection = mergeByIndex(out.financial_projection, defaultProjection);
  }

  // ---- 4 haftalık içerik takvimi ----
  const defaultCalendar: NonNullable<WinningProduct["content_calendar"]> = [
    {
      week: "1. Hafta",
      theme: "Ürün tanıtımı & sorun farkındalığı",
      posts: [
        `${audience} için sorunu 15 saniyede gösteren video`,
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
    const roas = cpa > 0 ? (sell / Math.max(1, cpa)).toFixed(1) : null;
    out.scaling_playbook =
      `İlk 30 günde ${cpa > 0 ? `CPA ${usd(cpa)} altında kalan` : "dönüşümü en yüksek"} kreatifleri belirle ve bütçeyi yalnızca onlara kaydır. ` +
      `${channel} üzerinde günlük ${usd(Math.max(20, budgetBase * 0.05))} ile başlayıp her 48 saatte %20 artışla ölçekle` +
      `${roas ? `; ROAS ${roas}x altına düşerse artışı durdur` : ""}. ` +
      `60. günden itibaren ${secondChannel} ve e-posta/SMS ile ikinci kanalı aç, paket satışıyla sepet ortalamasını ${usd(
        sell > 0 ? sell * 1.35 : 0,
      )} seviyesine taşı. ` +
      `Aylık tekrar sipariş sinyalini ölç; tedarikçiyle birim fiyatı yeniden pazarlık et. ` +
      `Bu bir model planıdır; ölçülmüş performans değildir.`;
  }
  if (!out.exit_criteria || out.exit_criteria.length === 0) {
    out.exit_criteria = [
      cpa > 0
        ? `Yayının 14. gününde CPA hâlâ ${usd(cpa * 1.6)} üzerindeyse durdur`
        : "Yayının 14. gününde ilk 20 siparişte anlamlı dönüşüm yoksa durdur",
      `Net marj iki ay üst üste %${Math.max(5, Math.round((marginPct ?? 10) * 0.5))} altına inerse ürünü bırak`,
      "İade/şikâyet oranı %8'i aşarsa tedarikçiyi değiştir veya çık",
    ];
  }

  // ---- Pazar doygunluğu ----
  // Aktif satıcı sayısı YALNIZ ölçülmüş ilan varsa yazılır. Eski kod
  // rekabet etiketinden "2.000+ satıcı" uyduruyordu; bu artık yok.
  if (!out.market_saturation) {
    const sellerCount = p.market_evidence?.sellers?.length ?? 0;
    const score = competition === "Low" ? 32 : competition === "High" ? 78 : 55;
    out.market_saturation = {
      score,
      active_sellers:
        sellerCount > 0
          ? `${sellerCount} canlı satıcı ilanı (ölçüldü)`
          : "Canlı satıcı sayısı ölçülmedi",
      ad_activity:
        competition === "Low"
          ? "Düşük reklam yoğunluğu (model)"
          : competition === "High"
            ? "Yoğun reklam rekabeti (model)"
            : "Orta reklam yoğunluğu (model)",
      entry_window:
        competition === "Low"
          ? "4-6 ay (model)"
          : competition === "High"
            ? "3-6 hafta (model)"
            : "2-3 ay (model)",
      verdict:
        competition === "High"
          ? "Pazar kalabalık; yalnızca güçlü farklılaşma ve üstün kreatifle girilmeli. Bu değerlendirme rekabet etiketinden türetilmiş modeldir."
          : "Giriş penceresi açık görünüyor; hızlı test edip kazanan kreatifle ölçeklemek mantıklı. Bu değerlendirme rekabet etiketinden türetilmiş modeldir.",
    };
  }

  // ---- Fiyat basamakları ----
  if ((!out.pricing_ladder || out.pricing_ladder.length === 0) && sell > 0) {
    const cvr = model?.cvr_pct ?? p.conversion?.cvr_pct ?? 2;
    out.pricing_ladder = [
      {
        tier: "Giriş",
        price_usd: usd(sell * 0.9),
        positioning: "Hızlı ilk satış ve yorum toplamak için agresif fiyat.",
        expected_cvr_pct: Math.round(cvr * 1.15 * 10) / 10,
      },
      {
        tier: "Ana",
        price_usd: usd(sell),
        positioning: "Marjı koruyan referans fiyat; varsayılan teklif.",
        expected_cvr_pct: Math.round(cvr * 10) / 10,
      },
      {
        tier: "Premium paket",
        price_usd: usd(sell * 1.35),
        positioning: "Aksesuar/2'li paketle sepet ortalamasını yükseltir.",
        expected_cvr_pct: Math.round(cvr * 0.7 * 10) / 10,
      },
    ];
  }

  return out;
}
