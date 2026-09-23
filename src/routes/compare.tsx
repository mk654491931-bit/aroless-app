import { createFileRoute } from "@tanstack/react-router";
import { ComparePage } from "@/components/compare-page";

export const Route = createFileRoute("/compare")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Ürün Karşılaştır — Aroless" },
      {
        name: "description",
        content:
          "Kayıtlı ürünlerini yan yana karşılaştır: marj, rekabet, kanıt ve AI özetiyle hangi ürünün kazanacağını gör.",
      },
      { property: "og:title", content: "Ürün Karşılaştır — Aroless" },
      { property: "og:type", content: "website" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ComparePage,
});
