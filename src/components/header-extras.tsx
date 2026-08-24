import { useState } from "react";
import { Database, KeyRound, ShieldCheck, TriangleAlert } from "lucide-react";
import { openRouterStatus } from "@/lib/api-status";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const SOURCES = [
  { name: "Frankfurter", desc: "Canlı döviz kurları (USD ↔ yerel para birimi)" },
  { name: "RestCountries", desc: "Ülke bayrakları, para birimi ve metadata" },
  { name: "Google Trends", desc: "Arama hacmi serileri ve sezonluk momentum" },
  { name: "AliExpress", desc: "Tedarik fiyatı ve kaynak sinyalleri" },
  { name: "Open Products Facts", desc: "Ürün / lojistik metadata" },
  { name: "Open PageRank", desc: "Rakip domain otorite skoru" },
  { name: "Groq + Gemini", desc: "Hibrit AI skorlama ve yorum motoru" },
];

/** API key status badge — reports configuration state only, never the value. */
export function ApiKeyBadge() {
  const { configured, label } = openRouterStatus();
  return (
    <span
      title={configured ? "OpenRouter anahtarı tanımlı" : "VITE_OPENROUTER_API_KEY tanımlı değil"}
      className={`hidden md:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
        configured
          ? "border-[var(--accent-active)]/40 bg-[var(--accent-active)]/10 text-[var(--accent-active)]"
          : "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]"
      }`}
    >
      {configured ? <ShieldCheck size={12} /> : <TriangleAlert size={12} />}
      <KeyRound size={11} className="opacity-70" />
      {label}
    </span>
  );
}

/** [Veri Kaynakları] info button. */
export function DataSourcesButton() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10">
          <Database size={13} /> Veri Kaynakları
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Veri Kaynakları</DialogTitle>
          <DialogDescription>Panelde kullanılan canlı veri ve AI sağlayıcıları.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {SOURCES.map((s) => (
            <li
              key={s.name}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
            >
              <div className="text-sm font-semibold">{s.name}</div>
              <div className="text-xs text-muted-foreground">{s.desc}</div>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
