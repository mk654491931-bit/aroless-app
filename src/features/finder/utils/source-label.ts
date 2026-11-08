// ============================================================================
// KAYNAK ADLARI — teknik kimlikleri kullanıcı diline çevirir.
//
// NEDEN TEK YER: aynı kaynak hem ilerleme panelinde hem ürün kartında
// gösteriliyor. İki ayrı sözlük tutmak, birinde "ebay-browse" diğerinde
// "eBay" yazılmasına yol açıyordu; kullanıcı iki farklı kaynak sanabilirdi.
// ============================================================================

export const SOURCE_LABELS: Readonly<Record<string, string>> = {
  "hackernews": "Hacker News",
  "reddit-archive": "Reddit arşivi",
  "github": "GitHub",
  "wikipedia-pageviews": "Wikipedia görüntüleme",
  "serpapi-shopping": "SerpAPI Shopping",
  "searchapi-shopping": "SearchAPI Shopping",
  "serper-shopping": "Serper Shopping",
  "google-shopping": "Google Shopping",
  "wikipedia-demand": "Wikipedia",
  "google-trends": "Google Trends",
  "google-trends-keyed": "Google Trends",
  "marketplace-price": "Pazar yeri fiyatı",
  "openlibrary": "Open Library",
  "openfoodfacts": "Open Food Facts",
  "google-news": "Google News",
  "wikidata": "Wikidata",
  "web-reviews": "Web yorumları",
  "steam": "Steam",
  "tr-marketplace": "Türkiye pazar yeri",
  "bing-shopping": "Bing Shopping",
  "tr-reader": "Türkiye okuyucu",
  "aliexpress-reader": "AliExpress",
  "newegg-reader": "Newegg",
  "otto-reader": "Otto",
  "flipkart-reader": "Flipkart",
  "rakuten-reader": "Rakuten",
  "itunes": "iTunes",
  "made-in-china": "Made-in-China",
  "amazon": "Amazon",
  "bestbuy-api": "Best Buy",
  "deal-feed": "Fırsat akışı",
  "woo-storefront": "WooCommerce",
  "openbeautyfacts": "Open Beauty Facts",
  "tavily-search": "Tavily",
  "ebay-browse": "eBay",
  "youtube-attention": "YouTube",
};

/** Bilinmeyen yeni bir kaynakta ham kimliği gizlemeyiz; yalnız etiketleriz. */
export function sourceLabel(name: string): string {
  const clean = name.trim();
  return SOURCE_LABELS[clean] ?? clean;
}
