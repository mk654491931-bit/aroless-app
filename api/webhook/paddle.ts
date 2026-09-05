/**
 * Paddle Billing v2 — Vercel Serverless Function webhook handler (alias).
 *
 * Paddle dashboard'da her iki URL de kullanılabilir:
 *   POST https://<your-domain>/api/webhook
 *   POST https://<your-domain>/api/webhook/paddle
 *
 * Davranış api/webhook.ts ile birebir aynıdır — aynı çekirdek kullanılır:
 *   src/lib/paddle-webhook-core.ts
 */
import handler from "../webhook";

export default handler;