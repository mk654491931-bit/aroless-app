/**
 * Reklam Kreatif Stüdyosu — prompt üretimi, normalizasyon ve tipler (sunucu tarafı).
 *
 * NEDEN NORMALİZASYON: tek bir model çağrısından 6 hook + 7 sahne + 3 reklam
 * metni + 4 görsel promptu + 12 hashtag + 3 A/B testi + e-posta/SMS isteyen
 * büyük bir JSON bekleniyordu. Modeller bu boyutu sık sık kesiyor; JSON parse
 * edildiğinde eksik anahtarlar `undefined` kalıyor ve arayüz TAMAMEN BOŞ
 * görünüyordu ("stüdyo boş dönüyor") — oysa model aslında cevabın bir kısmını
 * üretmişti. Bu dosya, gelen kısmi cevabı güvenli bir pakete çevirir, birden çok
 * motorun cevabını birleştirir ve hangi bölümün eksik kaldığını dürüstçe söyler.
 */

export type CreativeHook = { angle: string; hook: string; why: string };
export type UgcScene = { second: string; visual: string; voiceover: string; text_overlay: string };
export type CreativeAdCopy = {
  platform: string;
  primary: string;
  headline: string;
  description: string;
  cta: string;
};
export type CreativeImagePrompt = { label: string; prompt: string };
export type CreativeAbTest = {
  hypothesis: string;
  variant_a: string;
  variant_b: string;
  metric: string;
};
export type CreativeEmailSms = { subject: string; body: string; sms: string };

export type CreativeKitMeta = {
  /** Cevabı fiilen veren motorlar, ör. ["premium", "mesh"]. */
  engines: string[];
  /** Dolan bölüm yüzdesi (0-100). */
  coverage: number;
  /** Üretilemeyen bölümlerin okunabilir adları. */
  missing_sections: string[];
  /** Eksik bölümler için onarım turu çalıştı mı? */
  repaired: boolean;
};

export type CreativeKit = {
  positioning: string;
  audience: string;
  hooks: CreativeHook[];
  ugc_script: { title: string; duration_seconds: number; scenes: UgcScene[]; cta: string };
  ad_copies: CreativeAdCopy[];
  image_prompts: CreativeImagePrompt[];
  hashtags: string[];
  ab_tests: CreativeAbTest[];
  email_sms: CreativeEmailSms;
  /** Kapsam/motor bilgisi — eski kayıtlarda bulunmaz (opsiyonel). */
  meta?: CreativeKitMeta;
};

export type CreativeKitInput = {
  product: string;
  platform: string;
  audience: string;
  price: string;
  tone: string;
  lang: string;
};

/** Stüdyoda tutulan üst sınır: paket tek seferlik bir iş, kullanıcı beklememeli. */
export const STUDIO_MAX_BUDGET_MS = 150_000;

/**
 * Stüdyonun üretim bütçesi: platform fonksiyon limiti eksi dönüş payı.
 *
 * Neden platformdan türetiliyor: tek çağrı döneminde sabit bir sınır yoktu ve
 * ikinci/onarım turları eklenince Vercel'in fonksiyon duvarına dayanmak
 * mümkündü. Şimdi bütçe platformdan gelir, üstte 150 sn ile kırpılır.
 */
export function studioBudgetMs(platformSeconds: number): number {
  const platformMs = platformSeconds * 1_000 - 20_000;
  return Math.max(25_000, Math.min(STUDIO_MAX_BUDGET_MS, platformMs));
}

export function emptyCreativeKit(): CreativeKit {
  return {
    positioning: "",
    audience: "",
    hooks: [],
    ugc_script: { title: "", duration_seconds: 30, scenes: [], cta: "" },
    ad_copies: [],
    image_prompts: [],
    hashtags: [],
    ab_tests: [],
    email_sms: { subject: "", body: "", sms: "" },
  };
}

