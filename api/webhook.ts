/**
 * Paddle Billing v2 — Vercel Serverless Function webhook handler.
 *
 * Webhook endpoint (Paddle dashboard):
 *   https://<your-domain>/api/webhook
 *
 * Tüm mantık (imza doğrulama, olay yönetimi, Supabase senkronizasyonu,
 * idempotency, loglama) platform-bağımsız çekirdekte yaşar:
 *   src/lib/paddle-webhook-core.ts
 *
 * Gereken ortam değişkenleri:
 *   PADDLE_WEBHOOK_SECRET_KEY — Paddle webhook signing secret
 *                            (eski ad PADDLE_WEBHOOK_SECRET de çalışır)
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service-role key (server-only)
 *
 * Not: Vercel, application/json isteklerinde `req.body`'yi kolaylık için
 * otomatik ayrıştırır; ancak ham akış da okunabilir durumdadır. Paddle imzası
 * ham gövde üzerinden alındığı için JSON.stringify(req.body) KESİNLİKLE
 * kullanılmaz — gövde doğrudan akıştan (stream) okunur.
 *
 * Düzeltmeler (eski sürüme göre):
 *   - Ham gövde akıştan okunur; önceki sürüm JSON.stringify(req.body) ile
 *     imzayı bozuyordu (anahtar sırası/boşluk değişimi HMAC'i geçersiz kılar).
 *   - ts=<unix>;h1=<hex> imza formatı doğru doğrulanır (Paddle-Signature).
 *   - Olay mantığı paylaşılan çekirdekle senkron: transaction.completed /
 *     subscription.updated / subscription.canceled (+created/expired/paused).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/integrations/supabase/types";
import {
  MAX_PAYLOAD_BYTES,
  processPaddleWebhook,
  type SupabaseLike,
} from "../src/lib/paddle-webhook-core";

function json(res: VercelResponse, status: number, body: unknown): void {
  res
    .status(status)
    .setHeader("Content-Type", "application/json")
    .setHeader("Cache-Control", "no-store")
    .setHeader("X-Content-Type-Options", "nosniff")
    .json(body);
}

function getSupabaseAdmin(): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    // 1. Method check
    if (req.method !== "POST") {
      json(res, 405, { error: "Method not allowed" });
      return;
    }

    // 2. Config check
    if (!process.env.PADDLE_WEBHOOK_SECRET) {
      console.error("[paddle-webhook] PADDLE_WEBHOOK_SECRET not set");
      json(res, 500, { error: "Webhook not configured" });
      return;
    }

    // 3. Raw body — imza bu metin üzerinden alınmıştır; yeniden serileştirme YAPMAYIN.
    const chunks: Uint8Array[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
    }
    const byteLength = chunks.reduce((total, c) => total + c.byteLength, 0);
    if (byteLength > MAX_PAYLOAD_BYTES) {
      json(res, 413, { error: "Payload too large" });
      return;
    }
    const raw = Buffer.concat(chunks).toString("utf8");

    // 4. Çekirdeğe devret (imza doğrulama + olay yönetimi + Supabase senkronizasyonu)
    const supabase = getSupabaseAdmin();
    const result = await processPaddleWebhook({
      raw,
      signatureHeader: (req.headers["paddle-signature"] as string) ?? "",
      supabase: supabase as unknown as SupabaseLike,
    });
    json(res, result.status, result.body);
  } catch (e) {
    console.error("[paddle-webhook] handler error", e);
    json(res, 500, { error: "Webhook processing failed" });
  }
}
