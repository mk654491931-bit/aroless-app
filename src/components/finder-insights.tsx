import { useMemo, useState } from "react";
import {
  Bookmark,
  BarChart3,
  Check,
  Plus,
  Trash2,
  TrendingUp,
  ShieldCheck,
  DollarSign,
  Boxes,
} from "lucide-react";
import type { WinningProduct } from "@/lib/gemini.functions";
import { marginForRanking } from "@/lib/economics-evidence";
import { parseMoneyNum } from "@/lib/consistency";
import { usePersistentState } from "@/components/finder-extras";

/* ---------------- Portfolio insights ---------------- */

function median(nums: number[]) {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Aggregate stats + winner-score distribution for the currently visible products. */
export function FinderInsights({ products }: { products: WinningProduct[] }) {
  const stats = useMemo(() => {
    const n = products.length || 1;
    const scores = products.map((p) => p.winner_score ?? 0);
    // Yalnız ÖLÇÜLMÜŞ marjlar ortalamaya girer. Ölçülmemiş alanlar eskiden 0
    // sayılıp ortalamayı aşağı çekiyordu — "ölçülmedi" ile "sıfır marj"
    // farklıdır. Hiçbiri ölçülmediyse ortalama YOKTUR (arayüz "—" gösterir).
    const measuredMargins = products
      .map((p) => marginForRanking(p).pct)
      .filter((n): n is number => n !== null);
    const prices = products.map((p) => parseMoneyNum(p.selling_price_usd)).filter((v) => v > 0);
    const verified = products.filter(
      (p) => p.evidence_level === "verified" || (p.realism_score ?? 0) >= 75,
    ).length;
    const lowComp = products.filter((p) => p.competition_level === "Low").length;
    const rising = products.filter((p) => (p.market_evidence?.trend_momentum_pct ?? 0) > 0).length;

    // ÖLÇÜM KAPSAMI: hangi alanın kaç üründe GERÇEKTEN ölçüldüğü. Bu satır,
    // "—" ile boş bırakılan özet hücrelerinin nedenini görünür kılar ve
    // ölçülmemiş alanı 0 gibi göstermez.
    const coverage = {
      price: products.filter((p) => parseMoneyNum(p.selling_price_usd) > 0).length,
      rating: products.filter((p) => (p.measured?.rating ?? 0) > 0).length,
      demand: products.filter(
        (p) =>
          (p.measured?.salesVolume ?? 0) > 0 ||
          (p.measured?.viewed90d ?? 0) > 0 ||
          (p.measured?.ratingCount ?? 0) > 0,
      ).length,
      supplier: products.filter((p) => parseMoneyNum(p.supplier_price_usd) > 0).length,
    };

    const buckets = [0, 0, 0, 0, 0]; // 0-39, 40-54, 55-69, 70-84, 85+
    scores.forEach((s) => {
      if (s >= 85) buckets[4]++;
      else if (s >= 70) buckets[3]++;
      else if (s >= 55) buckets[2]++;
      else if (s >= 40) buckets[1]++;
      else buckets[0]++;
    });

    return {
      avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / n),
      avgMargin: measuredMargins.length
        ? Math.round(measuredMargins.reduce((a, b) => a + b, 0) / measuredMargins.length)
        : null,
      medPrice: Math.round(median(prices)),
      verified,
      lowComp,
      rising,
      coverage,
      buckets,
      max: Math.max(1, ...buckets),
    };
  }, [products]);

  if (products.length === 0) return null;

  const cards = [
    { icon: <BarChart3 size={13} />, label: "Ort. Winner", value: `${stats.avgScore}` },
    {
      icon: <DollarSign size={13} />,
      label: "Ort. marj",
      value: stats.avgMargin === null ? "Tedarik yok" : `%${stats.avgMargin}`,
      title:
        stats.avgMargin === null
          ? "Marj yalnız ölçülmüş tedarik fiyatı olan ürünlerden ortalanır; ölçülmeyen marj 0 sayılmaz."
          : "Ölçülmüş marjların ortalaması",
    },
    {
      icon: <Boxes size={13} />,
      label: "Medyan fiyat",
      value: stats.medPrice ? `$${stats.medPrice}` : "Fiyat yok",
      title: stats.medPrice ? "Ölçülmüş satış fiyatlarının medyanı" : "Ölçülmüş satış fiyatı yok.",
    },
    {
      icon: <ShieldCheck size={13} />,
      label: "Doğrulanmış",
      value: `${stats.verified}/${products.length}`,
    },
    { icon: <TrendingUp size={13} />, label: "Yükselişte", value: `${stats.rising}` },
    { icon: <Check size={13} />, label: "Düşük rekabet", value: `${stats.lowComp}` },
  ];

  const labels = ["0-39", "40-54", "55-69", "70-84", "85+"];

  return (
    <div className="premium-card grain mb-4 rounded-2xl p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <BarChart3 size={14} className="text-[oklch(0.68_0.15_255)]" />
        Sonuç özeti
        <span className="text-[11px] font-normal text-muted-foreground">
          · {products.length} ürün
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div
            key={c.label}
            title={c.title}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
          >
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {c.icon} {c.label}
            </div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-end gap-2">
        {stats.buckets.map((b, i) => (
          <div key={labels[i]} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] tabular-nums text-muted-foreground">{b}</span>
            <div
              className="w-full rounded-t-md bg-gradient-to-t from-[oklch(0.62_0.17_255)]/30 to-[oklch(0.52_0.15_262)]/70 transition-all"
              style={{ height: `${8 + (b / stats.max) * 48}px` }}
            />
            <span className="text-[10px] text-muted-foreground">{labels[i]}</span>
          </div>
        ))}
      </div>

      {/* VERİ KAPSAMI — "hangi alan kaç üründe ölçüldü?". Ölçülmemiş alan
          burada da 0 gibi gösterilmez; pay ve oran birlikte yazılır. */}
      <div className="mt-3 border-t border-white/10 pt-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <ShieldCheck size={11} /> Ölçülen veri kapsamı
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {(
            [
              ["Fiyat", stats.coverage.price, "Kaynakta ölçülen satış fiyatı"],
              ["Puan", stats.coverage.rating, "Kaynakta ölçülen yıldız puanı"],
              ["Talep", stats.coverage.demand, "Satış, değerlendirme veya görüntülenme"],
              ["Tedarik", stats.coverage.supplier, "Birebir eşleşen toptan fiyatı"],
            ] as const
          ).map(([label, count, hint]) => {
            const pct = Math.round((count / products.length) * 100);
            return (
              <div
                key={label}
                title={`${hint} · ${count}/${products.length} ürün`}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5"
              >
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-semibold tabular-nums">
                    {count}/{products.length}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-emerald-400/70"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
          Eksik alanlar kartlarda “ölçülmedi” olarak işaretlenir; 0 sayılmaz. Tedarik kapsamı 0 ise
          marj/net kâr hesaplanmaz.
        </p>
      </div>
    </div>
  );
}

/* ---------------- Filter presets ---------------- */

export type FinderPreset<T> = { name: string; state: T };

/** Save / restore named combinations of filters, band and sorting. */
export function FilterPresets<T>({
  current,
  onApply,
  storageKey = "aroless.finder.presets",
}: {
  current: T;
  onApply: (state: T) => void;
  storageKey?: string;
}) {
  const [presets, setPresets] = usePersistentState<FinderPreset<T>[]>(storageKey, []);
  const [name, setName] = useState("");

  const save = () => {
    const n = name.trim().slice(0, 32);
    if (!n) return;
    setPresets((prev) =>
      [{ name: n, state: current }, ...prev.filter((p) => p.name !== n)].slice(0, 12),
    );
    setName("");
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <Bookmark size={11} /> Filtre setleri
      </span>
      {presets.map((p) => (
        <span
          key={p.name}
          className="group inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs hover:bg-white/10"
        >
          <button type="button" onClick={() => onApply(p.state)} className="max-w-[150px] truncate">
            {p.name}
          </button>
          <button
            type="button"
            aria-label={`${p.name} setini sil`}
            onClick={() => setPresets((prev) => prev.filter((x) => x.name !== p.name))}
            className="opacity-40 transition group-hover:opacity-100"
          >
            <Trash2 size={10} />
          </button>
        </span>
      ))}
      <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          placeholder="mevcut filtreyi kaydet"
          className="w-[150px] bg-transparent px-1 py-0.5 text-xs outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={save}
          aria-label="Filtre setini kaydet"
          className="rounded-full p-1 hover:bg-white/10"
        >
          <Plus size={11} />
        </button>
      </span>
    </div>
  );
}
