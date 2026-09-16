import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { siteBaseUrl } from "@/lib/site-url";
import { LEGAL_DOCS } from "@/lib/legal-content";

interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const base = siteBaseUrl(request);

        const entries: SitemapEntry[] = [
          // Halka açık, SSR'lı sayfalar. Pro-gated / auth gerektiren
          // route'lar sitemap'e girmez (crawler için değersiz).
          { path: "/", changefreq: "weekly", priority: "1.0" },
          { path: "/pricing", changefreq: "monthly", priority: "0.9" },
          { path: "/legal", changefreq: "yearly", priority: "0.3" },
          ...LEGAL_DOCS.map((d) => ({
            path: `/legal/${d.slug}`,
            changefreq: "yearly" as const,
            priority: "0.3",
          })),
        ];

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${base}${e.path}</loc>`,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
