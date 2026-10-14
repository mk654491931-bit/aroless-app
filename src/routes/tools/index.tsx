import { createFileRoute } from "@tanstack/react-router";
import { ToolsShowcasePage } from "@/components/tools-showcase-page";
import { TOOL_ENTRY_COUNT, TOOL_HUBS } from "@/lib/tools-catalog";

export const Route = createFileRoute("/tools/")({
  head: () => ({
    meta: [
      { title: "Araç Merkezi — Tüm AI Araçları Tek Panelde | Aroless" },
      {
        name: "description",
        content:
          "Aroless AI araçları: ürün bulucudan tedarik görüşmesine, landed cost hesabından listing optimizasyonuna kadar tüm modüller tek panelde. Hangi modülde hangi araç var, hepsi burada.",
      },
      { property: "og:title", content: "Aroless Araç Merkezi — tüm AI araçları tek panelde" },
      {
        property: "og:description",
        content: `${TOOL_HUBS.length} araç modülü, ${TOOL_ENTRY_COUNT} AI aracı: sourcing, maliyet, büyüme ve listing.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ToolsShowcasePage,
});
