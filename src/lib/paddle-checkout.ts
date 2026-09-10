/**
 * Client-side Paddle.js overlay checkout.
 *
 * Purely a browser module — never import from a server handler. The heavy
 * Paddle.js script is only downloaded (from the Paddle CDN) on first checkout
 * via dynamic import.
 */

import type { PaddleEventData } from "@paddle/paddle-js";
import type { PlanId } from "@/lib/plans";

export type CheckoutSessionClient = {
  transactionId?: string;
  clientToken?: string | null;
  environment?: "sandbox" | "production";
  priceId?: string | null;
  email?: string | null;
};

export type OpenCheckoutOptions = {
  /** Validated discount code (Paddle discount or app code mirrored in Paddle). */
  discountCode?: string | null;
  /** Customer email to prefill in a price-based checkout. */
  email?: string | null;
  /** Plan whose Vite price ID should be used when no transaction ID is supplied. */
  plan?: PlanId;
  /** Called for every Paddle.js checkout event (e.g. checkout.completed). */
  onEvent?: (event: PaddleEventData) => void;
};

/** Paddle Billing price IDs are distinct from product IDs (pri_* vs pro_*). */
export function isPaddlePriceId(value: unknown): value is string {
  return typeof value === "string" && /^pri_[A-Za-z0-9_-]+$/.test(value.trim());
}

function validPaddlePriceId(value: unknown, source: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (isPaddlePriceId(trimmed)) return trimmed;
  console.error(
    `[Paddle] Geçersiz Price ID yok sayıldı (${source}). Paddle Price ID pri_ ile başlamalıdır.`,
  );
  return undefined;
}

function paddlePriceIdForPlan(plan: PlanId): string | undefined {
  switch (plan) {
    case "Starter":
      return validPaddlePriceId(import.meta.env.VITE_PADDLE_PRICE_STARTER_MONTHLY, "Starter");
    case "Pro":
      return validPaddlePriceId(import.meta.env.VITE_PADDLE_PRICE_PRO_MONTHLY, "Pro");
    case "Business":
      return validPaddlePriceId(import.meta.env.VITE_PADDLE_PRICE_BUSINESS_MONTHLY, "Business");
  }
}

function reportMissingClientToken(): void {
  console.error(
    "Paddle Client Token bulunamadı. Lütfen VITE_PADDLE_CLIENT_TOKEN değişkenini kontrol edin.",
  );
}

/** Detect the app's active theme to mirror it in the overlay checkout. */
function detectTheme(): "light" | "dark" {
  const root = document.documentElement;
  const dataTheme = root.getAttribute("data-theme");
  if (dataTheme === "light" || dataTheme === "dark") return dataTheme;
  return root.classList.contains("light") ? "light" : "dark";
}

/**
 * Open the Paddle overlay checkout for a server-created transaction or a
 * configured plan price. The server transaction remains the preferred path
 * because it carries trusted user/plan metadata to the webhook processor.
 */
export async function openPaddleOverlay(
  session: CheckoutSessionClient = {},
  options?: OpenCheckoutOptions,
): Promise<boolean> {
  // A server-created session is authoritative. Vite values are only used by
  // the public inline-price fallback and never override its environment/token.
  const clientToken = session.clientToken?.trim() || import.meta.env.VITE_PADDLE_CLIENT_TOKEN;
  const configuredEnvironment = session.environment || import.meta.env.VITE_PADDLE_ENV || "sandbox";
  const paddleEnv = configuredEnvironment === "production" ? "production" : "sandbox";

  if (!clientToken) {
    reportMissingClientToken();
    return false;
  }

  const sessionPriceId = validPaddlePriceId(session.priceId, "server session");
  const priceId =
    sessionPriceId ?? (options?.plan ? paddlePriceIdForPlan(options.plan) : undefined);
  if (!session.transactionId && !priceId) {
    console.error(
      "Paddle fiyat ID bulunamadı. İlgili VITE_PADDLE_PRICE_* değişkenini kontrol edin.",
    );
    return false;
  }

  try {
    const { initializePaddle } = await import("@paddle/paddle-js");
    const paddle = await initializePaddle({
      token: clientToken,
      environment: paddleEnv,
      eventCallback: options?.onEvent,
    });

    if (!paddle) {
      console.error("[Paddle] initializePaddle returned no instance (token/environment?)");
      return false;
    }

    const origin = window.location.origin;
    const checkout = session.transactionId
      ? { transactionId: session.transactionId }
      : { items: [{ priceId: priceId ?? "", quantity: 1 }] };
    const email = session.email ?? options?.email;

    paddle.Checkout.open({
      ...checkout,
      settings: {
        displayMode: "overlay",
        theme: detectTheme(),
        locale: "tr",
        successUrl: `${origin}/settings?paid=1`,
        allowLogout: false,
      },
      ...(email ? { customer: { email } } : {}),
      ...(options?.discountCode ? { discountCode: options.discountCode } : {}),
    });

    return true;
  } catch (error) {
    console.error("[Paddle] Checkout initialization failed:", error);
    return false;
  }
}

/** Open a configured Vite Paddle price directly for a plan. */
export function openPaddlePlanCheckout(
  plan: PlanId,
  options?: Omit<OpenCheckoutOptions, "plan">,
): Promise<boolean> {
  return openPaddleOverlay({}, { ...options, plan });
}

/** Public price lookup used by checkout buttons and client-side fallbacks. */
export { paddlePriceIdForPlan };
