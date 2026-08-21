import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Shield } from "lucide-react";
import { LEGAL_DOCS, LAST_UPDATED } from "@/lib/legal-content";

export const Route = createFileRoute("/legal/")({
  head: () => ({
    meta: [
      { title: "Yasal & Uyum Merkezi — Aroless" },
      { name: "description", content: "Aroless kullanım koşulları, KVKK aydınlatma metni, veri işleme sözleşmesi ve çerez politikası tek merkezde." },
      { property: "og:title", content: "Yasal & Uyum Merkezi — Aroless" },
      { property: "og:description", content: "KVKK, DPA, ToS ve çerez politikası belgeleri." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LegalIndex,
});

function LegalIndex() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 md:px-6">
      <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight md:text-3xl">
        <Shield className="h-6 w-6 text-[var(--brand,var(--primary))]" /> Yasal & Uyum Merkezi
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        Aroless'nın sözleşmeleri, KVKK dokümanları ve çerez politikası. Son güncelleme: {LAST_UPDATED}.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {LEGAL_DOCS.map((d) => (
          <Link
            key={d.slug}
            to="/legal/$slug"
            params={{ slug: d.slug }}
            className="group rounded-2xl border border-border bg-card/40 p-5 backdrop-blur transition-colors hover:bg-accent/20"
          >
            <p className="text-sm font-semibold text-foreground">{d.title}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{d.summary}</p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--brand,var(--primary))]">
              Belgeyi oku <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
