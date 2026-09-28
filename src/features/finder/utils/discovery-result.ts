// ============================================================================
// PRODUCT DISCOVERY SONUÇ DÖNÜŞTÜRÜCÜSÜ.
//
// İKİ FARKLI ÜRÜN ŞEKLİ VAR, ARADA ADAPTÖR GEREKİYOR:
//   * Eski hat (`generateProducts`) AI'ın yazdığı İŞ PLANI ürünleri döner:
//     tedarik fiyatı, marj, reklam açıları, platform stratejisi… Çoğu ALAN
//     MODEL TAHMİNİDİR.
//   * Yeni hat ÖLÇÜLMÜŞ KANIT döner: gerçek fiyat, gerçek kullanıcı puanı,
//     gerçek kaynak bağlantısı ve 14 ajanın oy puanı. Tedarik/maliyet
//     BİLİNMEZ — çünkü kazımada yoktur ve uydurulmamalıdır.
//
// DÜRÜSTLÜK KURALI: Ölçülmeyen alan BOŞ string / 0 / [] bırakılır. Bir
// kozmetik dolgu ("Marj: %45") koymak ürünü satılabilir gösterir ama yanlıştı;
// kullanıcı kazımayla doğrulanamaz. Boş alan arayüzde zaten "—" olarak ele
// alınır (bkz. `winner-score.ts`: tüm `ScorableProduct` alanları opsiyoneldir).
//
// Dolu doldurulan alanlar YALNIZCA ölçülmüş veriden türetilir; rekabet
// seviyesi ve trend puanı deterministik sinyalden gelir, konsayl skoru ise
// 14 ajanın gerçek oyudur.
// ============================================================================

import type { WinningProduct } from "@/lib/gemini.functions";
import type { DiscoveryWinner } from "@/lib/product-discovery.functions";

/** Deterministik rekabet sinyalini arayüzün üç seviyeli etiketine çevirir. */
function competitionLabel(score: number): WinningProduct["competition_level"] {
  if (score >= 70) return "High";
  if (score >= 45) return "Medium";
  return "Low";
}

const usd = (value: number | null): string =>
  value === null || !Number.isFinite(value) || value <= 0 ? "" : `$${value.toFixed(2)}`;

/**
 * Kazanan satırları arayüzün beklediği ürün şekline çevirir.
 *
 * `siblings` aynı koşudaki diğer kazananlardır; "rakipler" alanı onlarla
 * doldurulur — çünkü aynı nişten çıkan diğer ürünler gerçekten rakip adayıdır
 * (uydurma şirket adı yok).
 */
