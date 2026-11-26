import type { CreativeKit } from "./creative-studio.server";
import { markdownTable } from "./module-export";

export type StudioExportRow = {
  product_name: string;
  platform: string;
  payload: CreativeKit;
  created_at?: string;
};

/**
 * Stüdyo paketini tek Markdown dosyasına çevirir.
 *
 * Hook/UGC/reklam/görsel/A-B/e-posta bölümleri ayrı ayrı kopyalanıyordu;
 * ekip arkadaşına gönderilecek tek belge yoktu. Bu çıktı tüm bölümleri ve
 * motor kapsamını korur.
 */
export function buildStudioMarkdown(row: StudioExportRow): string {
  const kit = row.payload;
  const lines: string[] = [
    `# Kreatif Paket — ${row.product_name}`,
    "",
    `- **Platform:** ${row.platform}`,
    row.created_at ? `- **Üretim:** ${new Date(row.created_at).toLocaleString("tr-TR")}` : "",
    kit.meta ? `- **Motorlar:** ${kit.meta.engines.join(" + ") || "—"}` : "",
    kit.meta ? `- **Kapsam:** %${kit.meta.coverage}` : "",
    "",
    "## Konumlandırma",
    "",
    kit.positioning || "—",
    "",
    kit.audience ? `**Hedef kitle:** ${kit.audience}` : "",
    "",
  ];

  if (kit.hooks.length) {
    lines.push("## Hook'lar", "");
    for (const hook of kit.hooks) {
      lines.push(`### ${hook.angle}`, "", hook.hook, "", `_${hook.why}_`, "");
    }
  }

  if (kit.ugc_script.scenes.length) {
    lines.push(
      "## UGC senaryo",
      "",
      `**${kit.ugc_script.title}** · ${kit.ugc_script.duration_seconds} sn`,
      "",
      markdownTable(
        ["Saniye", "Görsel", "Seslendirme", "Ekran yazısı"],
        kit.ugc_script.scenes.map((scene) => [
          `${scene.second}s`,
          scene.visual,
          scene.voiceover,
          scene.text_overlay,
        ]),
      ),
      "",
      `**CTA:** ${kit.ugc_script.cta || "—"}`,
      "",
    );
  }

  if (kit.ad_copies.length) {
    lines.push(
      "## Reklam metinleri",
      "",
      markdownTable(
        ["Platform", "Başlık", "Ana metin", "Açıklama", "CTA"],
        kit.ad_copies.map((ad) => [ad.platform, ad.headline, ad.primary, ad.description, ad.cta]),
      ),
      "",
    );
  }

  if (kit.image_prompts.length) {
    lines.push("## Görsel promptları", "");
    for (const prompt of kit.image_prompts) {
      lines.push(`### ${prompt.label}`, "", prompt.prompt, "");
    }
  }

  if (kit.hashtags.length) {
    lines.push(
      "## Hashtag'ler",
      "",
      kit.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" "),
      "",
    );
  }

  if (kit.ab_tests.length) {
    lines.push(
      "## A/B testleri",
      "",
      markdownTable(
        ["Hipotez", "Variant A", "Variant B", "Metrik"],
        kit.ab_tests.map((test) => [test.hypothesis, test.variant_a, test.variant_b, test.metric]),
      ),
      "",
    );
  }

  if (kit.email_sms.body || kit.email_sms.subject) {
    lines.push(
      "## E-posta / SMS",
      "",
      `**${kit.email_sms.subject || "—"}**`,
      "",
      kit.email_sms.body || "—",
      "",
      `**SMS:** ${kit.email_sms.sms || "—"}`,
      "",
    );
  }

  lines.push(
    "---",
    "Aroless Kreatif Stüdyo çıktısı — yayın öncesi marka, hukuk ve platform politikalarını doğrulayın.",
  );
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
