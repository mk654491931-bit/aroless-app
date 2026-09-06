import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Rocket, ArrowRight, ArrowLeft, Check, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { TARGET_COUNTRIES, countryName } from "@/lib/countries";

const KEY = "velora.onboarding.v1";

export type OnboardingResult = {
  country: string;
  platform: string;
  category: string;
  budget: string;
};

const PLATFORM_CHOICES = ["Shopify", "TikTok Shop", "Amazon", "Etsy", "Trendyol", "Hepsiburada"];
const CATEGORY_CHOICES = [
  "Ev & Yaşam",
  "Sağlık & Bakım",
  "Elektronik Aksesuar",
  "Evcil Hayvan",
  "Spor & Outdoor",
  "Bebek & Çocuk",
];
const BUDGET_CHOICES = ["$0 - $500", "$500 - $2,000", "$2,000 - $10,000", "$10,000+"];

const DEFAULTS = {
  country: "US",
  platform: "Shopify",
  category: CATEGORY_CHOICES[0],
  budget: BUDGET_CHOICES[1],
} as const;

/** UI seçenekleri — payload'ı göndermeden önce her alanı kısıtlı kümeye çeker. */
export function sanitizeOnboardingResult(raw: Partial<OnboardingResult> | null | undefined): OnboardingResult {
  const input = raw ?? {};
  const country =
    typeof input.country === "string" &&
    TARGET_COUNTRIES.some((c) => c.code === input.country)
      ? input.country
      : DEFAULTS.country;
  const platform =
    typeof input.platform === "string" && PLATFORM_CHOICES.includes(input.platform)
      ? input.platform
      : DEFAULTS.platform;
  const category =
    typeof input.category === "string" && CATEGORY_CHOICES.includes(input.category)
      ? input.category
      : DEFAULTS.category;
  const budget =
    typeof input.budget === "string" && BUDGET_CHOICES.includes(input.budget)
      ? input.budget
      : DEFAULTS.budget;
  return { country, platform, category, budget };
}

export function useOnboarding() {
  const [done, setDone] = useState(true);
  useEffect(() => {
    try {
      setDone(!!window.localStorage.getItem(KEY));
    } catch {
      setDone(true);
    }
  }, []);
  return {
    needsOnboarding: !done,
    complete: (r: OnboardingResult) => {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(sanitizeOnboardingResult(r)));
      } catch {
        /* yoksay */
      }
      setDone(true);
    },
    skip: () => {
      try {
        window.localStorage.setItem(KEY, "skipped");
      } catch {
        /* yoksay */
      }
      setDone(true);
    },
  };
}

