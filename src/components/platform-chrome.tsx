import { LayoutGrid, Menu, Search, ShieldAlert } from "lucide-react";

const SKINS: Record<string, { name: string; bar: string; text: string; nav: string[] }> = {
  Shopify: { name: "Shopify Admin", bar: "#1a1a1a", text: "#95bf47", nav: ["Home", "Orders", "Products", "Customers", "Analytics", "Marketing", "Discounts"] },
  "Amazon FBA": { name: "Amazon Seller Central", bar: "#232f3e", text: "#ff9900", nav: ["Catalog", "Inventory", "Pricing", "Orders", "Advertising", "Performance"] },
  "Amazon FBM": { name: "Amazon Seller Central", bar: "#232f3e", text: "#ff9900", nav: ["Catalog", "Inventory", "Pricing", "Orders", "Advertising", "Performance"] },
  Etsy: { name: "Etsy Shop Manager", bar: "#2b2b2b", text: "#f56400", nav: ["Dashboard", "Listings", "Orders", "Stats", "Marketing", "Finances"] },
  eBay: { name: "eBay Seller Hub", bar: "#1b1b1b", text: "#3665f3", nav: ["Overview", "Listings", "Orders", "Marketing", "Performance", "Payments"] },
  Trendyol: { name: "Trendyol Satıcı Paneli", bar: "#1d1d1d", text: "#f27a1a", nav: ["Ürünler", "Siparişler", "Reklam", "Finans", "Puanlama"] },
  "TikTok Shop": { name: "TikTok Shop Seller Center", bar: "#141414", text: "#fe2c55", nav: ["Home", "Products", "Orders", "Ads", "Creators", "Data"] },
  WooCommerce: { name: "WooCommerce Dashboard", bar: "#1f1235", text: "#a46497", nav: ["Home", "Orders", "Products", "Analytics", "Marketing"] },
};

/** Hard-mode challenge presets per market, surfaced as sandbox scenarios. */
export const HARD_SCENARIOS: { id: string; label: string; hint: string }[] = [
  { id: "none", label: "Standart mod", hint: "" },
  { id: "de_returns", label: "🇩🇪 Yüksek iade dalgası", hint: "Almanya pazarında %40+ iade oranı ve VerpackG/LUCID ambalaj kaydı denetimi baskısı var." },
  { id: "uk_vat", label: "🇬🇧 VAT gümrük blokajı", hint: "UK/EU gümrüğünde VAT beyanı eksikliği nedeniyle gönderiler tutuluyor, nakit akışı kilitleniyor." },
  { id: "amz_ip", label: "⚠️ IP / marka şikâyeti", hint: "Amazon'da marka sahibi IP şikâyeti açtı, listeleme askıya alınma riski var." },
  { id: "etsy_seo", label: "🏷️ Etsy tag doygunluğu", hint: "Etsy'de niş tag'ler doygun, organik görüntülenme çöküyor, reklam CPC'si artıyor." },
];

export function PlatformChrome({ platform, storeName, day }: { platform: string; storeName: string; day: number }) {
  const skin = SKINS[platform] ?? SKINS.Shopify;
  return (
    <div className="rounded-2xl overflow-hidden border border-white/10">
      <div className="flex items-center gap-3 px-4 py-2.5" style={{ background: skin.bar }}>
        <Menu size={15} className="opacity-70" />
        <span className="text-sm font-bold" style={{ color: skin.text }}>{skin.name}</span>
        <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
          <div className="flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1 text-[11px] text-white/60 w-64">
            <Search size={11} /> Ara…
          </div>
        </div>
        <span className="text-[11px] text-white/70 whitespace-nowrap">{storeName} · Gün {day}</span>
      </div>
      <div className="flex items-center gap-3 overflow-x-auto px-4 py-2 bg-white/[0.04] border-t border-white/10 text-[11px] text-muted-foreground">
        <LayoutGrid size={11} />
        {skin.nav.map((n) => <span key={n} className="whitespace-nowrap hover:text-foreground cursor-default">{n}</span>)}
      </div>
    </div>
  );
}

export function HardModeBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const active = HARD_SCENARIOS.find((s) => s.id === value) ?? HARD_SCENARIOS[0];
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-3">
      <span className="text-[11px] uppercase tracking-wider text-amber-300 flex items-center gap-1.5 whitespace-nowrap">
        <ShieldAlert size={12} /> Zor Mod Senaryosu
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs outline-none focus:border-[oklch(0.68_0.20_265)]"
      >
        {HARD_SCENARIOS.map((s) => (
          <option key={s.id} value={s.id} className="bg-[oklch(0.20_0.035_265)]">{s.label}</option>
        ))}
      </select>
      {active.hint && <span className="text-[11px] text-muted-foreground">{active.hint}</span>}
    </div>
  );
}
