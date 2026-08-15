import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callPremiumAI, extractJson } from "@/lib/ai.server";
import { fetchStorePage, extractSignals, auditPrompt, type AuditReport } from "@/lib/store-audit.server";

const AuditInput = z.object({
  url: z.string().url().max(300),
  lang: z.string().max(8).optional().default("tr"),
});

export type StoreAuditRow = { id: string; url: string; health_score: number; report: AuditReport; created_at: string };

export const auditStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AuditInput.parse(input))
  .handler(async ({ data, context }) => {
    const url = data.url.startsWith("http") ? data.url : `https://${data.url}`;
    if (!/^https?:\/\//i.test(url)) throw new Error("INVALID_URL");

    const { error: deductErr } = await context.supabase.rpc("deduct_credit");
    if (deductErr) {
      if (String(deductErr.message).includes("no_credits")) throw new Error("NO_CREDITS");
      throw new Error(deductErr.message);
    }

    let page: { html: string; status: number; ms: number };
    try {
      page = await fetchStorePage(url);
    } catch {
      throw new Error("FETCH_FAILED");
    }
    const signals = extractSignals(page.html);
    const text = await callPremiumAI(auditPrompt(url, signals, page.status, page.ms, data.lang), 0.3);
    const report = extractJson<AuditReport>(text, {
      health_score: 0,
      summary: "",
      strengths: [],
      issues: [],
      conversion_killers: [],
      quick_wins: [],
      trust_signals: [],
      estimated_cr_gain_pct: 0,
    });
    report.health_score = Math.max(0, Math.min(100, Math.round(Number(report.health_score) || 0)));

    const { data: saved } = await context.supabase
      .from("store_audits")
      .insert({ user_id: context.userId, url, health_score: report.health_score, report: report as unknown as never })
      .select("id, url, health_score, report, created_at")
      .single();

    return { ...(saved ?? { id: "", url, health_score: report.health_score, created_at: new Date().toISOString() }), report, signals } as StoreAuditRow & {
      signals: ReturnType<typeof extractSignals>;
    };
  });

export const listStoreAudits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("store_audits")
      .select("id, url, health_score, report, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    return (data ?? []) as unknown as StoreAuditRow[];
  });

export const deleteStoreAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await context.supabase.from("store_audits").delete().eq("id", data.id);
    return { ok: true };
  });
