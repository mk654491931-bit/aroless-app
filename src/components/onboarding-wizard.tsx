import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Rocket, ArrowRight, ArrowLeft, Check, X } from "lucide-react";
import { TARGET_COUNTRIES, countryName } from "@/lib/countries";

const KEY = "velora.onboarding.v1";

export type OnboardingResult = {
  country: string;
  platform: string;
  category: string;
  budget: string;
};

const PLATFORM_CHOICES = ["Shopify", "TikTok Shop", "Amazon", "Etsy", "Trendyol", "Hepsiburada"];
const CATEGORY_CHOICES = ["Ev & Yaşam", "Sağlık & Bakım", "Elektronik Aksesuar", "Evcil Hayvan", "Spor & Outdoor", "Bebek & Çocuk"];
const BUDGET_CHOICES = ["$0 - $500", "$500 - $2,000", "$2,000 - $10,000", "$10,000+"];

export function useOnboarding() {
  const [done, setDone] = useState(true);
  useEffect(() => {
    try { setDone(!!window.localStorage.getItem(KEY)); } catch { setDone(true); }
  }, []);
  return {
    needsOnboarding: !done,
    complete: (r: OnboardingResult) => {
      try { window.localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* yoksay */ }
      setDone(true);
    },
    skip: () => {
      try { window.localStorage.setItem(KEY, "skipped"); } catch { /* yoksay */ }
      setDone(true);
    },
  };
}

export function OnboardingWizard({
  onComplete, onSkip,
}: { onComplete: (r: OnboardingResult) => void; onSkip: () => void }) {
  const [step, setStep] = useState(0);
  const [country, setCountry] = useState("US");
  const [platform, setPlatform] = useState("Shopify");
  const [category, setCategory] = useState(CATEGORY_CHOICES[0]);
  const [budget, setBudget] = useState(BUDGET_CHOICES[1]);

  const steps = [
    {
      title: "Hangi ülkeye satış yapacaksın?",
      hint: "Komisyon, KDV ve kargo süreleri bu seçime göre hesaplanır.",
      body: (
        <div className="grid max-h-64 grid-cols-2 gap-2 overflow-auto pr-1 sm:grid-cols-3">
          {TARGET_COUNTRIES.slice(0, 24).map((c) => (
            <button
              key={c.code}
              onClick={() => setCountry(c.code)}
              className={`rounded-lg border px-3 py-2 text-xs ${country === c.code ? "border-primary/60 bg-primary/15" : "border-white/10 hover:bg-white/5"}`}
            >
              {countryName(c.code)}
            </button>
          ))}
        </div>
      ),
    },
    {
      title: "Hangi platformda satıyorsun?",
      hint: "Platforma özgü komisyon ve teslimat profilini kullanırız.",
      body: (
        <div className="flex flex-wrap gap-2">
          {PLATFORM_CHOICES.map((p) => (
            <button key={p} onClick={() => setPlatform(p)}
              className={`rounded-lg border px-3 py-2 text-sm ${platform === p ? "border-primary/60 bg-primary/15" : "border-white/10 hover:bg-white/5"}`}>
              {p}
            </button>
          ))}
        </div>
      ),
    },
    {
      title: "Odaklanmak istediğin kategori?",
      hint: "İlk aramanı bu kategoriyle hazırlayacağız.",
      body: (
        <div className="flex flex-wrap gap-2">
          {CATEGORY_CHOICES.map((c) => (
            <button key={c} onClick={() => setCategory(c)}
              className={`rounded-lg border px-3 py-2 text-sm ${category === c ? "border-primary/60 bg-primary/15" : "border-white/10 hover:bg-white/5"}`}>
              {c}
            </button>
          ))}
        </div>
      ),
    },
    {
      title: "Başlangıç bütçen?",
      hint: "Stok ve reklam senaryolarını buna göre kurgularız.",
      body: (
        <div className="flex flex-wrap gap-2">
          {BUDGET_CHOICES.map((b) => (
            <button key={b} onClick={() => setBudget(b)}
              className={`rounded-lg border px-3 py-2 text-sm ${budget === b ? "border-primary/60 bg-primary/15" : "border-white/10 hover:bg-white/5"}`}>
              {b}
            </button>
          ))}
        </div>
      ),
    },
  ];

  const last = step === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="glass w-full max-w-xl rounded-2xl p-6">
        <div className="flex items-start justify-between">
          <div className="inline-flex items-center gap-2">
            <Rocket size={18} className="text-[oklch(0.75_0.18_265)]" />
            <span className="text-sm font-semibold uppercase tracking-wide">Hızlı kurulum</span>
          </div>
          <button onClick={onSkip} className="rounded-lg p-1.5 hover:bg-white/10" aria-label="Kapat"><X size={16} /></button>
        </div>

        <div className="mt-4 flex gap-1.5">
          {steps.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-white/10"}`} />
          ))}
        </div>

        <h2 className="mt-5 text-xl font-bold">{steps[step].title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{steps[step].hint}</p>
        <div className="mt-4">{steps[step].body}</div>

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() => (step === 0 ? onSkip() : setStep((s) => s - 1))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
          >
            {step === 0 ? "Atla" : <><ArrowLeft size={14} /> Geri</>}
          </button>
          <button
            onClick={() => (last ? onComplete({ country, platform, category, budget }) : setStep((s) => s + 1))}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            {last ? <><Check size={15} /> Başla</> : <>Devam <ArrowRight size={15} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Aktivasyon kontrol listesi — ilk değeri veren aksiyonlara yönlendirir. */
export function ActivationChecklist({
  items,
}: { items: Array<{ label: string; done: boolean; action?: () => void }> }) {
  const [hidden, setHidden] = useState(false);
  const completed = items.filter((i) => i.done).length;
  useEffect(() => {
    try { setHidden(window.localStorage.getItem("velora.checklist.hidden") === "1"); } catch { /* yoksay */ }
  }, []);
  if (hidden || completed === items.length) return null;

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Başlangıç görevleri · {completed}/{items.length}</div>
        <button
          onClick={() => { try { window.localStorage.setItem("velora.checklist.hidden", "1"); } catch { /* yoksay */ } setHidden(true); }}
          className="rounded-lg p-1 text-muted-foreground hover:bg-white/10"
          aria-label="Gizle"
        ><X size={14} /></button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {items.map((i) => (
          <button
            key={i.label}
            onClick={i.action}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs ${i.done ? "border-primary/40 bg-primary/10" : "border-white/10 hover:bg-white/5"}`}
          >
            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${i.done ? "border-primary bg-primary text-primary-foreground" : "border-white/20"}`}>
              {i.done && <Check size={10} />}
            </span>
            {i.label}
          </button>
        ))}
      </div>
    </div>
  );
}