const SCHEMA = `Return STRICT JSON only:
{
 "positioning": string (1 sentence unique angle),
 "audience": string (concrete buyer persona, 1-2 sentences),
 "hooks": [{"angle": string, "hook": string (max 90 chars, spoken first line), "why": string (which viewer reaction it triggers and which metric it lifts)}] (6 items),
 "ugc_script": {"title": string, "duration_seconds": number (20-45), "scenes": [{"second": string (e.g. "0-3"), "visual": string, "voiceover": string, "text_overlay": string}] (5-7 scenes), "cta": string},
 "ad_copies": [{"platform": string, "primary": string, "headline": string (max 40 chars), "description": string (max 90 chars), "cta": string}] (3 items: the chosen channel + Meta + Google),
 "image_prompts": [{"label": string, "prompt": string (detailed English text-to-image prompt, photographic, no text in image)}] (4 items: hero shot, lifestyle, problem/solution split, close-up detail),
 "hashtags": string[12],
 "ab_tests": [{"hypothesis": string, "variant_a": string, "variant_b": string, "metric": string}] (3 items),
 "email_sms": {"subject": string, "body": string (max 120 words), "sms": string (max 160 chars)}
}`;

const RULES = `Rules: no fabricated statistics, no medical/financial guarantees, no competitor brand names.
Hooks must use genuinely different psychological angles (problem-agitate, curiosity, social proof, transformation, contrarian, demonstration) — never paraphrase the same hook twice.
Every hook and headline must be usable as-is, the first line spoken in the video.`;

function brief(input: CreativeKitInput): string {
  return `Product: ${input.product}
Main ad channel: ${input.platform}
Target audience: ${input.audience || "(infer the most profitable buyer)"}
Retail price: ${input.price || "(infer)"}
Tone: ${input.tone}
Output language: ${input.lang}`;
}

export function creativeKitPrompt(input: CreativeKitInput): string {
  return `You are a creative director who has produced 8-figure DTC ad campaigns.
Build a full creative package for the product below. Write ALL human-readable output in language code "${input.lang}".

${brief(input)}

${RULES}

${SCHEMA}`;
}

/**
 * İkinci tur: başka bir motor paketi üretmiş ama bazı bölümler eksik kalmış.
 * Modele mevcut paket gösterilir ve YALNIZCA eksiklerin tamamlanması istenir —
 * böylece zaten iyi olan kısımlar bozulmaz, eksik bölümler dolar.
 */
export function creativeRepairPrompt(
  input: CreativeKitInput,
  kit: CreativeKit,
  missing: string[],
): string {
  const existing = JSON.stringify({ ...kit, meta: undefined }).slice(0, 7_000);
  return `You are a senior creative director completing a colleague's ad package.
${brief(input)}

A previous engine produced the package below, but these sections are missing or too thin: ${missing.join(", ")}.

EXISTING PACKAGE (JSON):
${existing}

Keep every part that is already strong exactly as it is; fill ONLY the sections listed above with the same depth and specificity.
${RULES}

${SCHEMA}`;
}

// ---------------------------------------------------------------------------
// Normalizasyon / birleştirme / kapsam
// ---------------------------------------------------------------------------

function asText(v: unknown, max: number): string {
  if (typeof v === "string") return v.trim().slice(0, max);
  if (typeof v === "number" && Number.isFinite(v)) return String(v).slice(0, max);
  return "";
}

/**
 * Dizi elemanlarını kayda çevirir; düz METİN gelen elemanlar da kabul edilir.
 *
 * Neden: modeller bazen şemayı tam tutmayıp `"hooks": ["Ter mi döküyorsun?"]`
 * gibi düz metin listesi döndürüyor. Eskiden bunlar tamamen atılıyordu ve bölüm
 * "boş" görünüyordu — oysa içerik üretilmişti. Artık metin elemanı, ilgili
 * alanın (ör. hook) değeri sayılır.
 */
function asRecords(v: unknown, textKey: string): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  const out: Record<string, unknown>[] = [];
  for (const item of v) {
    if (typeof item === "string" || typeof item === "number") {
      const text = asText(item, 900);
      if (text) out.push({ [textKey]: text });
      continue;
    }
    if (item && typeof item === "object") out.push(item as Record<string, unknown>);
  }
  return out;
}

function asStrings(v: unknown, limit: number, max = 60): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => asText(x, max))
    .filter(Boolean)
    .slice(0, limit);
}

function asNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

function keyOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 60);
}

/** İçerik bazlı tekilleştirme — aynı hook/hashtag iki kez gösterilmez. */
export function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = keyOf(key(item));
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/**
 * Modelin (kısmi olabilecek) cevabını EKSİKSİZ bir pakete çevirir.
 *
 * Eksik anahtar `undefined` olarak kalmaz: tip uyumlu boş değerle doldurulur,
 * böylece arayüzde hiçbir bölüm sessizce boş kalmaz (kapsam rozeti eksikleri
 * söyler). Metinler kırpılır, diziler sınırlanır ve tekrarlar temizlenir.
 */
export function normalizeCreativeKit(raw: unknown): CreativeKit {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ugc = (
    p["ugc_script"] && typeof p["ugc_script"] === "object" ? p["ugc_script"] : {}
  ) as Record<string, unknown>;
  const mail = (
    p["email_sms"] && typeof p["email_sms"] === "object" ? p["email_sms"] : {}
  ) as Record<string, unknown>;

  const hooks = dedupeBy(
    asRecords(p["hooks"], "hook")
      .map((h) => ({
        angle: asText(h["angle"], 60) || "Açı",
        hook: asText(h["hook"], 200),
        why: asText(h["why"], 400),
      }))
      .filter((h) => h.hook.length > 0),
    (h) => h.hook,
  ).slice(0, 6);

  const scenes = dedupeBy(
    asRecords(ugc["scenes"], "visual")
      .map((s) => ({
        second: asText(s["second"], 20),
        visual: asText(s["visual"], 400),
        voiceover: asText(s["voiceover"], 400),
        text_overlay: asText(s["text_overlay"], 200),
      }))
      .filter((s) => s.visual || s.voiceover || s.text_overlay),
    (s) => `${s.second}${s.visual}`,
  ).slice(0, 8);

  const adCopies = dedupeBy(
    asRecords(p["ad_copies"], "primary")
      .map((a) => ({
        platform: asText(a["platform"], 40) || "Meta",
        primary: asText(a["primary"], 900),
        headline: asText(a["headline"], 140),
        description: asText(a["description"], 320),
        cta: asText(a["cta"], 60),
      }))
      .filter((a) => a.headline || a.primary),
    (a) => `${a.platform}${a.headline}${a.primary}`,
  ).slice(0, 4);

  const imagePrompts = dedupeBy(
    asRecords(p["image_prompts"], "prompt")
      .map((i) => ({ label: asText(i["label"], 60) || "Görsel", prompt: asText(i["prompt"], 900) }))
      .filter((i) => i.prompt.length > 0),
    (i) => `${i.label}${i.prompt}`,
  ).slice(0, 6);

  const hashtags = dedupeBy(
    asStrings(p["hashtags"], 15, 40).map((h) =>
      h.startsWith("#") ? h : `#${h.replace(/^#+/, "")}`,
    ),
    (h) => h,
  ).slice(0, 15);

  const abTests = dedupeBy(
    asRecords(p["ab_tests"], "hypothesis")
      .map((t) => ({
        hypothesis: asText(t["hypothesis"], 300),
        variant_a: asText(t["variant_a"], 300),
        variant_b: asText(t["variant_b"], 300),
        metric: asText(t["metric"], 140),
      }))
      .filter((t) => t.hypothesis),
    (t) => t.hypothesis,
  ).slice(0, 5);

  return {
    positioning: asText(p["positioning"], 400),
    audience: asText(p["audience"], 600),
    hooks,
    ugc_script: {
      title: asText(ugc["title"], 200),
      duration_seconds: asNumber(ugc["duration_seconds"], 10, 90, 30),
      scenes,
      cta: asText(ugc["cta"], 200),
    },
    ad_copies: adCopies,
    image_prompts: imagePrompts,
    hashtags,
    ab_tests: abTests,
    email_sms: {
      subject: asText(mail["subject"], 200),
      body: asText(mail["body"], 3_000),
      sms: asText(mail["sms"], 320),
    },
  };
}