export function toWinningProducts(
  rows: readonly DiscoveryWinner[],
  siblings: readonly DiscoveryWinner[] = [],
): WinningProduct[] {
  return rows.map((row) => {
    const price = usd(row.priceUsd);
    const ratingText =
      row.rating !== null
        ? `· ${row.rating.toFixed(1)} puan${row.ratingCount ? ` (${row.ratingCount} değerlendirme)` : ""}`
        : "· puan ölçülemedi";
    const evidence = row.evidence.slice(0, 2).join(" ");
    const whyWinning = `14 ajan puanı ${Math.round(row.councilScore)}/100 · güven ${Math.round(
      row.confidenceScore,
    )}/100${evidence ? ` · ${evidence}` : ""}`;

    const rivals = siblings
      .filter((other) => other.fingerprint && other.fingerprint !== row.fingerprint)
      .slice(0, 3)
      .map((other) => other.name);

    return {
      name: row.name,
      description:
        row.notes ||
        `${row.sources.join(", ") || "kaynak"} üzerinden kazındı · ${row.dataCompleteness}/5 alan doğrulandı`,
      why_winning: whyWinning,
      // Ölçülmedi: kazımada hedef kitle verisi yok.
      target_audience: "",
      // AI bu koşuda reklam açısı üretmedi ($0 kuralı: AI yalnız iki adımda).
      ad_angles: [],
      // Tedarik maliyeti BİLİNMİYOR (kazınmadı, uydurulmaz).
      supplier_price_usd: "",
      selling_price_usd: price,
      profit_margin_pct: 0,
      startup_cost_usd: "",
      platform_fit: row.seller ? [row.seller] : [],
      platform_strategy: "",
      competitor_examples: rivals,
      supplier_links: [],
      alibaba_links: [],
      cost_breakdown: {
        supplier_cost: "",
        shipping_cost: "",
        platform_fee: "",
        ad_spend: "",
        net_profit: "",
        net_margin_pct: 0,
      },
      competition_level: competitionLabel(row.signals.competition),
      trend_score: row.signals.demand,
      emoji: "📦",
      competitor_prices: row.seller
        ? [
            {
              store: row.seller,
              price: price || "—",
              note: row.notes.slice(0, 120),
              url: row.url,
            },
          ]
        : [],
      // Kanıt yoğunluğu: 5 ölçülebilir alandan kaçı gerçekten doldu.
      health_score: Math.round(row.dataCompleteness * 20),
      data_sources: row.sources,
      confidence_reason: `Veri bütünlüğü ${row.dataCompleteness}/5${ratingText} · ön skor ${Math.round(
        row.preScore,
      )}`,
      // NOT: `council` alanı BİLEREK yazılmaz. O alan eski hattın tam AI
      // yönetici raporu (`CouncilSummary`) şeklindedir; yalnız puandan bir
      // nesne uydurmak kartta “yönetici raporu var” yanıltması yaratırdı.
      // Konsayl skoru zaten `why_winning` ve `confidence_reason` içinde duruyor.
    } satisfies WinningProduct;
  });
}

/**
 * Yeni hattın kurulamama SEBEBİNİ kullanıcıya anlatır.
 *
 * NEDEN VAR: arayüz hat kurulamazsa klasik motora düşüyordu ve yalnızca
 * "klasik motorla devam ediliyor" diyordu. Bu, hatta ne olduğunu SÖYLEMEYEN
 * bir geri düşüştü: kullanıcı 5 ürün görüyor, "yeni hat çalışmadı" nerede
 * belli değil. Oysa ölçülen gerçek şuydu: hat çoğu kurulumda **kurulum
 * eksiği** yüzünden açılmıyor (migration uygulanmamış, servis rolü anahtarı
 * yok) ve bu üç saniyelik bir kontrolle giderilebilir.
 *
 * Bu fonksiyon SAF ve test edilebilirdir: ham sunucu hatasını okunur Türkçeye
 * çevirir ve her zaman TEK çözüm yolu gösterir (`/api/product-discovery/preflight`).
 * Tanımadığı hatayı da SAKLAMAZ — ham metin kısaltılarak sona eklenir.
 */
export function describeDiscoveryFailure(reason: string): string {
  const raw = String(reason ?? "").trim();
  const lower = raw.toLowerCase();

  // 1) Supabase migration'ı uygulanmamış: yeni kolon yok.
  if (/\bcolumn\b.*\bdoes not exist\b/.test(lower) || /column .* does not exist/.test(lower)) {
    return "Supabase'da Product Discovery migration'ı uygulanmamış (searches tablosunda discovery_status kolonu yok).";
  }
  // 2) Migration'daki RPC'ler yok.
  if (/function .* does not exist|schema cache|advance_discovery_status/.test(lower)) {
    return "Supabase'da durum fonksiyonları yok (advance_discovery_status / finish_discovery_job).";
  }
  // 3) Servis rolü anahtarı yok — kalıcı iş kaydı açılamıyor.
  if (/supabase_service_role_key|service_role|missing supabase environment/.test(lower)) {
    return "SUPABASE_SERVICE_ROLE_KEY tanımlı değil; kalıcı iş kaydı açılamıyor.";
  }
  // 4) QStash yapılandırılmamış / erişilemiyor.
  if (/no_origin|no_public_origin/.test(lower)) {
    return "Kendi adresimiz çözümlenemedi; QStash'in geri çağırabileceği bir adres yok.";
  }
  if (/qstash|fetch failed|econnrefused|401|unauthorized|forbidden/.test(lower)) {
    return "QStash'e ulaşılamadı veya imza doğrulanamadı (jeton/imza anahtarı sorunu).";
  }
  // 5) İş kuruldu ama sonuç üretmedi.
  if (raw === "empty_result") return "Hat kuruldu ama bu nişte ölçülebilir ürün bulunamadı.";
  if (raw === "run_not_visible") return "İş kaydı okunamadı; iş kaydı yazılamamış olabilir.";
  if (raw === "timeout") return "İş zaman aşımına uğradı.";
  return raw ? `Yeni hat kurulamadı: ${raw.slice(0, 160)}` : "Yeni hat kurulamadı.";
}

