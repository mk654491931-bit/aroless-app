// ARAÇ BAŞINA AI DERİNLİĞİ — modül zorluğuna göre motor bütçesi.
//
// NEDEN AYRI: Tek bir "her araçta 3 motor + sentez" politikası, desi hesabı gibi
// deterministik bir iş için gereksiz kota yakarken hukuki/uyum kararında yeterli
// çapraz kontrolü garanti etmiyordu. Bu dosya her aracın iş riskini açıkça
// sınıflandırır:
//   fast     → 1 motor, sentez yok: yerel hesaplayıcı + kısa AI yorumu
//   balanced → 2 motor, sentez yok: yapılandırılmış üretim/çıkarım
//   deep     → 3 motor + editör sentezi: para, sözleşme, mevzuat ve büyüme kararı
//
// Profil yalnız ÇAĞRI SAYISINI değil sıcaklığı da belirler. Böylece her modül
// kendi amacına uygun çalışır; örneğin fiyat/maliyet işleri düşük sıcaklıkta
// kararlı kalır, reklam kancası gibi yaratıcı işler daha geniş aralıkta üretir.
import type { ToolId } from "./tools-prompts.server";

export type ToolDepth = "fast" | "balanced" | "deep";

export type ToolAiProfile = {
  depth: ToolDepth;
  /** İlk dalgada paralel çağrılacak en fazla motor sayısı (1-3). */
  maxDrafts: 1 | 2 | 3;
  /** En az iki taslak varsa editör turu çalışsın mı? */
  synthesize: boolean;
  temperature: number;
  /** Arayüzde/teşhiste gösterilebilecek kısa gerekçe. */
  reason: string;
};

