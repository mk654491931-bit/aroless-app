import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/tools/finance")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Financial & Cost Engine — Aroless" },
      {
        name: "description",
        content:
          "Reverse cost engineering, landed cost, minimum capital planning, desi optimization and milestone payment protection.",
      },
      { property: "og:title", content: "Financial & Cost Engine — Aroless" },
      { property: "og:description", content: "Know your true cost before you wire the deposit." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: lazyRouteComponent(
    () => import("@/route-components/tools/finance"),
    "FinanceRouteComponent",
  ),
});
