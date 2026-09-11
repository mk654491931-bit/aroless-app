// ============================================================================
// Credit deduction for streamed analyses (server only)
//
// `deduct_product_finder_credit()` is SECURITY DEFINER and resolves the user
// from `auth.uid()`, so it must be invoked with the caller's own access token —
// the service-role client would have no uid and could never deduct anything.
// This helper talks to PostgREST directly with that token.
// ============================================================================

export type DeductResult =
  | { ok: true; remaining?: number }
  | { ok: false; error: "NO_CREDITS" | "AUTH" | "UNAVAILABLE"; message: string };

const RPC_PATH = "/rest/v1/rpc/deduct_product_finder_credit";

export async function deductFinderCredit(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeductResult> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key || !token) {
    return { ok: false, error: "UNAVAILABLE", message: "Sunucu yapılandırması eksik." };
  }

  try {
    const res = await fetchImpl(`${url}${RPC_PATH}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(8_000),
    });

    if (res.ok) {
      const value = (await res.json().catch(() => null)) as unknown;
      return typeof value === "number" ? { ok: true, remaining: value } : { ok: true };
    }

    const payload = (await res.json().catch(() => null)) as {
      message?: string;
      error?: string;
    } | null;
    const message = String(payload?.message ?? payload?.error ?? "");

    if (message.includes("no_credits")) {
      return {
        ok: false,
        error: "NO_CREDITS",
        message: "Arama krediniz bitti. Paketinizi yükseltin.",
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "AUTH", message: "Oturumunuz geçersiz, tekrar giriş yapın." };
    }
    console.error("[credits] deduct failed", res.status, message);
    return { ok: false, error: "UNAVAILABLE", message: "Kredi düşülemedi, lütfen tekrar deneyin." };
  } catch (error) {
    console.error("[credits] deduct threw", error);
    return { ok: false, error: "UNAVAILABLE", message: "Kredi düşülemedi, lütfen tekrar deneyin." };
  }
}
