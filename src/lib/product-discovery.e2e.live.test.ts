/**
 * PRODUCT DISCOVERY — UÇTAN UCA CANLI AĞ TESTİ (75 → 25 → 5).
 *
 * Bu dosyanın varlık sebebi: hattın dört adımı (scrape_filter → gemini →
 * deep → final) daha önce HİÇBİR ZAMAN gerçek ağda, uçtan uca çalıştırılmamıştı.
 * Kaynak testleri yalnız `runSources` + filtreyi ölçüyordu; adım geçişleri,
 * ürün sayıları ve nihai listenin gerçekten oluştuğu hiç doğrulanmamıştı.
 *
 * Burada ölçülen söz:
 *   1. NİŞ kazınır (gerçek ağ, fail-soft, $0).
 *   2. Deterministik hard filter + ön skorlama → en iyi 75.
 *   3. Gemini 75 → 25 seçer. ANAHTAR YOKSA deterministik yedeğe düşer —
 *      hat düşmez, sadece seçim kuralı değişir.
 *   4. 14 ajan her ürünü oylar (deterministik; ajan hatası ürünü düşürmez).
 *   5. Uzlaşma → en iyi 5 ürün + 14 ajan skoru + kanıt.
 *
 * ÇALIŞTIRMA:
 *   PRODUCT_DISCOVERY_E2E_LIVE=1 \
 *   PRODUCT_DISCOVERY_E2E_NICHES="air fryer,robot vacuum" \
 *   npx vitest run src/lib/product-discovery.e2e.live.test.ts
 *
 * KAPSAM DIŞI: kredi, oturum, QStash, Supabase yazımı. Bunlar
 * `/api/product-discovery/*` uçlarının işidir; bu test saf hattın
 * "verilen nişte gerçekten ürün çıkıyor mu" sorusunu yanıtlar.
 */
import { describe, expect, it } from "vitest";

import { runCouncilOnProducts } from "./product-discovery-council.server";
import {
  DISCOVERY_TOP_N,
  GEMINI_SHORTLIST_SIZE,
  runDeepAnalysisStep,
  runFinalRankStep,
  runGeminiShortlistStep,
  runScrapeFilterStep,
} from "./product-discovery-pipeline.server";
import type { NormalizedProduct } from "./product-discovery.types";

const LIVE = process.env.PRODUCT_DISCOVERY_E2E_LIVE === "1";
const NICHES = (process.env.PRODUCT_DISCOVERY_E2E_NICHES ?? "air fryer,robot vacuum")
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean);

describe.skipIf(!LIVE)("Product Discovery uçtan uca (canlı ağ)", () => {
  for (const niche of NICHES) {
    it(`"${niche}": kazıma → 75 → 25 → 14 ajan → 5 ürün`, async () => {
      const t0 = Date.now();

      // ---- ADIM 1-2: kazıma + deterministik filtre → en iyi 75 -------------
      const scrape = await runScrapeFilterStep(niche, "US", "General", DISCOVERY_TOP_N);
      const tScrape = Date.now() - t0;
      const stats = scrape.stats as
        | {
            inputCount: number;
            survivors: number;
            rejectedByRating: number;
            rejectedByPrice: number;
            rejectedByDuplicate: number;
            rejectedByCompleteness: number;
          }
        | undefined;

      console.log(
        `[E2E] "${niche}" · kazıma ${tScrape}ms · ${stats?.inputCount ?? 0} ham → ` +
          `${stats?.survivors ?? 0} kalan (puan:${stats?.rejectedByRating ?? 0} ` +
          `fiyat:${stats?.rejectedByPrice ?? 0} dup:${stats?.rejectedByDuplicate ?? 0} ` +
          `eksik:${stats?.rejectedByCompleteness ?? 0})`,
      );

      expect(scrape.ok).toBe(true);
      expect(scrape.products.length).toBeGreaterThan(0);
      // 75 üst sınırı ASLA aşılmaz.
      expect(scrape.products.length).toBeLessThanOrEqual(DISCOVERY_TOP_N);

      // ---- ADIM 3: Gemini 75 → 25 ----------------------------------------
      const tGemini = Date.now();
      const shortlist = await runGeminiShortlistStep(scrape.products, niche, GEMINI_SHORTLIST_SIZE);
      const tShortlist = Date.now() - tGemini;
      console.log(
        `[E2E] "${niche}" · kısa liste ${tShortlist}ms · ${scrape.products.length} → ` +
          `${shortlist.products.length} · ${shortlist.notes.join(" | ")}`,
      );
      expect(shortlist.ok).toBe(true);
      expect(shortlist.products.length).toBeGreaterThan(0);
      expect(shortlist.products.length).toBeLessThanOrEqual(GEMINI_SHORTLIST_SIZE);

      // ---- ADIM 4: 14 ajan her adayı oylar --------------------------------
      const tCouncil = Date.now();
      const deep = await runDeepAnalysisStep(shortlist.products, niche, runCouncilOnProducts);
      const tDeep = Date.now() - tCouncil;
      console.log(`[E2E] "${niche}" · konsey ${tDeep}ms · ${deep.consensus.length} uzlaşma kaydı`);
      expect(deep.ok).toBe(true);
      expect(deep.consensus.length).toBe(shortlist.products.length);
      for (const c of deep.consensus) {
        expect(c.votes).toBe(14);
        expect(c.coverage).toBe(1);
      }

      // ---- ADIM 5: uzlaşma → en iyi 5 --------------------------------------
      const byId = new Map<string, NormalizedProduct>(
        deep.products.map((p) => [String(p.fingerprint ?? ""), p]),
      );
      const ranked = runFinalRankStep(deep.consensus, 5, byId);
      const total = Date.now() - t0;
      console.log(
        `[E2E] "${niche}" · TAMAM ${total}ms · ${ranked.products.length} ürün kullanıcıya gider`,
      );
      for (const p of ranked.products) {
        console.log(
          `   ${Math.round(p.councilScore)}/100 güven${Math.round(p.confidenceScore)} · ` +
            `${p.dataCompleteness}/5 · ${p.priceUsd !== null ? `$${p.priceUsd}` : "fiyat yok"} · ` +
            `${p.rating !== null ? `${p.rating}★ (${p.ratingCount ?? 0})` : "puan yok"} · ${p.name.slice(0, 54)}`,
        );
      }

      expect(ranked.ok).toBe(true);
      // KRİTİK SÖZ: konsayl skoru taşır ama ÜRÜNÜ taşımaz. Ölçek eşleşmezse
      // arayüz boş kalır — bu testin asıl varlık sebebinden biri.
      expect(ranked.products.length).toBeGreaterThan(0);
      expect(ranked.products.length).toBeLessThanOrEqual(5);
      for (const p of ranked.products) {
        expect(p.name.length).toBeGreaterThan(0);
        expect(p.votes).toBe(14);
        expect(p.councilScore).toBeGreaterThan(0);
      }

      // Zaman sözü: Vercel Hobby fonksiyon tavanı 300 sn. Adım adım pay
      // bölündüğü için tek adım çok altında kalmalı.
      expect(total).toBeLessThan(120_000);
    });
  }
});
