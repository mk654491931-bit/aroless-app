// ============================================================================
// HIDROJEN10 — SUNUCU FONKSİYONLARI.
//
// Karar noktası BURASIDIR: cache taze mi, bayat mı, hiç yok mu? İstemci
// "kazıma yapayım mı?" diye karar vermez. Aynı niş + ülke + platform + para
// birimi 24 saat içinde tekrar sorulursa kaynaklara GİTMEZ; DB'den döner.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tierLevel } from "@/lib/plans";
import {
  isH10Fresh,
  resolveH10Market,
  type H10SearchResult,
} from "@/lib/hydrogen10";
import {
  H10BusyError,
  H10SchemaError,
  findH10Niche,
  persistH10Run,
  readH10Payload,
  readH10ProductDetail,
  type NicheRow,
} from "@/lib/hydrogen10-store.server";
import { runInBackground } from "@/lib/job-runner.server";

/** Tek bir kaynak turunun üst sınırı — isteği 504'e taşırmamak için. */
const H10_SOURCE_CAP_MS = 14_000;

const SearchInput = z.object({
  query: z.string().trim().min(2).max(160),
  country: z.string().trim().max(8).optional(),
  platform: z.string().trim().max(40).optional(),
});

const RefreshInput = SearchInput;

type H10Context = {
  supabase: {
    from: (table: string) => unknown;
  };
  userId: string;
};

/**
 * PRO kapısı sunucu tarafında da doğrulanır. Route gate tek başına yeterli
 * değildir: kullanıcı tarayıcı konsolundan sunucu fonksiyonunu doğrudan
 * çağırabilir. Admin rolü ve e-posta tabanlı admin tanımı ayrıca korunur.
 */
async function assertH10Access(context: {
  supabase: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  userId: string;
}): Promise<void> {
  try {
    const { data } = await context.supabase
      .from("profiles")
      .select("subscription_tier")
      .eq("id", context.userId)
      .maybeSingle();
    if (tierLevel((data as { subscription_tier?: string } | null)?.subscription_tier) >= 1) {
      return;
    }
  } catch {
    // Profil okunamazsa admin kontrolüne devam et; fail-open yalnız admin
    // kimliği için değil, aşağıdaki 403 ile kapanır.
  }

  try {
    const { data } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (data) return;
  } catch {
    /* rol okunamadı */
  }

  try {
    const { isAdminAccount } = await import("./admin-identity.server");
    if (await isAdminAccount(context.userId)) return;
  } catch {
    /* admin kimliği doğrulanamadı */
  }

  const error = new Error("Hidrojen10 yalnız PRO paketlere açıktır.") as Error & {
    statusCode: number;
  };
  error.statusCode = 403;
  throw error;
}

function accessContext(context: unknown): H10Context {
  return context as H10Context;
}

function failure(error: unknown): H10SearchResult {
  if (error instanceof H10SchemaError) {
    return {
      ok: false,
      code: "schema_missing",
      message: error.message,
    };
  }
  if (error instanceof H10BusyError) {
    return {
      ok: false,
      code: "busy",
      message: error.message,
    };
  }
  const message = error instanceof Error ? error.message : "Hidrojen10 isteği başarısız oldu.";
  return {
    ok: false,
    code: "failed",
    message: "Hidrojen10 verisi alınamadı.",
    details: message.slice(0, 400),
  };
}

async function scrapeMarket(input: {
  query: string;
  queryNormalized: string;
  canonicalKey: string;
  country: string;
  platform: string;
  currency: string;
  triggeredBy: "user" | "stale_refresh" | "manual";
}) {
  const { runSources } = await import("./product-discovery-sources.server");
  const { products, reports } = await runSources(input.query, undefined, {
    capMs: H10_SOURCE_CAP_MS,
    country: input.country,
  });
  return persistH10Run({
    canonicalKey: input.canonicalKey,
    query: input.query,
    queryNormalized: input.queryNormalized,
    country: input.country,
    platform: input.platform,
    currency: input.currency,
    raw: products,
    reports,
    triggeredBy: input.triggeredBy,
  });
}

async function readAfterScrape(
  canonicalKey: string,
  options: { dataSource: "db" | "live"; refreshing?: boolean; message?: string | null; notes?: string[] },
): Promise<H10SearchResult> {
  const niche = await findH10Niche(canonicalKey);
  if (!niche) {
    return {
      ok: false,
      code: "failed",
      message: "Tarama tamamlandı ama niş kaydı okunamadı.",
    };
  }
  return readH10Payload(niche, options);
}

/**
 * DB-first arama.
 *
 * • taze cache  → yalnız DB, kazıma yok
 * • bayat cache → DB hemen döner, arka plan yenilemesi başlar (ortam destekliyorsa)
 * • miss        → senkron ilk tarama, sonuç DB'ye yazılır
 */
