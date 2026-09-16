import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { siteBaseUrl } from "@/lib/site-url";

// Pro-gated / auth / API yolları crawler için değersiz.
const DISALLOW = [
  "/api/",
  "/admin",
  "/audit",
  "/command-center",
  "/dashboard",
  "/notifications",
  "/settings",
  "/hot/",
  "/trend-radar",
  "/viral-ads",
  "/council",
  "/roi",
  "/studio",
  "/news",
  "/radar",
  "/competitor-analysis",
  "/compare",
  "/tools/",
];

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const base = siteBaseUrl(request);
        const body = [
          "User-agent: *",
          "Allow: /",
          ...DISALLOW.map((p) => `Disallow: ${p}`),
          "",
          `Sitemap: ${base}/sitemap.xml`,
        ].join("\n");

        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
