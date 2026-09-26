// ============================================================================
// AJAN UZMANLIK DİLİMLERİ — her ajan kendi alanının KANITINI ayrıca görür.
//
// SORUN: 14 ajanın hepsi aynı genel kanıt bloğunu okuyordu. Bir mali müşavir
// (`cfo`) ile bir telif denetçisi (`cro`) aynı ham metni görüyor, ama
// BİRİMİNİN İŞİNİ GÖRMEDİĞİ veriler oradaydı: fiyat aralığı CFO'nun, şikâyet
// cümlesi UX'in, sertifika bariyeri uyumun, teslimat süresi tedarikçinin.
// Genel blokta kaybolan bu alanlar, ajanın puanını "hissine" bırakıyordu.
//
// ÇÖZÜM: Aynı kazıma, 14 farklı LENS ile yeniden okunur. Her dilim:
//   • yalnız o ajanın kararını etkileyen ÖLÇÜLMÜŞ alanları içerir,
//   • eksik veriyi açıkça "VERİ YOK" diye söyler (ajan nötr puan verir),
//   • YENİ BİR SAYI ÜRETMEZ — hepsi `NicheSignals`ten türetilir.
//
// Saf modül: ağ yok, AI çağrısı yok, maliyet sıfır. Test edilebilir.
// ============================================================================

import { COUNCIL_AGENTS, type CouncilAgentKey } from "./council-chain.server";
import { countryBarrierFor } from "./market-barriers";
import {
  complaintCount,
  medianPrice,
  platformCount,
  priceSpread,
  redditEngagement,
  type NicheSignals,
} from "./velora-niche-signals";

/** Ürün adları + kategorileri — bariyer/marka taraması için birleşik metin. */
function productText(names: readonly string[]): string {
  return names.join(" · ");
}

const n1 = (value: number): string => String(Math.round(value * 10) / 10);
const usd = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "no data"
    : `$${Math.round(value * 100) / 100}`;

/** "VERİ YOK" satırı — ajanın nötr puan vermesinin meşru dayanağı. */
const NO_DATA = "VERİ YOK";

