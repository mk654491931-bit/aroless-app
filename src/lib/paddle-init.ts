/**
 * Paddle Billing v2 — client-side SDK initialisation.
 *
 * Loads the Paddle overlay checkout script and calls Paddle.Initialize()
 * with the live client-side token and (optionally) the signed-in customer's
 * Paddle customer ID for Paddle Retain (subscription management portal).
 *
 * Environment variables (browser):
 *   VITE_PADDLE_CLIENT_TOKEN — client-side token (must start with `live_` for production)
 *   VITE_PADDLE_ENV          — "sandbox" | "production"
 */

import { initializePaddle, type Paddle, type InitializePaddleOptions } from "@paddle/paddle-js";

let paddleInstance: Paddle | null = null;

/**
 * Returns a promise that resolves once the Paddle SDK is loaded and initialized.
 * Safe to call multiple times — subsequent calls return the cached instance.
 *
 * @param pwCustomerId - The logged-in user's Paddle customer ID (e.g. "ctm_xxx").
 *                        Pass `null` if the user has no Paddle customer yet.
 */
export async function getPaddle(pwCustomerId: string | null = null): Promise<Paddle> {
  if (paddleInstance) return paddleInstance;

  const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN;
  const env = import.meta.env.VITE_PADDLE_ENV as "sandbox" | "production";

  if (!token) {
    throw new Error("Paddle client token is not configured (VITE_PADDLE_CLIENT_TOKEN).");
  }

  const options: InitializePaddleOptions = {
    token,
    environment: env === "production" ? "production" : "sandbox",
    ...(pwCustomerId ? { pwCustomer: { id: pwCustomerId } } : {}),
  };

  const instance = await initializePaddle(options);
  if (!instance) {
    throw new Error("Failed to initialize Paddle SDK.");
  }

  paddleInstance = instance;
  return paddleInstance;
}
