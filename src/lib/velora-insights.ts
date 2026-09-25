// ============================================================================
// Velora içgörüleri — SAF yardımcılar (sunucu bağımlılığı yok, test edilebilir).
//
// Buradaki üç şey aynı fikrin parçası: konseyin ne kadar KENDİ İÇİNDE tutarlı
// olduğu (C), bir ürünün hangi pazarlarda satılabilir olduğu (D) ve aynı
// sorgunun tekrar çalıştırılıp çalıştırılmayacağı (A).
//
// DÜRÜSTLÜK KURALI: bu modül sayı UYDURMAZ. Pazar uygunluğu kural tabanlıdır,
// katılım oy toplamından HESAPLANIR, önbellek anahtarı girdiden türetilir.
// "Bilmiyoruz" ile "sorun yok" birbirinden ayrı tutulur.
// ============================================================================

import { countryFit, PLATFORM_MARKETS, type CountryFit } from "./platform-market";
import { countryBarrierFor } from "./market-barriers";
import type { Platform } from "./gemini.functions";

// ---------------------------------------------------------------------------
// C) AJAN KATILIMI — "14 ajan ne kadar hemfikir?"
// ---------------------------------------------------------------------------

/**
 * Konseyin bir ürün üzerindeki oy dağılımı.
 *
 * `councilScore` (ortalama) tek başına yanıltıcıdır: 14 ajanın hepsinin 71
 * vermesi ile 7'sinin 90, 7'sinin 52 vermesi aynı ortalamayı verir. Birincisi
 * "konsey bu üründe bir fikirde", ikincisi "konsey bölünmüş" demektir. Yayılım
 * bu iki durumu ayırır.
 */
export type CouncilAlignment = "unanimous" | "strong" | "split" | "contested" | "none";

/** Oyların standart sapması (popülasyon). Tek oy varsa 0. */
export function voteSpread(scores: readonly number[]): number {
  if (scores.length === 0) return 0;
  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length;
  return Math.round(Math.sqrt(variance) * 10) / 10;
}

/**
 * Yayılımdan katılım etiketi.
 *
 * Eşikler kasıtlı olarak geniş: 14 LLM oyununun doğal yayılımı geniştir ve
 * "bölünmüş" etiketi fazla verilirse kullanıcı her üründe uyarı görür, o da
 * etiketi değersizleştirir. Oyların az olduğu durumda YALNIZCA oy sayısı
 * düşükse `none` döner — iki ajanın uyuşması "fikir birliği" sayılmaz.
 */
export function councilAlignment(votes: number, spread: number): CouncilAlignment {
  if (votes <= 0) return "none";
  if (votes < 3) return "none";
  if (spread <= 8) return "unanimous";
  if (spread <= 16) return "strong";
  if (spread <= 26) return "split";
  return "contested";
}

/** Etiketin paneldeki karşılığı. Renkler mevcut rozet sözleşmesine uyar. */
export const ALIGNMENT_CHIPS: Record<
  CouncilAlignment,
  { label: string; cls: string; hint: string }
> = {
  unanimous: {
    label: "oy birliği",
    cls: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
    hint: "Ajanlar bu üründe neredeyse aynı puanı verdi.",
  },
  strong: {
    label: "geniş mutabakat",
    cls: "border-sky-400/30 bg-sky-500/10 text-sky-200",
    hint: "Ajanlar çoğunlukla aynı yönde, küçük sapmalarla.",
  },
  split: {
    label: "bölünmüş",
    cls: "border-amber-400/30 bg-amber-500/10 text-amber-200",
    hint: "Ajanlar belirgin farklı puanlar verdi; karar tartışmalı.",
  },
  contested: {
    label: "çok tartışmalı",
    cls: "border-rose-400/30 bg-rose-500/10 text-rose-200",
    hint: "Ajanlar birbirinden çok uzak puanlar verdi; orta değer yanıltıcıdır.",
  },
  none: {
    label: "oy yetersiz",
    cls: "border-white/10 bg-white/5 text-muted-foreground",
    hint: "Bu ürünü puanlayan ajan sayısı katılım göstergesi için çok az.",
  },
};

// ---------------------------------------------------------------------------
// D) PAZAR ERİŞİMİ — "bu ürünü nerede satabilirim?"
// ---------------------------------------------------------------------------

/** Karşılaştırılan pazarlar. Kısa tutulur: kullanıcı için okunabilir kalmalı. */
export const MARKET_REACH_COUNTRIES = ["US", "DE", "GB", "TR", "AE", "BR"] as const;

export type MarketReachEntry = {
  country: string;
  /** Kanalın bu ülkede satışa uygunluğu. */
  fit: CountryFit;
  /** Bilinen bir bariyer varsa nedeni; yoksa `null` (izin var demek DEĞİLDİR). */
  barrier: string | null;
  /** Sonuç: kullanıcıya gösterilecek tek satırlık karar. */
  verdict: "open" | "cross-border" | "barrier" | "unavailable";
};