export const searchHydrogen10 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SearchInput.parse(input))
  .handler(async ({ data, context }): Promise<H10SearchResult> => {
    await assertH10Access(accessContext(context));
    const market = resolveH10Market({
      query: data.query,
      country: data.country,
      platform: data.platform,
    });
    if (market.queryNormalized.length < 2) {
      return {
        ok: false,
        code: "invalid_input",
        message: "En az iki harf/rakam içeren bir niş girin.",
      };
    }

    try {
      const niche = await findH10Niche(market.canonicalKey);
      if (niche && niche.last_scraped_at && isH10Fresh(niche.fresh_until)) {
        return readH10Payload(niche, {
          dataSource: "db",
          message: "24 saat cache geçerli; aynı niş için kaynaklara gidilmedi.",
        });
      }

      if (niche && niche.last_scraped_at) {
        // BAYAT: eski veri hemen görünür. Yenileme kalıcı süreçte arka planda;
        // sunucusuz ortamda başlatılamazsa kullanıcıya açıkça söylenir.
        let refreshing = false;
        let message = "DB'deki eski veri gösteriliyor.";
        try {
          const started = runInBackground(
            "hydrogen10-refresh",
            () =>
              scrapeMarket({
                ...market,
                country: market.country.code,
                platform: market.platform.id,
                currency: market.country.currency,
                triggeredBy: "stale_refresh",
              }).then(() => undefined),
            { key: `h10:${market.canonicalKey}`, timeoutMs: 90_000 },
          );
          refreshing = started.started || started.reason === "duplicate";
          message = refreshing
            ? "DB'deki eski veri gösteriliyor; arka planda yenileniyor."
            : "DB'deki eski veri gösteriliyor. Bu ortamda arka plan yenileme kapalı; Yenile'yi kullanın.";
        } catch (error) {
          message = `DB'deki eski veri gösteriliyor; yenileme başlatılamadı: ${
            error instanceof Error ? error.message.slice(0, 160) : "hata"
          }`;
        }
        return readH10Payload(niche, {
          dataSource: "db",
          refreshing,
          message,
        });
      }

      // MISS: gösterecek eski veri yok; ilk taramayı senkron yap. Sonuç DB'ye
      // yazılır, sonraki aramalar cache'ten döner.
      const result = await scrapeMarket({
        ...market,
        country: market.country.code,
        platform: market.platform.id,
        currency: market.country.currency,
        triggeredBy: "user",
      });
      return readAfterScrape(market.canonicalKey, {
        dataSource: "live",
        message:
          result.prepared.status === "failed"
            ? "Kaynaklar yanıt vermedi; kaynak sağlığı sekmesinde nedenini görün."
            : "Bu niş ilk kez tarandı; sonuçlar veritabanına yazıldı.",
        notes: result.prepared.notes,
      });
    } catch (error) {
      return failure(error);
    }
  });

/**
 * Manuel yenileme — taze cache olsa bile kaynaklara gider.
 * Aynı niş için aktif run varsa ikinci run açılmaz (`H10BusyError`).
 */
export const refreshHydrogen10 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => RefreshInput.parse(input))
  .handler(async ({ data, context }): Promise<H10SearchResult> => {
    await assertH10Access(accessContext(context));
    const market = resolveH10Market({
      query: data.query,
      country: data.country,
      platform: data.platform,
    });
    if (market.queryNormalized.length < 2) {
      return {
        ok: false,
        code: "invalid_input",
        message: "En az iki harf/rakam içeren bir niş girin.",
      };
    }

    try {
      const result = await scrapeMarket({
        ...market,
        country: market.country.code,
        platform: market.platform.id,
        currency: market.country.currency,
        triggeredBy: "manual",
      });
      return readAfterScrape(market.canonicalKey, {
        dataSource: "live",
        message:
          result.prepared.status === "failed"
            ? "Kaynaklar yanıt vermedi; önceki veriler korunuyor."
            : "Manuel yenileme tamamlandı; gözlemler append-only yazıldı.",
        notes: result.prepared.notes,
      });
    } catch (error) {
      return failure(error);
    }
  });

const ProductInput = z.object({
  productId: z.string().trim().min(10).max(60),
  nicheId: z.string().trim().min(10).max(60).optional(),
});

export const getHydrogen10Product = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ProductInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertH10Access(accessContext(context));
    try {
      return await readH10ProductDetail(data.productId, data.nicheId);
    } catch (error) {
      if (error instanceof H10SchemaError) {
        return { ok: false as const, code: "schema_missing" as const, message: error.message };
      }
      return {
        ok: false as const,
        code: "failed" as const,
        message: error instanceof Error ? error.message.slice(0, 300) : "Ürün geçmişi alınamadı.",
      };
    }
  });

/** Test/teşhis için: cache kararını DB'ye gitmeden hesaplar. */
export function h10CacheDecision(
  niche: Pick<NicheRow, "fresh_until" | "last_scraped_at">,
): "fresh" | "stale" | "miss" {
  if (!niche.last_scraped_at) return "miss";
  return isH10Fresh(niche.fresh_until) ? "fresh" : "stale";
}
