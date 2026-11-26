import type { CouncilReport } from "./council.server";
import { markdownCell, markdownTable } from "./module-export";

/**
 * Konsey raporunu dışa aktarılabilir Markdown'a çevirir.
 *
 * Neden ayrı: Arayüzde 14 ajanın tamamı görünse de kullanıcı bunu ekiple
 * paylaşacak bir belgeye dönüştüremiyordu. Bu biçim; skoru, ekipleri, icra
 * raporunu, aksiyonları, riskleri, durdurma kriterlerini ve veri kaynaklarını
 * tek dosyada korur.
 */
export function buildCouncilMarkdown(report: CouncilReport): string {
  const lines: string[] = [
    `# AI Konsey Raporu — ${markdownCell(report.query)}`,
    "",
    `- **Pazar:** ${markdownCell(report.country)}`,
    `- **Aroless Score:** ${report.velora_score}/100`,
    `- **Karar:** ${markdownCell(report.verdict)}`,
    `- **Güven:** %${report.confidence}`,
    `- **Veri kapsamı:** %${report.data_coverage}`,
    `- **Görüş ayrılığı:** ${report.disagreement} puan`,
    `- **Müdür:** ${markdownCell(report.director_engine)}`,
    `- **Denetçi:** ${markdownCell(report.auditor_engine)} (${report.auditor_score}/100)`,
    `- **Derinlik:** ${markdownCell(report.depth)}`,
    `- **Üretim:** ${markdownCell(new Date(report.generated_at).toLocaleString("tr-TR"))}`,
  ];
  if (report.opportunity_window) {
    lines.push(`- **Fırsat penceresi:** ${markdownCell(report.opportunity_window)}`);
  }
  if (report.alt_market) {
    lines.push(`- **Alternatif pazar:** ${markdownCell(report.alt_market)}`);
  }
  lines.push("");

  if (report.auditor_note) {
    lines.push("## Denetçi notu", "", report.auditor_note, "");
  }
  if (report.executive_report) {
    lines.push("## İcra raporu", "", report.executive_report, "");
  }

  lines.push(
    "## Ekipler",
    "",
    markdownTable(
      ["Ekip", "Puan", "Ağırlık", "Güven", "Hakem", "Ham → Hakem"],
      report.teams.map((team) => [
        team.title,
        team.score,
        `%${team.weight}`,
        `%${team.confidence}`,
        team.reviewer_engine,
        `${team.raw_score} → ${team.review_score}`,
      ]),
    ),
    "",
  );

  for (const team of report.teams) {
    lines.push(`### ${markdownCell(team.title)} — ${team.score}/100`, "");
    if (team.summary) lines.push(team.summary, "");
    for (const bullet of team.bullets) lines.push(`- ${bullet}`);
    if (team.bullets.length) lines.push("");
    if (team.metrics.length) {
      lines.push(
        markdownTable(
          ["Metrik", "Değer"],
          team.metrics.map((m) => [m.label, m.value]),
        ),
        "",
      );
    }
    if (team.review_note) {
      lines.push(`> ${markdownCell(team.review_note)}`, "");
    }
  }

  const list = (title: string, items: readonly string[]) => {
    if (!items.length) return;
    lines.push(`## ${title}`, "");
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  };
  list("Aksiyon planı", report.action_plan);
  list("Riskler", report.risks);
  list("Durdurma kriterleri", report.kill_criteria);

  const sources = report.signals?.sources ?? [];
  if (sources.length) {
    lines.push(
      "## Veri hatları",
      "",
      markdownTable(
        ["Kaynak", "Durum", "Sinyal"],
        sources.map((source) => [source.name, source.status, source.items]),
      ),
      "",
    );
  }
  const reddit = report.signals?.reddit ?? [];
  if (reddit.length) {
    lines.push("## Reddit sinyalleri", "");
    for (const item of reddit.slice(0, 5)) {
      lines.push(`- r/${item.subreddit} · ${item.score}↑ — [${item.title}](${item.url})`);
    }
    lines.push("");
  }

  lines.push(
    "---",
    "Aroless AI Konsey çıktısı — yatırım/ithalat kararı öncesi sayıları ve resmi kaynakları doğrulayın.",
  );
  return lines.join("\n");
}
