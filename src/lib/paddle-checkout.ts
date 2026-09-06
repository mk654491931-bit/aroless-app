/**
 * Client-side Paddle.js overlay checkout.
 *
 * Purely a browser module — never import from a server handler. The heavy
 * Paddle.js script is only downloaded (from the Paddle CDN) on first checkout
 * via dynamic import.
 */

export type CheckoutSessionClient = {
  transactionId: string;
  clientToken: string;
  environment: "sandbox" | "production";
  email?: string | null;
};

export type OpenCheckoutOptions = {
  /** Validated discount code (Paddle discount or app code mirrored in Paddle). */
  discountCode?: string | null;
  /** Called for every Paddle.js checkout event (e.g. checkout.completed). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEvent?: (event: any) => void;
};

/** Detect the app's active theme to mirror it in the overlay checkout. */
function detectTheme(): "light" | "dark" {
  const root = document.documentElement;
  const dataTheme = root.getAttribute("data-theme");
  if (dataTheme === "light" || dataTheme === "dark") return dataTheme;
  return root.classList.contains("light") ? "light" : "dark";
}

/**
 * Open the Paddle overlay checkout for a server-created transaction.
 * Returns true when the overlay was successfully opened.
 */
export async function openPaddleOverlay(
  session: CheckoutSessionClient,
  options?: OpenCheckoutOptions,
): Promise<boolean> {
  if (!session?.transactionId || !session.clientToken) return false;

  const { initializePaddle } = await import("@paddle/paddle-js");
  const paddle = await initializePaddle({
    token: session.clientToken,
    environment: session.environment,
    eventCallback: options?.onEvent,
  });

  if (!paddle) {
    console.error("[Paddle] initializePaddle returned no instance (token/environment?)");
    return false;
  }

  const origin = window.location.origin;
  paddle.Checkout.open({
    transactionId: session.transactionId,
    settings: {
      displayMode: "overlay",
      theme: detectTheme(),
      locale: "tr",
      successUrl: `${origin}/settings?paid=1`,
      allowLogout: false,
    },
    ...(session.email ? { customer: { email: session.email } } : {}),
    ...(options?.discountCode ? { discountCode: options.discountCode } : {}),
  });

  return true;
}
