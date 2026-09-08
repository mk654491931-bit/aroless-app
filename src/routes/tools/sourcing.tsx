import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/tools/sourcing")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sourcing & Factory Hub — Aroless" },
      {
        name: "description",
        content:
          "AI supplier negotiator, offer analyzer, legitimacy detector and review-to-spec-sheet tools for cross-border sourcing.",
      },
      { property: "og:title", content: "Sourcing & Factory Hub — Aroless" },
      {
        property: "og:description",
        content: "Negotiate, verify and spec your factory orders with AI.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: lazyRouteComponent(
    () => import("@/route-components/tools/sourcing"),
    "SourcingRouteComponent",
  ),
});
