import { createFileRoute } from "@tanstack/react-router";
import { guardPublic } from "@/lib/api-guard.server";
import {
  resolveVerifiedProductImage,
  verifiedImageProxyConfigured,
} from "@/lib/product-image-source.server";
import type { ImageValidationStatus } from "@/lib/product-image-verification";

// Simple in-memory cache (per worker instance). Key: canonical PRODUCT URL.
const cache = new Map<string, { url: string; source: string; at: number }>();
const TTL_MS = 1000 * 60 * 60 * 24; // 24h
const MAX_CACHE_ENTRIES = 2000; // bound memory under abusive unique queries

function cacheSet(key: string, value: { url: string; source: string; at: number }) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Evict oldest entry (Map preserves insertion order).
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=86400",
};

export const Route = createFileRoute("/api/public/product-image")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      /**
       * DOĞRULANMIŞ ÜRÜN GÖRSELİ.
       *
       * SÖZLEŞME DEĞİŞTİ (`?q=<ürün adı>` → `?u=<ürün sayfası adresi>`):
       * eski uç ürün ADINA görsel araması yapıp dönen İLK fotoğrafı
       * ürünün fotoğrafı sanıyordu. Oysa arama motoru ürünün varlığına kanıt
       * değildir; dönen görsel logonun, banner'ın ya da BAŞKA bir ürünün
       * fotoğrafı olabiliyordu. Artık görsel YALNIZCA ürünün kendi sayfasından
       * (JSON-LD → ürün `<img>` → og:image) ve kapılardan geçerek gelir.
       *
       * DOĞRULANAMAZSA `url: null` DÖNER — asla stok, yer tutucu veya
       * "benzer" bir fotoğraf gönderilmez. Arayüz bu durumu açıkça gösterir.
       *
       * `?q=` hâlâ kabul edilir ama GÖRSEL DÖNDÜRMEZ; uydurmayı engellemek
       * için yalnız açıklayıcı bir durum döner (istemci eski sözleşmeyi
       * kullansa bile yanlış fotoğraf görmez).
       */
      GET: async ({ request }) => {
        const limited = await guardPublic(request, "product-image", 240, 60);
        if (limited) return limited;
        const url = new URL(request.url);
        const productUrl = (url.searchParams.get("u") || "").trim().slice(0, 500);
        const legacyQuery = (url.searchParams.get("q") || "").trim().slice(0, 120);

        if (!productUrl) {
          return Response.json(
            {
              url: null,
              source: null,
              verified: false,
              imageValidationStatus: "unverified_no_product_page" as ImageValidationStatus,
              reason: legacyQuery
                ? "Ürün adına görsel araması yapılmaz; doğrulanmış ürün görseli için ürün sayfası adresi (?u=) gerekir."
                : "Eksik parametre: ?u=<ürün sayfası adresi>",
              scrapapi: verifiedImageProxyConfigured(),
            },
            { headers: CORS },
          );
        }

        const key = productUrl.toLowerCase();
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < TTL_MS) {
          return Response.json(
            { url: hit.url, source: hit.source, verified: true, cached: true },
            { headers: CORS },
          );
        }

        const image = await resolveVerifiedProductImage(productUrl, "");
        if (!image.imageUrl) {
          return Response.json(
            {
              url: null,
              source: null,
              verified: false,
              imageValidationStatus: image.imageValidationStatus,
              reason: image.reason,
              cached: false,
              scrapapi: verifiedImageProxyConfigured(),
            },
            { headers: CORS },
          );
        }
        cacheSet(key, { url: image.imageUrl, source: image.imageSource ?? "", at: Date.now() });
        return Response.json(
          {
            url: image.imageUrl,
            source: image.imageSource,
            verified: true,
            imageValidationStatus: image.imageValidationStatus,
            cached: false,
          },
          { headers: CORS },
        );
      },
    },
  },
});