/**
 * Seçili motor Product Discovery hattını kullanmıyorsa ekranda söylenir.
 *
 * NEDEN VAR (ölçülen davranış): `runSearch` yeni hattı YALNIZ
 * `engine === "default"` iken dener. `HF: Llama` / `HF: Qwen` / `Hybrid`
 * seçiliyse `hfGen` (klasik yol) çalışır ve **hiçbir uyarı üretilmez** —
 * kullanıcı "sistem hâlâ eski çalışıyor" sanır, oysa hata değil seçimdir.
 * Sessizliği kırmak, hat için yapılan teşhisin aynısıdır: olan biteni
 * söylemek.
 */
export function nonDefaultEngineNotice(engineLabel: string): string {
  return `Seçili motor "${engineLabel}" Product Discovery hattını kullanmıyor; bu hat (kazıma → 75 → Gemini 25 → 14 ajan → ilk 5) yalnız "Default AI" motorunda çalışır. Motoru "Default AI" yapıp tekrar ara.`;
}

/** Kurulum raporunun arayüze giden en küçük şekli. */
export type SetupReport = {
  ok: boolean;
  summary: string;
  checks: { id: string; label: string; ok: boolean; fix: string; optional?: boolean }[];
};

/**
 * Hat kurulamadığında ekranda gösterilecek TAM bildirim.
 *
 * NEDEN İKİ KAYNAK BİRLEŞTİRİLİYOR: (1) hat neden kurulamadı (ham hata metni
 * çevrilmiş hali), (2) kurulumda ne eksik (canlı yoklama). Kullanıcı ikisini
 * ayrı ayrı aramak zorunda kalmamalı: ekranda sebep + eksik + ÇÖZÜM yazmalı.
 *
 * Eksik kontrol YOKSA: yalnız teşhis ucunun adresi verilir — çünkü o zaman
 * kurulum hazırdır ve sorun başka yerdedir (ör. QStash'e ulaşılamıyor).
 *
 * ÖNEMLİ: `fix` metinlerinde gizli değer YOKTUR (yalnız anahtar adı/SQL yolu),
 * bu yüzden ekrana yazmak güvenlidir.
 */
export function discoverySetupNotice(reason: string, report: SetupReport | null): string {
  const cause = describeDiscoveryFailure(reason);
  if (!report || !report.checks.length) {
    // Rapor gelemedi (ağ/sunucu hatası): sebebi gizleme, teşhis yolunu göster.
    return `${cause} Bu yüzden klasik motor kullanıldı. Kurulum raporu alınamadı.`;
  }
  const missing = report.checks.filter((c) => !c.ok && !c.optional);
  if (!missing.length) {
    return `${cause} Kurulum tamam görünüyor, bu yüzden klasik motor kullanıldı.`;
  }
  const labels = missing.map((c) => c.label).join(", ");
  const fix = missing[0]?.fix ?? "";
  const extra = missing.length > 1 ? ` (+${missing.length - 1} eksik daha)` : "";
  return `${cause} Eksik: ${labels}${extra}. Çözüm: ${fix} Bu yüzden klasik motor kullanıldı.`;
}
