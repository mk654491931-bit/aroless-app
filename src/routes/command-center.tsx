import { createFileRoute } from "@tanstack/react-router";
import { CommandCenter } from "@/components/command-center";

export const Route = createFileRoute("/command-center")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Command Center — Dual-Engine AI Product Research" },
      { name: "description", content: "Live market data stream plus a 7-agent AI council, merged into one weighted hybrid product score." },
      { property: "og:title", content: "Command Center — Dual-Engine AI Product Research" },
      { property: "og:description", content: "Product Finger market signals (30%) fused with 7-agent AI Council verdicts (70%)." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CommandCenterPage,
});

function CommandCenterPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-6 md:px-8">
      <div className="mx-auto max-w-[1600px]">
        <CommandCenter />
      </div>
    </main>
  );
}