/** Fiyat tarafının tek satırlık özeti (CFO, pricing, logistics ortak). */
function priceLine(signals: NicheSignals): string {
  const spread = priceSpread(signals.priceSamples);
  const median = signals.retailMedianUsd ?? medianPrice(signals.priceSamples);
  if (median === null)
    return `GÖZLENEN PERAKENDE FİYAT: ${NO_DATA} — fiyat uydurma, nötr puan ver.`;
  return [
    `GÖZLENEN PERAKENDE FİYAT: medyan ${usd(median)} (${platformCount(signals.priceSamples)} kanal, ${signals.priceSamples.length} ilan)`,
    spread
      ? `FİYAT ARALIĞI: ${usd(spread.min)} – ${usd(spread.max)} (en yüksek/en düşük = ${n1(spread.ratio)}x)`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Tedarik maliyeti tarafının tek satırlık özeti. */
function sourcingLine(signals: NicheSignals): string {
  const s = signals.supplier;
  if (!s) return `TEDARİKÇİ MALİYETİ: ${NO_DATA} — maliyet uydurma, nötr puan ver.`;
  const landed = s.priceUsd + s.shippingUsd;
  return [
    `TEDARİKÇİ MALİYETİ: ürün ${usd(s.priceUsd)} + navlun ${usd(s.shippingUsd)} = toplam ${usd(landed)}`,
    s.live
      ? `KAYNAK: canlı kazınmış fiyat (${s.samples} ilan${
          s.currency !== "USD" && s.fxRate
            ? `, ${s.currency}→USD kuruş ${n1(s.fxRate)} @ ${s.fxSource}`
            : ""
        })`
      : "KAYNAK: TAHMİN (kazıma dönmedi) — düşük güvenle değerlendir",
    s.sampleTitle ? `ÖRNEK İLAN: ${s.sampleTitle.slice(0, 90)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Talep tarafının tek satırlık özeti (trend, sosyal, topluluk). */
function demandLine(signals: NicheSignals): string {
  const bits: string[] = [];
  bits.push(
    signals.trendMomentumPct === null
      ? "Google Trends momentum: ÖLÇÜLEMEDİ"
      : `Google Trends momentum: ${signals.trendMomentumPct > 0 ? "+" : ""}${signals.trendMomentumPct}%`,
  );
  if (signals.trendSeries.length)
    bits.push(`12 aylık ilgi (son 6): ${signals.trendSeries.slice(-6).join(",")}`);
  if (signals.tiktok.length) bits.push(`TikTok sinyali: ${signals.tiktok.slice(0, 4).join(" | ")}`);
  if (signals.googleRising.length)
    bits.push(`Yükselen sorgu: ${signals.googleRising.slice(0, 4).join(" | ")}`);
  if (signals.amazonMovers.length)
    bits.push(`Amazon hareketlilik: ${signals.amazonMovers.slice(0, 4).join(" | ")}`);
  if (signals.reddit.length)
    bits.push(
      `Reddit ARŞİVİ ilgi yoğunluğu: ${redditEngagement(signals.reddit)} (${signals.reddit.length} başlık, ${complaintCount(signals.reddit)} şikâyet) — arşiv canlı değil günceldir`,
    );
  if (signals.hackerNews.length)
    bits.push(
      `Teknik topluluk: ${signals.hackerNews.length} tartışma, ${signals.hackerNews.reduce((t, h) => t + h.points, 0)} puan`,
    );
  return bits.join(" · ");
}

/** Rekabet tarafının özeti. */
function competitionLine(signals: NicheSignals): string {
  const bits: string[] = [];
  if (signals.priceSamples.length)
    bits.push(
      `${signals.priceSamples.length} rakep ilanı, ${platformCount(signals.priceSamples)} farklı kanal`,
    );
  if (signals.amazonMovers.length)
    bits.push(
      `Amazon'da ${signals.amazonMovers.length} ürün yükseliyor (kategori doygunluğu sinyali)`,
    );
  if (signals.radar.length) bits.push(`Trend radarı: ${signals.radar.length} canlı trend satırı`);
  if (signals.github.length) bits.push(`Açık kaynak: ${signals.github.length} ilgili depo`);
  return bits.length ? bits.join(" · ") : `REKABET KANITI: ${NO_DATA}`;
}

/** Sektörel haber bağlamı ("neden şimdi"). */
function newsLine(signals: NicheSignals): string {
  if (!signals.news.length) return `SEKTÖR HABERİ: ${NO_DATA}`;
  return `SEKTÖR HABERİ: ${signals.news
    .slice(0, 4)
    .map((n) => n.title.slice(0, 110))
    .join(" | ")}`;
}

/** Her ajanın kendi lens'i. Dönen metin ajan istemine "UZMANLIK KANITI" olarak girer. */
export type AgentFocusSlice = {
  /** Ajanın o alanda bakması gereken, kısa ve kesin talimat. */
  directive: string;
  /** Yalnız bu alana ait ÖLÇÜLMÜŞ satırlar. */
  lines: string[];
};

function buildSlice(
  key: CouncilAgentKey,
  signals: NicheSignals,
  names: readonly string[],
): AgentFocusSlice {
  const text = productText(names);
  switch (key) {
    case "cfo": {
      const median = signals.retailMedianUsd;
      const landed = signals.supplier
        ? signals.supplier.priceUsd + signals.supplier.shippingUsd
        : null;
      const gross =
        median !== null && landed !== null && landed > 0
          ? Math.round(((median - landed) / median) * 1000) / 10
          : null;
      return {
        directive:
          "Kârı yalnız FİYAT − TEDARİK farkından oku. Gözlenen fiyat yoksa veya tedarik maliyeti tahminse marj iddiası yapma; unit_economics_valid=false ver.",
        lines: [
          priceLine(signals),
          sourcingLine(signals),
          gross === null
            ? `GÖZLENEN BRÜT MARJ: ${NO_DATA} (fiyat veya maliyet eksik)`
            : `GÖZLENEN BRÜT MARJ: ~%${gross} (gözlenen medyan perakende − gözlenen toplam tedarik; navlun hariç ek kalemler YOK)`,
        ],
      };
    }
    case "cmo": {
      return {
        directive:
          "Hedef kitleyi ve ROAS'u TALEP kanıtından çıkar. İçerik/talep sinyali zayıfsa yüksek ROAS iddia etme.",
        lines: [
          demandLine(signals),
          `HEDEF KİTLE İPUCU: ${signals.reddit.length ? ` Reddit toplulukları: ${[...new Set(signals.reddit.map((r) => r.subreddit))].join(", ")}` : NO_DATA}`,
          newsLine(signals),
        ],
      };
    }
    case "cro": {
      // Kural tabanlı marka taraması: ürün adlarında TELİF KORUMALI marka izleri.
      // Bu bir hukuk incelemesi değil, "insan eliyle doğrulanmalı" işaretidir.
      const risky = names
        .map((n) => n.slice(0, 90))
        .filter((n) => /\b(pro|max|plus|ultra|air|mini|smart|prime|xl|2-in-1)\b/i.test(n));
      return {
        directive:
          "Marka/IP riskini yalnız ÜRÜN ADINDAKİ marka benzeri kalıplardan ve kanıttaki satıcı markalarından oku. trademark_cleared=false ise bunu kullanıcıya doğrulatma işi bırak.",
        lines: [
          `MARKA İZİ TARAMA (kural tabanlı, hukuki değerlendirme değildir): ${
            risky.length
              ? `dikkat gerektiren adlar: ${risky.join(" | ")}`
              : "tanınmış marka kalıbı bulunmadı"
          }`,
          `GÖRÜLEN SATICI MARKALARI: ${
            signals.priceSamples.length
              ? [...new Set(signals.priceSamples.map((p) => p.platform))].join(", ")
              : NO_DATA
          }`,
          `SERİ İSİM RİSKİ: ${names.length > 1 ? names.length + " finalist aynı listede — marka benzerliği elle kontrol edilmeli" : "tek finalist"}`,
        ],
      };
    }
    case "trend_hunter": {
      return {
        directive:
          "Viraliteyi ÖLÇÜLEN momentum ve topluluk hacminden oku. Momentum yoksa virality_index uydurma, 0 ver.",
        lines: [
          demandLine(signals),
          `VİRAL İŞARETİ: ${
            signals.hackerNews.length
              ? signals.hackerNews
                  .slice(0, 3)
                  .map((h) => `[${h.points}p] ${h.title.slice(0, 80)}`)
                  .join(" | ")
              : NO_DATA
          }`,
          newsLine(signals),
        ],
      };
    }
    case "competitor_intel": {
      return {
        directive:
          "Doygunluğu GÖZLENEN ilan sayısı ve fiyat aralığından çıkar. Rakibin adını/total sayısını uydurma; elinde olanı yaz.",
        lines: [
          competitionLine(signals),
          priceLine(signals),
          `RAKİP SAYISI (gözlenen): ${
            signals.priceSamples.length
              ? signals.priceSamples.length
              : "0 ilan yakalandı — pazar doygunluğu HAKKINDA VERİ YOK"
          }`,
        ],
      };
    }
    case "ux_specialist": {
      const complaints = signals.reddit.filter((r) => r.complaint).slice(0, 4);
      return {
        directive:
          "Duygu ve şikâyeti GERÇEK başlıklardan oku. Şikâyet cümlesi yoksa common_complaint alanına 'veri yok' yaz ve puanı yükseltme.",
        lines: [
          `ŞİKÂYET SİNYALİ: ${complaints.length}/${signals.reddit.length} başlık olumsuz deneyim içeriyor`,
          ...(complaints.length
            ? complaints.map((c) => `- r/${c.subreddit}: ${c.title.slice(0, 130)}`)
            : [`ŞİKÂYET ÖRNEĞİ: ${NO_DATA}`]),
          `OLUMLU ETKİLEŞİM: ${
            signals.reddit.length
              ? `${signals.reddit.length} başlık, ${redditEngagement(signals.reddit)} toplam etkileşim`
              : NO_DATA
          }`,
        ],
      };
    }
    case "supply_chain": {
      return {
        directive:
          "Stok ve teslimat riskini tedarikçi kazımasından oku. Tedarik fiyatı tahminse delivery_days_avg uydurma, 0 ver.",
        lines: [
          sourcingLine(signals),
          `TESLİMAT SÜRESİ: ${NO_DATA} — bu kazımada ölçülmedi; delivery_days_avg=0 ve stock_risk bilinmiyor olarak işaretle.`,
          `KAYNAK ÇEŞİTLİLİĞİ: ${
            signals.priceSamples.length
              ? `${platformCount(signals.priceSamples)} farklı satış kanalı görüldü`
              : NO_DATA
          }`,
        ],
      };
    }
    case "pricing_strategist": {
      const spread = priceSpread(signals.priceSamples);
      return {
        directive:
          "Optimal fiyatı GÖZLENEN fiyat bandından oku. Gözlenen fiyat yoksa optimal_price=0 ver, uydurma.",
        lines: [
          priceLine(signals),
          spread
            ? `FİYAT ESNEKLİĞİ: en düşük ${usd(spread.min)} / en yüksek ${usd(spread.max)} — bu aralık dışına çıkmak rasyonel değil.`
            : `FİYAT ESNEKLİĞİ: ${NO_DATA}`,
          signals.supplier
            ? `MALIYET TABANI: ${usd(signals.supplier.priceUsd + signals.supplier.shippingUsd)} → gözlenen medyanın üzerinde fiyat konumlandır.`
            : `MALIYET TABANI: ${NO_DATA}`,
        ],
      };
    }
    case "logistics_cost": {
      const landed = signals.supplier
        ? signals.supplier.priceUsd + signals.supplier.shippingUsd
        : null;
      const ratio =
        landed !== null && signals.retailMedianUsd && signals.retailMedianUsd > 0
          ? Math.round((landed / signals.retailMedianUsd) * 1000) / 10
          : null;
      return {
        directive:
          "Navlun yükünü TEDARİK fiyatının perakende fiyata oranından oku. Navlun oranı %35'i aşıyorsa kırılgan lojistik demektir.",
        lines: [
          sourcingLine(signals),
          ratio === null
            ? `NAV LUN / PERAKENDE ORANI: ${NO_DATA}`
            : `NAVLUN + MALİYET / PERAKENDE ORANI: ~%${ratio} ${ratio > 35 ? "(YÜKSEK — kırılgan lojistik)" : "(kabul edilebilir)"}`,
        ],
      };
    }
    case "compliance_officer": {
      const barrier = countryBarrierFor(signals.country, text);
      return {
        directive:
          "Uyumu yalnız HEDEF ÜLKE + bilinen sertifika bariyerlerinden oku. Vergi/gümrük hesabı YAPMA; barrier yoksa 'tespit edilmiş engel yok' de, 'izin var' deme.",
        lines: [
          `HEDEF ÜLKE: ${signals.country}`,
          `TESPİT EDİLMİŞ BARIYER: ${
            barrier
              ? `${signals.country} için bilinen gereklilik: ${barrier}`
              : "bilinen sertifika/tescil engeli bulunmadı (izin anlamına gelmez)"
          }`,
          `SINIR ÖTESİ KANALLAR: ${
            signals.priceSamples.length
              ? [...new Set(signals.priceSamples.map((p) => p.platform))].slice(0, 5).join(", ")
              : NO_DATA
          }`,
        ],
      };
    }
    case "retention_ltv": {
      const durable = /\b(reusable|durable|replaceable|filter|refill|spare|kit|set|pack)\b/i.test(
        text,
      );
      return {
        directive:
          "Tekrar satın almayı ÜRÜN KİMLİĞİNDEN ve tüketici şikâyetlerinden çıkar. Tüketilmeyen üründe LTV uydurma.",
        lines: [
          `ÜRÜN KİMLİĞİ: ${text.slice(0, 140) || NO_DATA}`,
          `TEKRAR SATIN ALMA İPUCU (kural tabanlı): ${
            durable
              ? "yeniden tüketilen/değiştirilebilen parça içeriyor — tekrar satın alma olasılığı var"
              : "tek seferlik ürün kalıbı — tekrar satın alma düşük; LTV tahminini düşük tut"
          }`,
          `TÜKETİCİ ŞİKÂYETİ (elde tutma sinyali): ${
            signals.reddit.length
              ? `${complaintCount(signals.reddit)}/${signals.reddit.length} başlık şikâyet`
              : NO_DATA
          }`,
        ],
      };
    }
    case "creative_director": {
      const hooks = signals.tiktok.slice(0, 4);
      return {
        directive:
          "Kanca ve UGC potansiyelini GÖRÜNEN trend adları ve topluluk dilinden oku. Görsel kanıt yoksa hook_strength uydurma.",
        lines: [
          hooks.length
            ? `TİKTOK KANCA FİKİRLERİ (canlı trend adları): ${hooks.join(" | ")}`
            : `TİKTOK KANCA FİKİRLERİ: ${NO_DATA}`,
          `TOPLULUK DİLİ (UGC tonu için): ${
            signals.reddit.length
              ? signals.reddit
                  .slice(0, 4)
                  .map((r) => r.title.slice(0, 90))
                  .join(" | ")
              : NO_DATA
          }`,
          newsLine(signals),
        ],
      };
    }
    case "channel_fit": {
      const channels = [...new Set(signals.priceSamples.map((p) => p.platform))];
      return {
        directive:
          "Kanal uyumunu GÖZLENEN satış kanallarından ve hedef ülkeden oku. Komisyon oranı bilinmiyorsa margin_after_fees=0 ver.",
        lines: [
          `GÖZLENEN KANALLAR: ${channels.length ? channels.join(", ") : NO_DATA}`,
          `HEDEF KANAL: ${signals.platform} · HEDEF ÜLKE: ${signals.country}`,
          `KOMİSYON SONRASI MARJ: ${NO_DATA} — kanal ücretleri bu kazımada ölçülmedi, 0 ver.`,
        ],
      };
    }
    case "independent_data_auditor": {
      const active = signals.sources.filter((s) => s.status === "active" && s.items > 0);
      const failed = signals.sources.filter((s) => s.status === "error");
      return {
        directive:
          "Veri güvenini KAYNAK DURUMU tablosundan hesapla, izlenimden değil. Aktif kaynak 3'ten azsa audit_approved=false.",
        lines: [
          `KAYNAK DURUMU (${active.length}/${signals.sources.length} aktif): ${active.map((s) => `${s.name}=${s.items}`).join(", ") || NO_DATA}`,
          failed.length
            ? `ERİŞİLEMEYEN KAYNAKLAR: ${failed.map((f) => `${f.name} (${f.detail})`).join(", ")}`
            : "TÜM KAYNAKLAR ERİŞİLEBİLDİ",
          `FİYAT KANITI: ${
            signals.retailMedianUsd === null
              ? "gözlenen perakende fiyat YOK"
              : `${usd(signals.retailMedianUsd)} (${signals.priceSamples.length} ilan)`
          } · TEDARİK: ${signals.supplier ? (signals.supplier.live ? "canlı" : "tahmin") : "yok"}`,
        ],
      };
    }
    default: {
      // Yeni bir ajan eklendiğinde sessizce boş dilim üretmek yerine nötr kalınır.
      return {
        directive: "Bu ajan için uzmanlık kanıtı henüz tanımlı değil; ortak kanıtla nötr puan ver.",
        lines: [demandLine(signals)],
      };
    }
  }
}

/**
 * Bir ajanın UZMANLIK DİLİMİ — isteme eklenecek kısa metin.
 *
 * Boş döner o ajanın tanımlı uzmanlık alanı yoksa; bu durum dürüstçe
 * `undefined` ile ayrılır ve istem yalnız ortak kanıtla kurulur.
 */
export function agentFocusBlock(
  key: CouncilAgentKey,
  signals: NicheSignals,
  candidateNames: readonly string[],
): string | undefined {
  const known = COUNCIL_AGENTS.some((agent) => agent.key === key);
  if (!known) return undefined;
  const slice = buildSlice(key, signals, candidateNames);
  return [
    "YOUR SPECIALIST EVIDENCE (scraped BEFORE the council started — only what your role decides on):",
    `ROLE: ${slice.directive}`,
    ...slice.lines.filter(Boolean),
  ].join("\n");
}

/** Testler ve panel için: bir ajanın kaç satırlık kanıt alacağı. */
export function agentFocusLineCount(slice: string | undefined): number {
  return slice ? slice.split("\n").filter(Boolean).length : 0;
}
