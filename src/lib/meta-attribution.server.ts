/**
 * META CAPI ATTRIBUTION — checkout anındaki izinli eşleştirme verisi.
 *
 * NEDEN AYRI TABLO (Paddle `customData` değil):
 *   • `customData` aboneliğe ve YENİLEMELERE kopyalanır. İlk checkout'un IP ve
 *     user-agent'ını aylar sonraki yenilemeye eklemek yanlış eşleştirme olurdu.
 *   • Kişisel veri (IP/UA) ödeme sağlayıcısının işlem kaydına yazılmaz.
 *
 * KURAL: Bu modül YALNIZ açık pazarlama izni verildiğinde çağrılır. `load`
 * ayrıca `consentGranted` bayrağını zorunlu tutar; yanlış kullanımda veri
 * okunmaz. Kayıtlar 7 gün sonra silinir (`cleanup_meta_capi_outbox`).
 */
import { clientIpFromHeaders } from "./client-ip";
import {
  readCookieValue,
  sanitizeMetaBrowserId,
  sanitizeMetaClientIp,
  sanitizeMetaUserAgent,
} from "./meta-capi-user-data";
import type { MetaCapiAttribution } from "./meta-capi.server";

/** Attribution kaydının tutulma süresi (ms) — SQL temizliğiyle aynı sınır. */
export const META_ATTRIBUTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * İstekten yalnız DOĞRULANMIŞ eşleştirme alanlarını çıkarır.
 * Çerez yoksa / IP geçersizse alan atlanır; gönderim devam eder.
 */
export function metaAttributionFromRequest(request: Request): MetaCapiAttribution {
  const headers = request.headers;
  const cookie = headers.get("cookie");
  return {
    fbp: sanitizeMetaBrowserId(readCookieValue(cookie, "_fbp")),
    fbc: sanitizeMetaBrowserId(readCookieValue(cookie, "_fbc")),
    clientIp: sanitizeMetaClientIp(clientIpFromHeaders(headers)),
    userAgent: sanitizeMetaUserAgent(headers.get("user-agent")),
  };
}

type AttributionRow = {
  fbp?: string | null;
  fbc?: string | null;
  client_ip?: string | null;
  client_user_agent?: string | null;
};

type AttributionClient = {
  from(table: string): {
    upsert(
      values: Record<string, unknown>,
      options?: { onConflict?: string },
    ): Promise<{ error: { message: string } | null }>;
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        gte(
          column: string,
          value: string,
        ): {
          maybeSingle(): Promise<{
            data: AttributionRow | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
};

async function attributionClient(): Promise<AttributionClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AttributionClient;
}

/**
 * Checkout transaction'ı için eşleştirme verisini yazar.
 *
 * Çağıran, `marketingConsent === true` olduğunu doğrulamakla yükümlüdür
 * (`createPaddleCheckoutSession`). Hiçbir hata checkout'u DÜŞÜRMEZ; yalnız
 * loglanır ve Purchase daha az eşleştirme alanıyla gönderilir.
 */
export async function saveMetaPurchaseAttribution(args: {
  transactionId: string;
  userId: string;
  attribution: MetaCapiAttribution | null | undefined;
}): Promise<boolean> {
  const transactionId = args.transactionId?.trim();
  const userId = args.userId?.trim();
  if (!transactionId || !userId) return false;

  const fbp = sanitizeMetaBrowserId(args.attribution?.fbp);
  const fbc = sanitizeMetaBrowserId(args.attribution?.fbc);
  const clientIp = sanitizeMetaClientIp(args.attribution?.clientIp);
  const clientUserAgent = sanitizeMetaUserAgent(args.attribution?.userAgent);
  if (!fbp && !fbc && !clientIp && !clientUserAgent) return false;

  try {
    const client = await attributionClient();
    const { error } = await client.from("meta_capi_attribution").upsert(
      {
        transaction_id: transactionId,
        user_id: userId,
        fbp,
        fbc,
        client_ip: clientIp,
        client_user_agent: clientUserAgent,
        created_at: new Date().toISOString(),
      },
      { onConflict: "transaction_id" },
    );
    if (error) {
      console.warn(`[Meta CAPI] attribution yazılamadı: ${error.message}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(
      "[Meta CAPI] attribution yazılamadı:",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

/**
 * Purchase gönderiminden önce eşleştirme verisini okur.
 *
 * `consentGranted` ZORUNLUDUR: izin yoksa hiçbir okuma yapılmaz. 7 günden eski
 * kayıtlar (temizlik henüz koşmadıysa) dikkate alınmaz.
 */
export async function loadMetaPurchaseAttribution(
  transactionId: string,
  opts: { consentGranted: boolean },
): Promise<MetaCapiAttribution | null> {
  if (!opts.consentGranted) return null;
  const id = transactionId?.trim();
  if (!id) return null;

  try {
    const client = await attributionClient();
    const since = new Date(Date.now() - META_ATTRIBUTION_TTL_MS).toISOString();
    const { data, error } = await client
      .from("meta_capi_attribution")
      .select("fbp, fbc, client_ip, client_user_agent")
      .eq("transaction_id", id)
      .gte("created_at", since)
      .maybeSingle();
    if (error) {
      console.warn(`[Meta CAPI] attribution okunamadı: ${error.message}`);
      return null;
    }
    if (!data) return null;

    const attribution: MetaCapiAttribution = {
      fbp: sanitizeMetaBrowserId(data.fbp),
      fbc: sanitizeMetaBrowserId(data.fbc),
      clientIp: sanitizeMetaClientIp(data.client_ip),
      userAgent: sanitizeMetaUserAgent(data.client_user_agent),
    };
    return Object.values(attribution).some(Boolean) ? attribution : null;
  } catch (error) {
    console.warn(
      "[Meta CAPI] attribution okunamadı:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
