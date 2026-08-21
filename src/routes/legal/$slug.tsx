import { createFileRoute, notFound } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/legal-layout";
import { getLegalDoc } from "@/lib/legal-content";

export const Route = createFileRoute("/legal/$slug")({
  loader: ({ params }) => {
    const doc = getLegalDoc(params.slug);
    if (!doc) throw notFound();
    return { doc };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Belge bulunamadı — Aroless" }, { name: "robots", content: "noindex" }] };
    }
    const { doc } = loaderData;
    const title = `${doc.title} — Aroless`;
    return {
      meta: [
        { title },
        { name: "description", content: doc.summary.slice(0, 155) },
        { property: "og:title", content: title },
        { property: "og:description", content: doc.summary.slice(0, 155) },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: LegalDocPage,
});

function LegalDocPage() {
  const { doc } = Route.useLoaderData();
  return <LegalLayout doc={doc} />;
}
