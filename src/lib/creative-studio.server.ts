/** Reklam Kreatif Stüdyosu — prompt üretimi ve tipler (sunucu tarafı). */

export type CreativeHook = { angle: string; hook: string; why: string };
export type UgcScene = { second: string; visual: string; voiceover: string; text_overlay: string };
export type CreativeKit = {
  positioning: string;
  audience: string;
  hooks: CreativeHook[];
  ugc_script: { title: string; duration_seconds: number; scenes: UgcScene[]; cta: string };
  ad_copies: { platform: string; primary: string; headline: string; description: string; cta: string }[];
  image_prompts: { label: string; prompt: string }[];
  hashtags: string[];
  ab_tests: { hypothesis: string; variant_a: string; variant_b: string; metric: string }[];
  email_sms: { subject: string; body: string; sms: string };
};

export function creativeKitPrompt(input: {
  product: string;
  platform: string;
  audience: string;
  price: string;
  tone: string;
  lang: string;
}) {
  return `You are a creative director who has produced 8-figure DTC ad campaigns.
Build a full creative package for the product below. Write ALL output in language code "${input.lang}".

Product: ${input.product}
Main ad channel: ${input.platform}
Target audience: ${input.audience || "(infer the most profitable buyer)"}
Retail price: ${input.price || "(infer)"}
Tone: ${input.tone}

Rules: no fabricated statistics, no medical/financial guarantees, no competitor brand names.
Hooks must use genuinely different psychological angles (problem-agitate, curiosity, social proof, transformation, contrarian, demonstration).

Return STRICT JSON only:
{
 "positioning": string (1 sentence unique angle),
 "audience": string (concrete buyer persona, 1-2 sentences),
 "hooks": [{"angle": string, "hook": string (max 90 chars, spoken first line), "why": string}] (6 items),
 "ugc_script": {"title": string, "duration_seconds": number (20-45), "scenes": [{"second": string (e.g. "0-3"), "visual": string, "voiceover": string, "text_overlay": string}] (5-7 scenes), "cta": string},
 "ad_copies": [{"platform": "${input.platform}", "primary": string, "headline": string (max 40 chars), "description": string (max 90 chars), "cta": string}, {"platform":"Meta","primary":string,"headline":string,"description":string,"cta":string}, {"platform":"Google","primary":string,"headline":string,"description":string,"cta":string}],
 "image_prompts": [{"label": string, "prompt": string (detailed English text-to-image prompt, photographic, no text in image)}] (4 items: hero shot, lifestyle, problem/solution split, close-up detail),
 "hashtags": string[12],
 "ab_tests": [{"hypothesis": string, "variant_a": string, "variant_b": string, "metric": string}] (3 items),
 "email_sms": {"subject": string, "body": string (max 120 words), "sms": string (max 160 chars)}
}`;
}