export const TOOL_AI_PROFILES = {
  // ---- SOURCING ----
  "supplier-negotiator": {
    depth: "deep",
    maxDrafts: 3,
    synthesize: true,
    temperature: 0.35,
    reason: "Para ve tedarik ilişkisi: farklı tonları karşılaştırıp editörle birleştir.",
  },
  "offer-analyzer": {
    depth: "deep",
    maxDrafts: 3,
    synthesize: true,
    temperature: 0.25,
    reason: "Gizli maliyet/Incoterm denetimi: tek motorun kaçırdığı kalem kalmasın.",
  },
  "legitimacy-detector": {
    depth: "deep",
    maxDrafts: 3,
    synthesize: true,
    temperature: 0.2,
    reason: "Dolandırıcılık riski: düşük sıcaklık + canlı sayfa kanıtı + çapraz kontrol.",
  },
  "review-spec-sheet": {
    depth: "balanced",
    maxDrafts: 2,
    synthesize: false,
    temperature: 0.3,
    reason: "Yorumlardan yapılandırılmış şartname: iki çıkarım yeterli.",
  },
  "compliance-check": {
    depth: "deep",
    maxDrafts: 3,
    synthesize: true,
    temperature: 0.2,
    reason: "Gating/mevzuat: yanlış cevap hesap askıya alınması demek.",
  },

  // ---- FINANCE ----
  "reverse-cost": {
    depth: "fast",
    maxDrafts: 1,
    synthesize: false,
    temperature: 0.2,
    reason: "Yerel maliyet motoru hesabı yapar; AI yalnız yorum/aksiyon ekler.",
  },
  "landed-cost": {
    depth: "fast",
    maxDrafts: 1,
    synthesize: false,
    temperature: 0.2,
    reason: "Formül deterministik; canlı kur bağlamı tek motor için yeterli.",
  },
  "capital-planner": {
    depth: "fast",
    maxDrafts: 1,
    synthesize: false,
    temperature: 0.2,
    reason: "Nakit planı yerel hesaplandı; tek motor gerekçeyi üretir.",
  },
  "desi-optimizer": {
    depth: "fast",
    maxDrafts: 1,
    synthesize: false,
    temperature: 0.25,
    reason: "Desi/kademe hesabı kesin; yaratıcı çok motorlu tur gereksiz.",
  },
  "milestone-shield": {
    depth: "deep",
    maxDrafts: 3,
    synthesize: true,
    temperature: 0.25,
    reason: "Ödeme/teslim tetikleyicileri: hukuki ve operasyonel risk yüksek.",
  },
  "hs-classifier": {
    depth: "deep",
    maxDrafts: 3,
    synthesize: true,
    temperature: 0.2,
    reason: "HS/HTS sınıflandırması: alternatif kodları ve ceza riskini çapraz kontrol et.",
  },

  // ---- GROWTH ----
  consensus: {
    depth: "deep",
    maxDrafts: 3,
    synthesize: false,
    temperature: 0.4,
    reason: "Kendi 6 motorlu konsey hattı var; bu profil yalnız ortak sözleşmeyi taşır.",
  },
  "bundle-booster": {
    depth: "balanced",
    maxDrafts: 2,
    synthesize: false,
    temperature: 0.5,
    reason: "Yaratıcı bundle fikirleri: iki bağımsız bakış yeterli.",
  },
  "lead-time": {
    depth: "fast",
    maxDrafts: 1,
    synthesize: false,
    temperature: 0.2,
    reason: "Tarih/sipariş noktası yerel hesaplanır; AI gecikme senaryosu yazar.",
  },
  "arbitrage-matrix": {
    depth: "deep",
    maxDrafts: 3,
    synthesize: true,
    temperature: 0.25,
    reason: "Çok pazarlı vergi/komisyon karşılaştırması: tek motor yeterli değil.",
  },
  "ad-hook-extractor": {
    depth: "balanced",
    maxDrafts: 2,
    synthesize: false,
    temperature: 0.55,
    reason: "Yaratıcı kanca çıkarımı: çeşitlilik önemli, ağır sentez gereksiz.",
  },
  "competitor-intel": {
    depth: "deep",
    maxDrafts: 3,
    synthesize: true,
    temperature: 0.3,
    reason: "Rakip stratejisi: fiyat, yorum ve konumlandırmayı çapraz doğrula.",
  },
  "growth-plan": {
    depth: "deep",
    maxDrafts: 3,
    synthesize: true,
    temperature: 0.35,
    reason: "90 günlük plan: birim ekonomi + faz + bütçe aynı cevapta tutarlı olmalı.",
  },

  // ---- LISTING ----
  "listing-seo": {
    depth: "balanced",
    maxDrafts: 2,
    synthesize: false,
    temperature: 0.35,
    reason: "Kanal limitli metin: iki taslak, tek kanal kuralı.",
  },
  "listing-visual": {
    depth: "balanced",
    maxDrafts: 2,
    synthesize: false,
    temperature: 0.5,
    reason: "Görsel brief: yaratıcı çeşitlilik, düşük hukuki risk.",
  },
  "review-sentiment": {
    depth: "balanced",
    maxDrafts: 2,
    synthesize: false,
    temperature: 0.25,
    reason: "Tema/duygu çıkarımı: iki motor yeterli, uydurma riski düşük.",
  },
  "price-strategy": {
    depth: "balanced",
    maxDrafts: 2,
    synthesize: false,
    temperature: 0.25,
    reason: "Fiyat bandı: yerel maliyet + iki bağımsız strateji kontrolü.",
  },

  // ---- NEWS ----
  news: {
    depth: "fast",
    maxDrafts: 1,
    synthesize: false,
    temperature: 0.5,
    reason: "Zeminli haber özeti: tek çağrı; kaynak RSS/Google grounding ile doğrulanır.",
  },
} as const satisfies Record<ToolId, ToolAiProfile>;

/**
 * Ücretsiz canlı veri ihtiyacı. Yalnız gerçekten karar değiştiren araçlara
 * bağlanır; her araca ağ çağrısı eklemek gecikmeyi ve dış bağımlılığı artırır.
 */
export type FreeDataNeed = "fx" | "supplier-page" | "rss-news";

export const TOOL_FREE_DATA: Partial<Record<ToolId, readonly FreeDataNeed[]>> = {
  "reverse-cost": ["fx"],
  "landed-cost": ["fx"],
  "capital-planner": ["fx"],
  "milestone-shield": ["fx"],
  "arbitrage-matrix": ["fx"],
  "price-strategy": ["fx"],
  "legitimacy-detector": ["supplier-page"],
  news: ["rss-news"],
};

export function toolAiProfile(tool: string): ToolAiProfile | null {
  return (TOOL_AI_PROFILES as Record<string, ToolAiProfile | undefined>)[tool] ?? null;
}