function longer(a: string, b: string): string {
  return b.length > a.length ? b : a;
}

/**
 * İki motorun paketini tek, daha zengin pakete indirir: metinlerde daha uzun
 * olan, dizilerde iki tarafın birleşimi (tekilleştirilmiş) kullanılır.
 */
export function mergeCreativeKits(a: CreativeKit, b: CreativeKit): CreativeKit {
  const scenes = dedupeBy(
    [...a.ugc_script.scenes, ...b.ugc_script.scenes],
    (s) => `${s.second}${s.visual}`,
  ).slice(0, 8);
  const richer =
    b.ugc_script.scenes.length > a.ugc_script.scenes.length ||
    (b.ugc_script.scenes.length === a.ugc_script.scenes.length &&
      b.ugc_script.title.length > a.ugc_script.title.length)
      ? b.ugc_script
      : a.ugc_script;

  return {
    positioning: longer(a.positioning, b.positioning),
    audience: longer(a.audience, b.audience),
    hooks: dedupeBy([...a.hooks, ...b.hooks], (h) => h.hook).slice(0, 6),
    ugc_script: {
      title: richer.title,
      duration_seconds: richer.duration_seconds,
      scenes,
      cta: longer(a.ugc_script.cta, b.ugc_script.cta),
    },
    ad_copies: dedupeBy(
      [...a.ad_copies, ...b.ad_copies],
      (x) => `${x.platform}${x.headline}${x.primary}`,
    ).slice(0, 4),
    image_prompts: dedupeBy(
      [...a.image_prompts, ...b.image_prompts],
      (x) => `${x.label}${x.prompt}`,
    ).slice(0, 6),
    hashtags: dedupeBy([...a.hashtags, ...b.hashtags], (h) => h).slice(0, 15),
    ab_tests: dedupeBy([...a.ab_tests, ...b.ab_tests], (t) => t.hypothesis).slice(0, 5),
    email_sms: {
      subject: longer(a.email_sms.subject, b.email_sms.subject),
      body: longer(a.email_sms.body, b.email_sms.body),
      sms: longer(a.email_sms.sms, b.email_sms.sms),
    },
  };
}

export type CreativeKitCoverage = {
  filled: number;
  total: number;
  percent: number;
  missing: string[];
  complete: boolean;
};

const SECTIONS: { label: string; ok: (k: CreativeKit) => boolean }[] = [
  { label: "Konumlandırma", ok: (k) => k.positioning.length > 0 },
  { label: "Hedef kitle", ok: (k) => k.audience.length > 0 },
  { label: "Hook'lar", ok: (k) => k.hooks.length >= 3 },
  { label: "UGC senaryo", ok: (k) => k.ugc_script.scenes.length >= 3 },
  { label: "Reklam metinleri", ok: (k) => k.ad_copies.length >= 2 },
  { label: "Görsel promptları", ok: (k) => k.image_prompts.length >= 2 },
  { label: "Hashtag'ler", ok: (k) => k.hashtags.length >= 6 },
  { label: "A/B testleri", ok: (k) => k.ab_tests.length >= 2 },
  { label: "E-posta / SMS", ok: (k) => k.email_sms.body.length > 0 },
];

/** Hangi bölümler dolu, hangileri eksik — arayüz bunu dürüstçe gösterir. */
export function creativeKitCoverage(kit: CreativeKit): CreativeKitCoverage {
  const missing = SECTIONS.filter((s) => !s.ok(kit)).map((s) => s.label);
  const filled = SECTIONS.length - missing.length;
  return {
    filled,
    total: SECTIONS.length,
    percent: Math.round((filled / SECTIONS.length) * 100),
    missing,
    complete: missing.length === 0,
  };
}

/** Paket gerçekten üretildi mi? (Tamamen boş paket kullanıcıya gösterilmez.) */
export function creativeKitHasContent(kit: CreativeKit): boolean {
  return (
    kit.positioning.length > 0 ||
    kit.hooks.length > 0 ||
    kit.ad_copies.length > 0 ||
    kit.ugc_script.scenes.length > 0 ||
    kit.email_sms.body.length > 0
  );
}
