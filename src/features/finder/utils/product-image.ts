import { useEffect, useState } from "react";

import type { WinningProduct } from "@/lib/gemini.functions";
import { classifyImageUrl } from "@/lib/product-image-verification";

/**
 * ÜRÜN GÖRSELİ — ARAYÜZ SÖZLEŞMESİ.
 *
 * DEĞİŞME (ölçülen hata, kullanıcı: "fotoğraflar çok alakasız"):
 *   Eski sürüm, kaynaktan gelen görsel yoksa ürün ADINA web görsel araması
 *   yapıyordu (`/api/public/product-image?q=<ürün adı>`) ve dönen İLK fotoğrafı
 *   ürünün fotoğrafı olarak gösteriyordu. Arama motoru ürünün varlığına kanıt
 *   değildir: logonun, banner'ın, kategori karosunun ya da BAŞKA bir ürünün
 *   fotoğrafını döndürebiliyor. Bu tam olarak "uydurma görsel" idi.
 *
 *   Artık kural tek cümlelik:
 *     GÖRSEL = ÜRÜNÜN KENDİ SAYFASINDAN DOĞRULANMIŞ FOTOĞRAF.
 *   Doğrulanamıyorsa arayüz AÇIKÇA "doğrulanamadı" der — boş kutu değil.
 *
 * AI'ın ürettiği `image_url` de aynı kapıdan geçer: gerçek bir adres değilse
 * ya da logo/yer tutucu desenine düşüyorsa KULLANILMAZ (bkz. §15 — AI ürün
 * verisi üretmez, yalnız analiz eder).
 */

/** Kaynak/AI tarafından verilen ham adres — kapıdan geçerse `null` değil, URL döner. */
export function resolveProductImage(p: WinningProduct): string | null {
  const u = typeof p?.image_url === "string" ? p.image_url.trim() : "";
  if (!u) return null;
  // `classifyImageUrl` stok görsel servislerini, logoları, ikonları ve izleme
  // piksellerini eler; geçerse adres gerçek bir ürün fotoğrafı olabilir.
  return classifyImageUrl(u) ? null : u;
}

// Client-side cache to avoid refetching the same product image.
const _imgCache = new Map<string, string>();

/**
 * Ürünün KENDİ SAYFASINDAN doğrulanmış fotoğrafı getirir.
 *
 * @param productUrl ürünün gerçek kaynak adresi (arama sonucu adresi DEĞİL).
 *                  Boşsa HİÇBİR istek atılmaz ve `null` döner.
 */
export function useVerifiedProductImage(productUrl: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const key = productUrl.trim().toLowerCase();
    if (!key) {
      setUrl(null);
      return;
    }
    const hit = _imgCache.get(key);
    if (hit) {
      setUrl(hit);
      return;
    }
    let cancelled = false;
    fetch(`/api/public/product-image?u=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { url?: string | null } | null) => {
        // Yalnız DOĞRULANMIŞ (`verified: true`) adresler önbelleğe girer.
        if (cancelled || !d?.url) return;
        _imgCache.set(key, d.url);
        setUrl(d.url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [productUrl]);
  return url;
}

/**
 * Kartın tek giriş noktası.
 *
 * Sıra: (1) kaynaktan gelen ve kapıdan geçen ölçülmüş görsel, (2) yoksa ürünün
 * kendi sayfasından doğrulanmış görsel. İkisi de yoksa `null` döner ve kart
 * "Görsel doğrulanamadı" durumunu gösterir — asla yer tutucu fotoğraf göstermez.
 */
export function useCardProductImage(p: WinningProduct): string | null {
  const measured = resolveProductImage(p);
  const sourceUrl = typeof p?.source_url === "string" ? p.source_url : "";
  const fetched = useVerifiedProductImage(measured ? "" : sourceUrl);
  return measured ?? fetched;
}
