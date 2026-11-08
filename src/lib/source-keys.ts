// ============================================================================
// ÜRÜN KAYNAĞI ANAHTARLARI — YALNIZ VAR/YOK, ASLA DEĞER.
//
// NEDEN AYRI MODÜL: `/health` ve `/api/public/build-info` gibi hafif teşhis
// uçları, koca product-discovery modülünü (tüm kazıyıcılar) yüklemek zorunda
// kalmadan "hangi kaynak gerçekten kullanılabilir?" sorusunu yanıtlayabilmeli.
//
// SÖZLEŞME:
//   • Anahtar DEĞERİ okunmaz, yazılmaz, loglanmaz; yalnız adı ve var/yok.
//   • eBay'de tek bir anahtar yeterli değildir: Bearer VEYA Client ID + Secret
//     gerekir. Yarım kimlik "ölçüldü" sayılmaz (bu yüzden `key` adı öneridir).
//   • Google Shopping tek koordinatördür; hangi sağlayıcıların tanımlı olduğu
//     `providers` alanında kota genişliği sırasıyla görünür.
// ============================================================================

import {
  ebayClientId,
  ebayClientSecret,
  ebayCredentialsConfigured,
  ebayStaticToken,
} from "./ebay-auth.server";
import {
  googleShoppingProviderPlan,
  type GoogleShoppingProvider,
} from "./google-shopping.server";

export const KEYED_SOURCE_ENV: Readonly<Record<string, readonly string[]>> = {
  "bestbuy-api": ["BESTBUY_API_KEY", "BEST_BUY_API_KEY"],
  "ebay-browse": [
    "EBAY_OAUTH_TOKEN",
    "EBAY_BEARER_TOKEN",
    "EBAY_ACCESS_TOKEN",
    // Client ID tek başına yetmez: Browse jetonu için Secret (veya hazır
    // Bearer) gerekir. ID'yi yeterli saymak "ölçüldü" yalanı üretirdi.
    "EBAY_CLIENT_SECRET",
    "EBAY_CERT_ID",
  ],
  "tavily-search": ["TAVILY_API_KEY", "TAVILY_KEY"],
  "tr-marketplace": ["SCRAPERAPI_KEY", "SCRAPI_KEY", "SCRAP_API_KEY"],
  // Tek koordinatör: bu anahtarlardan HERHANGİ biri varsa Google Shopping
  // ölçülebilir. Sıra, kota genişliğine göre birincil sağlayıcıyı belirler.
  "google-shopping": [
    "SERPER_API_KEY",
    "SERPER_KEY",
    "SERPER_DEV_API_KEY",
    "SEARCHAPI_KEY",
    "SEARCHAPI_API_KEY",
    "SEARCHAPI_IO_KEY",
    "SERPAPI_KEY",
    "SERP_API_KEY",
    "SERPAPI_API_KEY",
  ],
  "youtube-attention": ["YOUTUBE_API_KEY", "YOUTUBE_DATA_API_KEY"],
};

export type SourceKeyReadiness = {
  source: string;
  configured: boolean;
  /** Kullanıcıdan istenecek ilk anahtar adı (değer değil). */
  key: string;
  /** Yalnız `google-shopping`: tanımlı sağlayıcılar, kota sırasıyla. */
  providers?: GoogleShoppingProvider[];
};

function hasAny(env: Record<string, string | undefined>, keys: readonly string[]): boolean {
  return keys.some((name) => (env[name] ?? "").trim() !== "");
}

/**
 * eBay için TEK bir env adı söylemek yanıltıcı olabilir: Browse jetonu ya
 * Bearer ya da Client ID + Secret ister. Hangi tarafın eksik olduğunu
 * (değerini değil) söyleyerek kullanıcının doğru anahtarı eklemesini sağlar.
 */
function ebayKeyHint(env: Record<string, string | undefined>): string {
  const bearer = Boolean(ebayStaticToken(env));
  const id = Boolean(ebayClientId(env));
  const secret = Boolean(ebayClientSecret(env));
  if (bearer || (id && secret)) return "EBAY_OAUTH_TOKEN";
  if (id && !secret) return "EBAY_CLIENT_SECRET (Client ID var)";
  if (!id && secret) return "EBAY_CLIENT_ID (Secret var)";
  return "EBAY_CLIENT_ID + EBAY_CLIENT_SECRET";
}

/**
 * Kaynak başına kullanılabilirlik. Sır içermez.
 *
 * eBay özel: yarım kimlik (yalnız Client ID veya yalnız Secret) `configured`
 * SAYILMAZ; ağ çağrısı yapılamaz. Google Shopping özel: koordinatörün
 * sağlayıcı planı boşsa kaynak kullanılamaz.
 */
export function sourceKeyReadiness(
  env: Record<string, string | undefined> = process.env,
): SourceKeyReadiness[] {
  return Object.entries(KEYED_SOURCE_ENV).map(([source, keys]) => {
    const providers = source === "google-shopping" ? googleShoppingProviderPlan(env) : undefined;
    const configured =
      source === "ebay-browse"
        ? ebayCredentialsConfigured(env)
        : providers
          ? providers.length > 0
          : hasAny(env, keys);
    return {
      source,
      configured,
      key: source === "ebay-browse" ? ebayKeyHint(env) : (keys[0] ?? ""),
      ...(providers ? { providers } : {}),
    };
  });
}

/** Anahtarı tanımlı olmayan kaynaklar (ad + panelde istenecek ilk anahtar). */
export function missingKeyedSources(
  env: Record<string, string | undefined> = process.env,
): { source: string; key: string }[] {
  return sourceKeyReadiness(env)
    .filter((row) => !row.configured)
    .map(({ source, key }) => ({ source, key }));
}
