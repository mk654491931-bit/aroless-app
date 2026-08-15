/** AI Mağaza Denetçisi — sayfa çekme ve prompt üretimi (sunucu tarafı). */

export type AuditIssue = {
  area: string;          // Trust, Speed, Copy, Product page, Checkout, Mobile, SEO
  severity: "critical" | "high" | "medium" | "low";
  finding: string;
  impact: string;
  fix: string;
};

export type AuditReport = {
  health_score: number;
  summary: string;
  strengths: string[];
  issues: AuditIssue[];
  conversion_killers: string[];
  quick_wins: string[];
  trust_signals: { signal: string; present: boolean }[];
  estimated_cr_gain_pct: number;
};

export async function fetchStorePage(url: string): Promise<{ html: string; status: number; ms: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; VeloraAudit/1.0)" },
    });
    const html = (await res.text()).slice(0, 220000);
    return { html, status: res.status, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export function extractSignals(html: string) {
  const lower = html.toLowerCase();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const has = (...needles: string[]) => needles.some((n) => lower.includes(n));
  return {
    text: text.slice(0, 12000),
    title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim().slice(0, 200),
    description: (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] ?? "").slice(0, 300),
    images: (html.match(/<img\b/gi) ?? []).length,
    imagesWithoutAlt: (html.match(/<img(?![^>]*\balt=)[^>]*>/gi) ?? []).length,
    scripts: (html.match(/<script\b/gi) ?? []).length,
    weightKb: Math.round(html.length / 1024),
    hasReviews: has("review", "yorum", "stars", "rating"),
    hasTrustBadges: has("secure checkout", "guarantee", "garanti", "money back", "iade"),
    hasReturnPolicy: has("return policy", "refund policy", "iade politika", "cayma"),
    hasContact: has("contact", "iletişim", "iletisim", "mailto:"),
    hasFaq: has("faq", "sss", "frequently asked"),
    hasLiveChat: has("tawk", "crisp", "intercom", "zendesk", "whatsapp"),
    hasPixel: has("gtag(", "fbq(", "tiktokanalytics", "gtm-"),
    hasFreeShipping: has("free shipping", "ücretsiz kargo", "ucretsiz kargo"),
    hasUrgency: has("countdown", "limited stock", "son ", "stokta az"),
    hasUpsell: has("bundle", "frequently bought", "add to order", "sepete ekle ve"),
    hasSchema: has("application/ld+json"),
    viewport: has('name="viewport"'),
  };
}

export function auditPrompt(url: string, signals: ReturnType<typeof extractSignals>, status: number, ms: number, lang: string) {
  return `You are a CRO (conversion rate optimization) auditor with 10+ years in DTC e-commerce.
Audit this online store and write everything in language code "${lang}".

URL: ${url}
HTTP status: ${status}, response time: ${ms}ms, HTML weight: ${signals.weightKb}KB, script tags: ${signals.scripts}
Title: ${signals.title || "(missing)"}
Meta description: ${signals.description || "(missing)"}
Images: ${signals.images} (missing alt: ${signals.imagesWithoutAlt})
Detected: reviews=${signals.hasReviews}, trust badges=${signals.hasTrustBadges}, return policy=${signals.hasReturnPolicy}, contact=${signals.hasContact}, faq=${signals.hasFaq}, live chat=${signals.hasLiveChat}, tracking pixel=${signals.hasPixel}, free shipping=${signals.hasFreeShipping}, urgency=${signals.hasUrgency}, upsell=${signals.hasUpsell}, structured data=${signals.hasSchema}, mobile viewport=${signals.viewport}

Visible page text (truncated):
"""${signals.text}"""

Be concrete and reference what you actually saw. No generic advice.
Return STRICT JSON only:
{
 "health_score": number 0-100,
 "summary": string (2 sentences),
 "strengths": string[3-5],
 "issues": [{"area": string, "severity": "critical"|"high"|"medium"|"low", "finding": string, "impact": string, "fix": string}] (6-10 items, ordered by severity),
 "conversion_killers": string[3-5] (the things most likely losing sales),
 "quick_wins": string[4-6] (can be done in under an hour each),
 "trust_signals": [{"signal": string, "present": boolean}] (8 items: reviews, return policy, contact info, secure checkout badge, shipping info, FAQ, about page, social proof),
 "estimated_cr_gain_pct": number (realistic uplift if all fixes applied, 0-120)
}`;
}