export function OnboardingWizard({
  onComplete,
  onSkip,
}: {
  onComplete: (r: OnboardingResult) => void;
  onSkip: () => void;
}) {
  const [step, setStep] = useState(0);
  const [country, setCountry] = useState("US");
  const [platform, setPlatform] = useState("Shopify");
  const [category, setCategory] = useState(CATEGORY_CHOICES[0]);
  const [budget, setBudget] = useState(BUDGET_CHOICES[1]);
  const [error, setError] = useState<string | null>(null);

  const steps = [
    {
      title: "Hangi ülkeye satış yapacaksın?",
      hint: "Komisyon, KDV ve kargo süreleri bu seçime göre hesaplanır.",
      body: (
        <div className="grid max-h-64 grid-cols-2 gap-2 overflow-auto pr-1 sm:grid-cols-3">
          {TARGET_COUNTRIES.slice(0, 24).map((c) => (
            <button
              key={c.code}
              type="button"
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
            <button
              key={p}
              type="button"
              onClick={() => setPlatform(p)}
              className={`rounded-lg border px-3 py-2 text-sm ${platform === p ? "border-primary/60 bg-primary/15" : "border-white/10 hover:bg-white/5"}`}
            >
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
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded-lg border px-3 py-2 text-sm ${category === c ? "border-primary/60 bg-primary/15" : "border-white/10 hover:bg-white/5"}`}
            >
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
            <button
              key={b}
              type="button"
              onClick={() => setBudget(b)}
              className={`rounded-lg border px-3 py-2 text-sm ${budget === b ? "border-primary/60 bg-primary/15" : "border-white/10 hover:bg-white/5"}`}
            >
              {b}
            </button>
          ))}
        </div>
      ),
    },
  ];

  const last = step === steps.length - 1;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  // Tek hata kaynağı: hangi buton basılırsa basılsın hata asla React ağacının
  // dışına taşmaz — console.error + form içi uyarı + toast ile yakalanır.
  const runSafely = (fn: () => void) => {
    try {
      setError(null);
      fn();
    } catch (err) {
      console.error("Onboarding wizard hatası:", err);
      const message =
        err instanceof Error && err.message ? err.message : "Bilinmeyen bir hata oluştu.";
      setError(message);
      try {
        toast.error("Onboarding kaydedilemedi. Lütfen tekrar dene.");
      } catch {
        /* toast da patlarsa yut */
      }
    }
  };

  const handlePrimary = () => {
    if (last) {
      const result = sanitizeOnboardingResult({ country, platform, category, budget });
      runSafely(() => onComplete(result));
    } else {
      runSafely(() => setStep((s) => s + 1));
    }
  };

  const handleBack = () => {
    if (step === 0) {
      runSafely(onSkip);
    } else {
      runSafely(() => setStep((s) => s - 1));
    }
  };

  const overlay = (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <div lang="tr" translate="no" className="glass w-full max-w-xl rounded-2xl p-6">
        <div className="flex items-start justify-between">
          <div className="inline-flex items-center gap-2">
            <Rocket size={18} className="text-[oklch(0.68_0.15_255)]" />
            <span className="text-sm font-semibold uppercase tracking-wide">Hızlı kurulum</span>
          </div>
          <button
            type="button"
            onClick={() => runSafely(onSkip)}
            className="rounded-lg p-1.5 hover:bg-white/10"
            aria-label="Kapat"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 flex gap-1.5">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-white/10"}`}
            />
          ))}
        </div>

        <h2 className="mt-5 text-xl font-bold">{steps[step].title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{steps[step].hint}</p>
        <div className="mt-4">{steps[step].body}</div>

        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>Bir şeyler ters gitti. Lütfen tekrar dene.</span>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
          >
            {step === 0 ? (
              "Atla"
            ) : (
              <>
                <ArrowLeft size={14} /> Geri
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handlePrimary}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            {last ? (
              <>
                <Check size={15} /> Başla
              </>
            ) : (
              <>
                Devam <ArrowRight size={15} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

/** Aktivasyon kontrol listesi — ilk değeri veren aksiyonlara yönlendirir. */
export function ActivationChecklist({
  items,
}: {
  items: Array<{ label: string; done: boolean; action?: () => void }>;
}) {
  const [hidden, setHidden] = useState(false);
  const completed = items.filter((i) => i.done).length;
  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem("velora.checklist.hidden") === "1");
    } catch {
      /* yoksay */
    }
  }, []);
  if (hidden || completed === items.length) return null;

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">
          Başlangıç görevleri · {completed}/{items.length}
        </div>
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage.setItem("velora.checklist.hidden", "1");
            } catch {
              /* yoksay */
            }
            setHidden(true);
          }}
          className="rounded-lg p-1 text-muted-foreground hover:bg-white/10"
          aria-label="Gizle"
        >
          <X size={14} />
        </button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {items.map((i) => (
          <button
            key={i.label}
            type="button"
            onClick={i.action}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs ${i.done ? "border-primary/40 bg-primary/10" : "border-white/10 hover:bg-white/5"}`}
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${i.done ? "border-primary bg-primary text-primary-foreground" : "border-white/20"}`}
            >
              {i.done && <Check size={10} />}
            </span>
            {i.label}
          </button>
        ))}
      </div>
    </div>
  );
}
