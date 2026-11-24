/**
 * META CONVERSIONS API — sunucu tarafı olay gönderimi.
 *
 * NEDEN GEREKLİ: Tarayıcı pikseli reklam engelleyiciler, Safari/ITP ve çerez
 * reddi nedeniyle olay kaybedebilir. Aynı olayı sunucudan da göndermek ölçüm
 * kaybını azaltır. Çift sayımı `event_id` engeller: tarayıcı ve sunucu aynı
 * Paddle işlem kimliği için aynı kimliği gönderir (`purchaseEventId`).
 *
 * GÜVENLİK / GİZLİLİK:
 *   • E-posta ve kullanıcı kimliği Meta'ya ASLA düz metin gitmez; SHA-256 ile
 *     özetlenir (Meta'nın istediği biçim).
 *   • Token yalnızca sunucuda okunur (`META_CAPI_ACCESS_TOKEN`), istemciye
 *     sızmaz. Token yoksa modül sessizce devre dışı kalır — ödeme akışı bu
 *     yüzden ASLA düşmez.
 *   • Hatalar yutulur ama loglanır; webhook yanıtı CAPI'ye bağlı değildir.
 */
import { createHash } from "node:crypto";

import { META_PIXEL_ID, purchaseEventId } from "@/lib/meta-config";

const GRAPH_HOST = "https://graph.facebook.com";
const DEFAULT_API_VERSION = "v23.0";

export type MetaCapiResult = {
  sent: boolean;
  /** Token yoksa gönderim denenmedi. */
  skipped?: "missing_token";
  /** Gönderim denendi ama başarısız oldu (HTTP/network). */
  error?: string;
};

export type MetaCapiUserData = {
  email?: string | null;
  externalId?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
};

export type MetaCapiEventInput = {
  eventName: string;
  eventId?: string | null;
  eventTime?: number;
  eventSourceUrl?: string | null;
  userData?: MetaCapiUserData;
  customData?: Record<string, string | number | boolean | undefined>;
  value?: number;
  currency?: string | null;
};

let warnedMissingToken = false;

/** Meta'nın beklediği biçim: küçük harf, kırpılmış, SHA-256 hex. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** İstenen Graph API sürümü — env ile yükseltilebilir. */
export function metaApiVersion(): string {
  return process.env.META_CAPI_API_VERSION?.trim() || DEFAULT_API_VERSION;
}

export function isMetaCapiConfigured(): boolean {
  return Boolean(process.env.META_CAPI_ACCESS_TOKEN?.trim());
}

/**
 * İstek gövdesini üretir (SAF — ağ yok, test edilebilir).
 *
 * `event_id` verilmişse aynı olayın tarayıcı kopyasıyla tekilleştirilir.
 * `user_data` alanları Meta'nın şartı gereği özetlenir.
 */
export function buildMetaCapiPayload(input: MetaCapiEventInput): Record<string, unknown> {
  const event: Record<string, unknown> = {
    event_name: input.eventName,
    event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
    action_source: "website",
  };

  if (input.eventId) event.event_id = input.eventId;
  if (input.eventSourceUrl) event.event_source_url = input.eventSourceUrl;

  const userData: Record<string, unknown> = {};
  const email = input.userData?.email?.trim();
  if (email) userData.em = [sha256Hex(normalizedEmail(email))];
  const externalId = input.userData?.externalId?.trim();
  if (externalId) userData.external_id = [sha256Hex(externalId)];
  if (input.userData?.clientIp) userData.client_ip_address = input.userData.clientIp;
  if (input.userData?.userAgent) userData.client_user_agent = input.userData.userAgent;
  if (input.userData?.fbp) userData.fbp = input.userData.fbp;
  if (input.userData?.fbc) userData.fbc = input.userData.fbc;
  if (Object.keys(userData).length > 0) event.user_data = userData;

  const customData: Record<string, unknown> = { ...(input.customData ?? {}) };
  if (typeof input.value === "number") customData.value = input.value;
  if (input.currency) customData.currency = input.currency;
  if (Object.keys(customData).length > 0) event.custom_data = customData;

  const payload: Record<string, unknown> = { data: [event] };
  const testEventCode = process.env.META_TEST_EVENT_CODE?.trim();
  if (testEventCode) payload.test_event_code = testEventCode;
  return payload;
}

/**
 * Conversions API'ye tek olay gönderir. ASLA fırlatmaz.
 */
export async function sendMetaCapiEvent(input: MetaCapiEventInput): Promise<MetaCapiResult> {
  const token = process.env.META_CAPI_ACCESS_TOKEN?.trim();
  if (!token) {
    if (!warnedMissingToken) {
      warnedMissingToken = true;
      console.warn(
        "[Meta CAPI] META_CAPI_ACCESS_TOKEN tanımlı değil — sunucu tarafı olaylar devre dışı.",
      );
    }
    return { sent: false, skipped: "missing_token" };
  }

  const url =
    `${GRAPH_HOST}/${metaApiVersion()}/${META_PIXEL_ID}/events` +
    `?access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildMetaCapiPayload(input)),
    });
    if (!res.ok) {
      // Yanıt gövdesi PII içermez; yine de yalnız kısa bir kesit loglanır.
      const detail = await res.text().catch(() => "");
      console.warn(
        `[Meta CAPI] ${input.eventName} reddedildi (${res.status}): ${detail.slice(0, 300)}`,
      );
      return { sent: false, error: `http_${res.status}` };
    }
    return { sent: true };
  } catch (error) {
    console.warn(
      "[Meta CAPI] gönderilemedi:",
      error instanceof Error ? error.message : String(error),
    );
    return { sent: false, error: "network" };
  }
}

/**
 * Başarılı Paddle tahsilatı → Meta `Purchase`.
 *
 * `transactionId` zorunludur: hem tekilleştirme kimliği buradan türetilir hem
 * de aynı işlem için tekrar gönderim engellenir. Yenilemelerde işlem kimliği
 * farklı olduğu için her tahsilat ayrı sayılır.
 */
export async function sendMetaPurchase(input: {
  transactionId: string;
  email?: string | null;
  userId?: string | null;
  value: number;
  currency?: string | null;
  plan?: string | null;
}): Promise<MetaCapiResult> {
  const appUrl = (process.env.APP_URL ?? "https://aroless.tech").replace(/\/+$/, "");
  return sendMetaCapiEvent({
    eventName: "Purchase",
    eventId: purchaseEventId(input.transactionId) ?? `purchase-${input.transactionId}`,
    eventSourceUrl: `${appUrl}/pricing`,
    userData: {
      email: input.email,
      externalId: input.userId,
    },
    value: Math.max(0, input.value),
    currency: input.currency || "USD",
    customData: {
      content_name: input.plan ?? "Aroless",
      content_type: "product",
    },
  });
}
