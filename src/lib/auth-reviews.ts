import type { ReviewItem } from "@/components/landing/sections";

// ============================================================================
// Testimonials shown beneath the auth card.
//
// Content data, moved out of the route so copy edits do not touch the
// authentication flow. Text is unchanged.
// ============================================================================

export const AUTH_REVIEWS: ReviewItem[] = [
  {
    name: "Elif Kaya",
    role: "E-ticaret operatörü · İstanbul",
    market: "TR",
    initials: "EK",
    quote:
      "Üç ürünü trend zirvesine çıkmadan radar üzerinden lansmana aldık. Kâr tablosu, ikinci en çok satan ürünümüzü sessizce öldürecek komisyon yapısını yakaladı.",
  },
  {
    name: "Ahmet Demir",
    role: "İhracatçı · Gaziantep",
    market: "TR",
    initials: "AD",
    quote:
      "Altı ülkeye ihracat yapıyorum, ekonomiyi eskiden Excel'de tutuyordum. Şimdi ülke başına kapıya maliyeti saniyeler içinde görüyorum. İlk haftada kendini amorti etti.",
  },
  {
    name: "Merve Aksoy",
    role: "Dropshipping · İzmir",
    market: "TR",
    initials: "MA",
    quote:
      "Simülatörde sezon oynarken öğrendiklerim, geçen yıl iki kez para kaybettiren hatayı tekrarlamamı engelledi. Reklam senaryolarını da neredeyse olduğu gibi kullanıyoruz.",
  },
  {
    name: "Can Yılmaz",
    role: "Ajans kurucusu · Ankara",
    market: "TR",
    initials: "CY",
    quote:
      "Müşterilerimize ülke + platform bazında net kâr projeksiyonu çıkaran tek araç. Konsey raporları sunumlarımızın yıldızı oldu, satış konuşmalarını kısalttı.",
  },
  {
    name: "Zeynep Şahin",
    role: "Mağaza denetçisi · Bursa",
    market: "TR",
    initials: "ZŞ",
    quote:
      "Mağaza denetçisiyle rakiplerimizin zayıf noktalarını haftalar öncesinden görüyoruz. SEO kiti ve dışa aktarma ile ürünleri aynı gün pazara taşıyoruz.",
  },
];
