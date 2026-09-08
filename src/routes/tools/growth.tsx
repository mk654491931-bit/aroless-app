import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/tools/growth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Growth & Market AI — Aroless" },
      {
        name: "description",
        content:
          "Multi-AI consensus scoring, bundle AOV booster, lead-time countdown, cross-border arbitrage matrix and competitor ad hook extraction.",
      },
      { property: "og:title", content: "Growth & Market AI — Aroless" },
      {
        property: "og:description",
        content: "Three AI engines score your product and map your growth moves.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: lazyRouteComponent(
    () => import("@/route-components/tools/growth"),
    "GrowthRouteComponent",
  ),
});
