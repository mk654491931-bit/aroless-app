import { useState } from "react";
import { ChevronDown, Layers, Radar, RotateCcw } from "lucide-react";

export type DeepSearchOptions = {
  depth: "standard" | "deep" | "ultra";
  include_keywords: string;
  exclude_keywords: string;
  price_target_min: number;
  price_target_max: number;
  sourcing: "any" | "aliexpress" | "alibaba" | "local" | "print_on_demand";
  season: string;
  competition_pref: "any" | "low";
  novelty: "any" | "fresh" | "proven";
};

export const DEFAULT_DEEP_SEARCH: DeepSearchOptions = {
  depth: "standard",
  include_keywords: "",
  exclude_keywords: "",
  price_target_min: 0,
  price_target_max: 0,
  sourcing: "any",
  season: "",
  competition_pref: "any",
  novelty: "any",
};

const DEPTHS: { id: DeepSearchOptions["depth"]; label: string; hint: string }[] = [
  { id: "standard", label: "Standart", hint: "2 açı · ~4 ürün" },
  { id: "deep", label: "Derin", hint: "3 açı · ~6 ürün" },
  { id: "ultra", label: "Ultra derin", hint: "4 açı · ~8 ürün" },
];

const SOURCING: { id: DeepSearchOptions["sourcing"]; label: string }[] = [
  { id: "any", label: "Farketmez" },
  { id: "aliexpress", label: "AliExpress / CJ" },
  { id: "alibaba", label: "Alibaba / 1688 (toplu)" },
  { id: "local", label: "Yerel tedarikçi / hızlı kargo" },
  { id: "print_on_demand", label: "Print-on-demand" },
];

export function DeepSearchPanel({
  value,
  onChange,
  onReset,
}: {
  value: DeepSearchOptions;
  onChange: (v: DeepSearchOptions) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof DeepSearchOptions>(k: K, v: DeepSearchOptions[K]) =>
    onChange({ ...value, [k]: v });

  const dirty = JSON.stringify(value) !== JSON.stringify(DEFAULT_DEEP_SEARCH);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03]">
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-2 text-left text-sm font-medium"
        >
          <Radar size={14} className="text-[oklch(0.75_0.18_265)]" />
          Derin arama
          <span className="text-[11px] font-normal text-muted-foreground">
            · {DEPTHS.find((d) => d.id === value.depth)?.label}
            {dirty ? " · özel" : ""}
          </span>
          <ChevronDown size={14} className={`ml-auto transition ${open ? "rotate-180" : ""}`} />
        </button>
        {dirty && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] hover:bg-white/10"
          >
            <RotateCcw size={11} /> Sıfırla
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-3 border-t border-white/10 px-4 py-4">
          <div>
            <Label icon>
              <Layers size={12} /> Analiz derinliği
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {DEPTHS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => set("depth", d.id)}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                    value.depth === d.id
                      ? "border-[oklch(0.68_0.20_265)] bg-gradient-to-r from-[oklch(0.68_0.20_265)]/25 to-[oklch(0.66_0.24_305)]/25 text-foreground"
                      : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="block font-semibold">{d.label}</span>
                  <span className="block text-[10px] opacity-70">{d.hint}</span>
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Derinlik arttıkça daha fazla farklı açı taranır — kredi maliyeti aynı kalır, süre
              uzar.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Mutlaka içersin (virgülle)">
              <input
                value={value.include_keywords}
                onChange={(e) => set("include_keywords", e.target.value.slice(0, 160))}
                placeholder="örn. taşınabilir, şarjlı"
                className={inputCls}
              />
            </Field>
            <Field label="Hariç tut (virgülle)">
              <input
                value={value.exclude_keywords}
                onChange={(e) => set("exclude_keywords", e.target.value.slice(0, 160))}
                placeholder="örn. kırılgan, pil, marka lisanslı"
                className={inputCls}
              />
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Hedef satış fiyatı ($)">
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  value={value.price_target_min || ""}
                  placeholder="min"
                  onChange={(e) =>
                    set("price_target_min", Math.max(0, Number(e.target.value) || 0))
                  }
                  className={inputCls}
                />
                <input
                  type="number"
                  min={0}
                  value={value.price_target_max || ""}
                  placeholder="max"
                  onChange={(e) =>
                    set("price_target_max", Math.max(0, Number(e.target.value) || 0))
                  }
                  className={inputCls}
                />
              </div>
            </Field>
            <Field label="Tedarik modeli">
              <select
                value={value.sourcing}
                onChange={(e) => set("sourcing", e.target.value as DeepSearchOptions["sourcing"])}
                className={inputCls}
              >
                {SOURCING.map((s) => (
                  <option key={s.id} value={s.id} className="bg-[oklch(0.20_0.035_265)]">
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sezon / zamanlama">
              <input
                value={value.season}
                onChange={(e) => set("season", e.target.value.slice(0, 60))}
                placeholder="örn. yaz, okula dönüş, Q4"
                className={inputCls}
              />
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Rekabet tercihi">
              <select
                value={value.competition_pref}
                onChange={(e) =>
                  set("competition_pref", e.target.value as DeepSearchOptions["competition_pref"])
                }
                className={inputCls}
              >
                <option value="any" className="bg-[oklch(0.20_0.035_265)]">
                  Farketmez
                </option>
                <option value="low" className="bg-[oklch(0.20_0.035_265)]">
                  Sadece düşük rekabet
                </option>
              </select>
            </Field>
            <Field label="Ürün olgunluğu">
              <select
                value={value.novelty}
                onChange={(e) => set("novelty", e.target.value as DeepSearchOptions["novelty"])}
                className={inputCls}
              >
                <option value="any" className="bg-[oklch(0.20_0.035_265)]">
                  Farketmez
                </option>
                <option value="fresh" className="bg-[oklch(0.20_0.035_265)]">
                  Yeni yükselen (son 30-60 gün)
                </option>
                <option value="proven" className="bg-[oklch(0.20_0.035_265)]">
                  Kanıtlanmış satıcı
                </option>
              </select>
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[oklch(0.68_0.20_265)]";

function Label({ children }: { children: React.ReactNode; icon?: boolean }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      {children}
    </label>
  );
}
