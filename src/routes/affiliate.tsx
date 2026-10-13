import { createFileRoute } from "@tanstack/react-router";
import { AffiliateProgramPage } from "@/components/affiliate-program-page";

export const Route = createFileRoute("/affiliate")({
  head: () => ({
    meta: [
      { title: "Affiliate Programı — Aroless'u Paylaş, Kazan" },
      {
        name: "description",
        content:
          "Aroless affiliate programı: getirdiğin müşteri ücretli kaldığı sürece %30 aylık komisyon (bir müşteri için en fazla 12 ay), $75 eşiği, 30 günlük iade beklemesi ve Wise/IBAN ödemesi.",
      },
      { property: "og:title", content: "Aroless Affiliate Programı — %30 yinelenen komisyon" },
      {
        property: "og:description",
        content:
          "Müşteri kaç ay ücretli kaldıysa o kadar komisyon (en fazla 12 ay). Şeffaf eşik, bekleme ve ödeme koşulları.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AffiliateProgramPage,
});
