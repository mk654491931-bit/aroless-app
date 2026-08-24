import type { Platform } from "./gemini.functions";

// Clearbit brand logos — fast CDN, no auth required.
export const PLATFORM_LOGO: Record<Platform, string> = {
  Amazon: "https://logo.clearbit.com/amazon.com",
  eBay: "https://logo.clearbit.com/ebay.com",
  AliExpress: "https://logo.clearbit.com/aliexpress.com",
  Walmart: "https://logo.clearbit.com/walmart.com",
  Etsy: "https://logo.clearbit.com/etsy.com",
  Shopify: "https://logo.clearbit.com/shopify.com",
  WooCommerce: "https://logo.clearbit.com/woocommerce.com",
  Rakuten: "https://logo.clearbit.com/rakuten.com",
  Zalando: "https://logo.clearbit.com/zalando.com",
  "Mercado Libre": "https://logo.clearbit.com/mercadolibre.com",
  Shopee: "https://logo.clearbit.com/shopee.com",
  Lazada: "https://logo.clearbit.com/lazada.com",
  Temu: "https://logo.clearbit.com/temu.com",
  Shein: "https://logo.clearbit.com/shein.com",
  Ozon: "https://logo.clearbit.com/ozon.ru",
  "JD.com": "https://logo.clearbit.com/jd.com",
  Taobao: "https://logo.clearbit.com/taobao.com",
  Tmall: "https://logo.clearbit.com/tmall.com",
  Pinduoduo: "https://logo.clearbit.com/pinduoduo.com",
  "TikTok Shop": "https://logo.clearbit.com/tiktok.com",
  Trendyol: "https://logo.clearbit.com/trendyol.com",
  Hepsiburada: "https://logo.clearbit.com/hepsiburada.com",
};

export function logoForStore(store: string): string {
  const s = store.toLowerCase();
  if (s.includes("trendyol")) return PLATFORM_LOGO.Trendyol;
  if (s.includes("hepsiburada")) return PLATFORM_LOGO.Hepsiburada;
  if (s.includes("amazon")) return PLATFORM_LOGO.Amazon;
  if (s.includes("ebay")) return PLATFORM_LOGO.eBay;
  if (s.includes("aliexpress")) return PLATFORM_LOGO.AliExpress;
  if (s.includes("walmart")) return PLATFORM_LOGO.Walmart;
  if (s.includes("etsy")) return PLATFORM_LOGO.Etsy;
  if (s.includes("shopify")) return PLATFORM_LOGO.Shopify;
  if (s.includes("woo")) return PLATFORM_LOGO.WooCommerce;
  if (s.includes("rakuten")) return PLATFORM_LOGO.Rakuten;
  if (s.includes("zalando")) return PLATFORM_LOGO.Zalando;
  if (s.includes("mercado")) return PLATFORM_LOGO["Mercado Libre"];
  if (s.includes("shopee")) return PLATFORM_LOGO.Shopee;
  if (s.includes("lazada")) return PLATFORM_LOGO.Lazada;
  if (s.includes("temu")) return PLATFORM_LOGO.Temu;
  if (s.includes("shein")) return PLATFORM_LOGO.Shein;
  if (s.includes("ozon")) return PLATFORM_LOGO.Ozon;
  if (s.includes("jd.com") || s.includes("jingdong")) return PLATFORM_LOGO["JD.com"];
  if (s.includes("taobao")) return PLATFORM_LOGO.Taobao;
  if (s.includes("tmall")) return PLATFORM_LOGO.Tmall;
  if (s.includes("pinduoduo") || s.includes("pdd")) return PLATFORM_LOGO.Pinduoduo;
  if (s.includes("tiktok")) return PLATFORM_LOGO["TikTok Shop"];
  if (s.includes("trendyol")) return "https://logo.clearbit.com/trendyol.com";
  if (s.includes("alibaba")) return "https://logo.clearbit.com/alibaba.com";
  if (s.includes("target")) return "https://logo.clearbit.com/target.com";
  if (s.includes("wayfair")) return "https://logo.clearbit.com/wayfair.com";
  if (s.includes("best buy") || s.includes("bestbuy"))
    return "https://logo.clearbit.com/bestbuy.com";
  if (s.includes("flipkart")) return "https://logo.clearbit.com/flipkart.com";
  if (s.includes("wildberries")) return "https://logo.clearbit.com/wildberries.ru";
  if (s.includes("coupang")) return "https://logo.clearbit.com/coupang.com";
  // Fallback: try domain-like transform (e.g., "Nike" -> nike.com)
  const slug = s.replace(/[^a-z0-9]/g, "");
  return slug ? `https://logo.clearbit.com/${slug}.com` : "";
}
