import type { GeneratedViralAd } from "./viral_ads.functions";
import { markdownTable } from "./module-export";

export type ViralAdMeta = {
  title: string;
  niche: string;
  platform: string;
  channel?: string;
  country?: string;
};

/** Panoya kopyalanan düz metin; üretim çıktısının tüm karar alanlarını korur. */
export function buildViralAdText(ad: ViralAdMeta, result: GeneratedViralAd): string {
  const script = result.script
    .map(
      (beat) =>
        `${beat.second} | ${beat.visual} | VO: ${beat.voiceover} | Yazı: ${beat.text_overlay}`,
    )
    .join("\n");
  return [
    `${ad.title} — ${ad.platform} / ${ad.niche}`,
    "",
    `HOOK: ${result.hook_variants[0] ?? ""}`,
    result.hook_variants[1] ? `HOOK B: ${result.hook_variants[1]}` : "",
    result.hook_variants[2] ? `HOOK C: ${result.hook_variants[2]}` : "",
    "",
    "SCRIPT",
    script,
    "",
    `CTA: ${result.cta}`,
    `HEDEFLEME: ${result.targeting}`,
    `NEDEN: ${result.why}`,
    `Beklenen: hook ${result.predicted.hook_rate} · CTR ${result.predicted.ctr} · CPM ${result.predicted.cpm}`,
    `Ölçülen referans: ${result.source_numbers}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Ekip/paylaşım için Markdown; ölçülen referansı tahminden ayrı tutar. */
export function buildViralAdMarkdown(ad: ViralAdMeta, result: GeneratedViralAd): string {
  const lines = [
    `# Viral Reklam Planı — ${ad.title}`,
    "",
    `- **Platform:** ${ad.platform}`,
    `- **Niş:** ${ad.niche}`,
    ad.channel ? `- **Kanal:** ${ad.channel}` : "",
    ad.country ? `- **Pazar:** ${ad.country}` : "",
    "",
    "## Hook varyantları",
    "",
    ...result.hook_variants.map((hook, index) => `${String.fromCharCode(65 + index)}. ${hook}`),
    "",
    "## Çekim planı",
    "",
    markdownTable(
      ["Saniye", "Görsel", "Seslendirme", "Ekran yazısı"],
      result.script.map((beat) => [beat.second, beat.visual, beat.voiceover, beat.text_overlay]),
    ),
    "",
    `**CTA:** ${result.cta}`,
    "",
    `**Hedefleme:** ${result.targeting}`,
    "",
    "## Neden işe yarar",
    "",
    result.why,
    "",
    "## Beklenen bantlar",
    "",
    markdownTable(
      ["Metrik", "Bant"],
      [
        ["Hook oranı", result.predicted.hook_rate],
        ["CTR", result.predicted.ctr],
        ["CPM", result.predicted.cpm],
      ],
    ),
    "",
    `**Ölçülen referans:** ${result.source_numbers}`,
    "",
    "---",
    "Aroless Viral Ads çıktısı — bantlar tahminidir; yayın sonrası gerçek CPA/CTR ile doğrulayın.",
  ];
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
