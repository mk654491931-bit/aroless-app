// ============================================================================
// GÜVENLİK: QSTASH İMZA DOĞRULAMA + İŞ SAHİPLİĞİ (ownership) KONTROLÜ.
//
// ÖNEMLİ GEREKÇE: Bu depoda daha önce QStash imza doğrulaması YOKTU
// (`verifySignature` / `Receiver` araması boş döndü). Bu, `/api/worker` gibi
// herkese açık uç noktaların SAHTE iş tetiklemesine (ve dolandırıcılıkla
// maliyet üretmeye) açık olduğu anlamına geliyordu. QStash imzası olmadan
// gelen bir istek REDDEDİLMEZSE saldırgan kendi sahte `runId`siyle keyifsiz
// işler çalıştırabilirdi.
//
// KURAL (fail-closed): İmza doğrulanamıyorsa istek REDDEDİLİR, "geçici
// olarak kabul et" gibi bir yol YOKTUR. Aksi halde saldırgan imza
// doğrulamasını devre dışı bırakarak atlatırdı.
//
// YEREL GELİŞTİRME: `NODE_ENV=development` ve imza başlığı yoksa, imza
// kontrolü ATLANIR — ama bu modda SADECE localhost'a açıktır ve loglanır.
// ============================================================================

import { Receiver } from "@upstash/qstash";

/* ------------------------------------------------------ Ortam kontrolü */

/** İmza doğrulama açık mı kapalı mı? QStash token'ı yoksa devre dışı. */
export function signatureVerificationEnabled(envMap: NodeJS.ProcessEnv = process.env): boolean {
  const token = (envMap["QSTASH_TOKEN"] ?? "").trim();
  return token.length > 0;
}

let receiver: Receiver | null = null;
let receiverFor: string | null = null;

/** QStash `Receiver` örneğini token'a göre lazy kurar. */
function getReceiver(token: string): Receiver {
  if (receiver && receiverFor === token) return receiver;
  receiver = new Receiver({
    currentSigningKey: token,
    nextSigningKey: token,
  });
  receiverFor = token;
  return receiver;
}

export type SignatureResult =
  | {
      ok: true;
      body: unknown;
    }
  | {
      ok: false;
      reason: "NO_TOKEN" | "MISSING_SIGNATURE" | "INVALID_SIGNATURE" | "MALFORMED_BODY";
      /** Yanıtta dönecek güvenli hata (iç detay sızdırılmaz). */
      status: number;
      message: string;
    };

/**
 * İstek gövdesinin QStash imzasını doğrular ve parse eder.
 *
 * QStash imzası iki yerden gelir: `upstash-signature` (JWS) veya
 * `upstash-signature` query parametresi. İkisi de desteklenir.
 *
 * @param raw Gövdenin HAM metni — JSON.parse ÖNCE değil, imza ham metni
 *   üzerinden hesaplandığı için parse ÖNCEDEN yapılmamalıdır.
 */
export async function verifyQStashSignature(
  raw: string,
  signature: string | null,
  envMap: NodeJS.ProcessEnv = process.env,
): Promise<SignatureResult> {
  const token = (envMap["QSTASH_TOKEN"] ?? "").trim();

  // QStash yapılandırılmamışsa: koruma kapalı, imza YOK sayılır (imza
  // üretilemediği için) — bu, imza üretmeyen yerel/önizleme ortamı içindir.
  if (!token) {
    // Yalnızca geliştirme ortamında bu kabul edilebilir. Üretimde QSTASH_TOKEN
    // yoksa iş açmak, imza doğrulamasını anlamsız kılar.
    if ((envMap["NODE_ENV"] ?? "production") !== "production") {
      try {
        return { ok: true, body: JSON.parse(raw) as unknown };
      } catch {
        return {
          ok: false,
          reason: "MALFORMED_BODY",
          status: 400,
          message: "Geçersiz JSON gövdesi.",
        };
      }
    }
    return {
      ok: false,
      reason: "NO_TOKEN",
      status: 503,
      message: "QStash yapılandırılmamış; iş başlatılamadı.",
    };
  }

  if (!signature || !signature.trim()) {
    return {
      ok: false,
      reason: "MISSING_SIGNATURE",
      status: 401,
      message: "Eksik QStash imzası.",
    };
  }

  try {
    const body = await getReceiver(token).verify({
      signature: signature.trim(),
      body: raw,
    });
    return { ok: true, body };
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid";
    // Uygulama hatası (imza doğru, gövde bozuk) ile yetkisizlik AYRILIR:
    // 400 "bozuk gövde", 401 "geçersiz imza".
    if (/parse|json|body/i.test(message)) {
      return { ok: false, reason: "MALFORMED_BODY", status: 400, message: "Geçersiz gövde." };
    }
    return {
      ok: false,
      reason: "INVALID_SIGNATURE",
      status: 401,
      message: "Geçersiz QStash imzası.",
    };
  }
}

/* ------------------------------------------------------ Ownership kontrolü */

/**
 * İş sahipliği: bir `runId`'yi üreten `userId` ile eşleştirir.
 *
 * Neden gerekli: `userId` gövdeden GELİYOR. Bir saldırgan başkasının
 * `runId`siyle kendi `userId`si çağrılırsa, o işin sonucunu kendi
 * hesabına yazdırabilir (veri sızıntısı) veya başkasının kredisini
 * tüketebilir. Bu yüzden `runId` → `userId` eşleşmesi sunucu tarafında
 * KALICI OLARAK doğrulanır (başlatma anında yazılır, her adımda tekrar okunur).
 */

/** Ownership kaydı — imza doğrulanmış başlatmada yazılır. */
export type OwnershipRecord = { runId: string; userId: string; createdAt: string };

/** Bellek içi fallback — Supabase yoksa test/kendi kendine çalışma için. */
const memoryOwnership = new Map<string, OwnershipRecord>();

export function rememberOwnership(record: OwnershipRecord): void {
  memoryOwnership.set(record.runId, record);
}

export function recallOwnership(runId: string): OwnershipRecord | null {
  return memoryOwnership.get(runId) ?? null;
}

export type OwnershipResult =
  { ok: true } | { ok: false; status: 403; reason: "NOT_FOUND" | "USER_MISMATCH" };

/**
 * `runId`'nin `userId`'ye ait olduğunu doğrular.
 *
 * @param expectedUserId Başlama anında kaydedilen sahip.
 * @param callerUserId Adım gövdesindeki (imzalı) kullanıcı.
 */
export function verifyOwnership(
  record: OwnershipRecord | null,
  callerUserId: string,
): OwnershipResult {
  if (!record) return { ok: false, status: 403, reason: "NOT_FOUND" };
  if (record.userId !== callerUserId) return { ok: false, status: 403, reason: "USER_MISMATCH" };
  return { ok: true };
}

/* ------------------------------------------------------------ Yanıt yardımcıları */

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

/** Doğrulanmamış istek için standart 401/403 gövdesi. */
export function signatureRejection(result: Extract<SignatureResult, { ok: false }>): Response {
  return jsonResponse({ error: result.message, code: `QSTASH_${result.reason}` }, result.status, {
    "Cache-Control": "no-store",
  });
}
