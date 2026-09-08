import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/tools/listing")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Listing & Conversion Studio — Aroless" },
      {
        name: "description",
        content:
          "Listing SEO optimizer, görsel/A+ brief üretici, yorum sentiment radarı ve fiyat-Buy Box stratejisi ile dönüşüm oranını yükselt.",
      },
      { property: "og:title", content: "Listing & Conversion Studio — Aroless" },
      {
        property: "og:description",
        content: "Başlık, bullet, görsel brief ve fiyat stratejisiyle listing dönüşümünü artır.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: lazyRouteComponent(
    () => import("@/route-components/tools/listing"),
    "ListingRouteComponent",
  ),
});