export type MarketReach = {
  country: string;
  entries: MarketReachEntry[];
  /** Başka bir bariyeri olmayan en yaygın pazar sayısı. */
  openMarkets: number;
};

const VERDICT_RANK: Record<MarketReachEntry["verdict"], number> = {
  open: 0,
  "cross-border": 1,
  unavailable: 2,
  barrier: 3,
};

/**
 * Bir ürünün belirli kanallarda hangi pazarlarda satılabilir olduğunu hesaplar.
 *
 * Üç GERÇEK kaynak kullanılır, hiçbiri tahmin değildir:
 *   • `countryFit` — kanalın hangi ülkelerde yerel olduğu (elle hazırlanmış tablo)
 *   • `COUNTRY_BARRIERS` — bilinen sertifika/tescil zorunlulukları
 *   • ürünün adı/kategorisi — bariyer kuralına giren kalıpları yakalamak için
 *
 * "Uygun" yalnızca bu üçünden bir engel çıkmadığı anlamına gelir; vergi, gümrük
 * oranı gibi hesaplanamayan kalemler bilerek iddia edilmez.
 */
export function marketReach(input: {
  platform: string;
  productText: string;
  countries?: readonly string[];
}): MarketReach {
  const platform = input.platform as Platform;
  const countries = input.countries ?? MARKET_REACH_COUNTRIES;
  const text = `${input.productText ?? ""}`;
  // Tanımadığımız bir kanal için pazar uygunluğu UYDURULMAZ: `countryFit`
  // bilinmeyen kanalda "sınır ötesi" döner, oysa biz o kanalın nerede çalıştığını
  // doğrulayamayız. Bu yüzden bilinmeyen kanal tüm pazarlarda kapalı işaretlenir.
  const knownChannel = platform in PLATFORM_MARKETS;

  const entries = countries
    .map((country) => {
      const fit = knownChannel ? countryFit(platform, country) : ("unavailable" as CountryFit);
      const barrier = countryBarrierFor(country, text);
      const verdict: MarketReachEntry["verdict"] = barrier
        ? "barrier"
        : fit === "unavailable"
          ? "unavailable"
          : fit === "native"
            ? "open"
            : "cross-border";
      return { country, fit, barrier, verdict };
    })
    .sort(
      (a, b) =>
        VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] || a.country.localeCompare(b.country),
    );

  return {
    country: entries[0]?.country ?? "GLOBAL",
    entries,
    openMarkets: entries.filter((e) => e.verdict === "open" || e.verdict === "cross-border").length,
  };
}

/** Pazar erişimini ajan istemine eklemek için tek satırlık özet. */
export function marketReachLine(reach: MarketReach): string {
  if (reach.entries.length === 0) return "";
  return reach.entries
    .map((e) => {
      if (e.verdict === "barrier") return `${e.country}=BLOKED(${e.barrier})`;
      if (e.verdict === "unavailable") return `${e.country}=KANAL_YOK`;
      if (e.verdict === "cross-border") return `${e.country}=SINIR_OTESI`;
      return `${e.country}=YEREL`;
    })
    .join(" · ");
}

// ---------------------------------------------------------------------------
// A) SORGU ÖNBELLEĞİ — aynı nişi 24 saat içinde tekrar çalıştırma
// ---------------------------------------------------------------------------

/** Önbellek kaydının ömrü. */
export const VELORA_QUERY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Aynı koşuyu tanımlayan normalize anahtar.
 *
 * Normalizasyon bilinçli: "  Liftoff   Keychain " ile "liftoff keychain" aynı
 * iş olmalıdır, yoksa önbellek hiç tutmaz. Kullanıcı kimliği anahtarın parçasıdır
 * — önbellek KİŞİYE ÖZELDİR, bir kullanıcının araştırması başkasına bedava gitmez.
 *
 * DİKKAT: küçültme BİLİNÇLİ olarak yerelden bağımsızdır. `toLocaleLowerCase("tr-TR")`
 * kullanılsaydı "ICE MAKER" → "ıce maker", "ice maker" → "ice maker" olurdu: aynı
 * sorgu iki farklı anahtara düşer ve önbellek sessizce hiç tutmazdu.
 */
export function veloraQueryCacheKey(input: {
  userId: string;
  query: string;
  country: string;
  platform: string;
}): string {
  const norm = (value: string): string =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[\s_-]+/g, " ")
      .trim();
  const parts = [
    norm(input.userId),
    norm(input.query),
    norm(input.country).toUpperCase(),
    norm(input.platform).toUpperCase(),
  ];
  return `velora:q:${parts.join("|")}`;
}
