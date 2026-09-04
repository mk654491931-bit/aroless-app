import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { guardPublic } from "@/lib/api-guard.server";
import { normalizeCode } from "@/lib/affiliate/affiliate-core";
import {
  recordAffiliateClick,
  resolveAffiliateByCode,
  type AffDb,
} from "@/lib/affiliate/affiliate.service";

/**
 * POST /api/public/affiliate-click
 *
 * Partner linkine (?ref=CODE) yapılan ziyaretleri kaydeder. Herkese açıktır;
 * yalnızca click sayacı amacı taşır, kimseye finansal veri DÖNMEZ.
 * Aynı affiliate + ziyaretçi çifti için yalnızca İLK click kaydedilir
 * (unique(affiliate_id, visitor_key)).
 */
export const Route = createFileRoute("/api/public/affiliate-click")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const limited = await guardPublic(request, "affiliate-click", 30, 60);
        if (limited) return limited;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
        }
        const parsed = z
          .object({
            code: z.string().trim().max(32).optional().default(""),
            visitorKey: z.string().trim().min(4).max(128).optional().default(""),
            path: z.string().trim().max(256).optional(),
          })
          .safeParse(body);
        if (!parsed.success) {
          return Response.json({ ok: false, reason: "invalid_input" }, { status: 400 });
        }

        const code = normalizeCode(parsed.data.code);
        const visitorKey = parsed.data.visitorKey;
        if (!code || !visitorKey) {
          return Response.json({ ok: false, reason: "invalid_input" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as unknown as AffDb;

        const looked = await resolveAffiliateByCode(db, code);
        if (!looked.ok) {
          // Geçersiz/pasif kod: yine de 200 — botlara sinyal verilmez.
          return Response.json({ ok: false, reason: "not_tracked" }, { status: 200 });
        }

        const res = await recordAffiliateClick(db, {
          code: looked.affiliate.referral_code,
          affiliateId: looked.affiliate.id,
          visitorKey,
          landingPath: parsed.data.path,
        });
        return Response.json({ ok: res.ok }, { status: 200 });
      },
    },
  },
});
