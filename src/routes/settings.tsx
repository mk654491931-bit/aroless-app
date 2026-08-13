import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Sparkles, Loader2, BellRing, Coins } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { LANGUAGES } from "@/lib/i18n";
import { getFullProfile, updateProfilePrefs } from "@/lib/analysis.functions";
import { LanguageSwitcher } from "@/components/language-switcher";
import { HuggingFacePanel } from "@/components/huggingface-panel";

const CURRENCIES = ["USD", "EUR", "TRY", "SAR", "GBP"] as const;

export const Route = createFileRoute("/settings")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Settings — Velora" },
      { name: "description", content: "Manage your language, currency, notifications, and subscription." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const qc = useQueryClient();
  const profileFn = useServerFn(getFullProfile);
  const updateFn = useServerFn(updateProfilePrefs);

  useEffect(() => { if (!loading && !user) nav({ to: "/auth" }); }, [user, loading, nav]);

  const profQ = useQuery({ queryKey: ["profile-full", user?.id], queryFn: () => profileFn(), enabled: !!user });
  const [notifications, setNotifications] = useState<boolean>(true);
  const [currency, setCurrency] = useState("USD");

  useEffect(() => {
    if (profQ.data) {
      setNotifications(profQ.data.notifications_enabled ?? true);
      setCurrency(profQ.data.currency ?? "USD");
    }
  }, [profQ.data]);

  const save = useMutation({
    mutationFn: (v: { language?: string; currency?: string; notifications_enabled?: boolean }) => updateFn({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["profile-full"] }); toast.success("Saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading || !user) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 glass sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg glow bg-gradient-to-br from-[oklch(0.68_0.20_265)] to-[oklch(0.66_0.24_305)] flex items-center justify-center">
              <Sparkles size={18} className="text-white" />
            </div>
            <div className="font-bold">{t("settings")}</div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Link to="/" className="text-xs rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 hover:bg-white/10 flex items-center gap-1.5">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-5">
        <section className="glass rounded-2xl p-5">
          <h2 className="font-semibold mb-3">{t("language")}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {LANGUAGES.map((l) => {
              const on = i18n.language === l.code;
              return (
                <button
                  key={l.code}
                  onClick={() => { i18n.changeLanguage(l.code); save.mutate({ language: l.code }); }}
                  className={`rounded-lg border px-3 py-2.5 text-sm text-start flex items-center gap-2 transition ${on ? "border-[oklch(0.68_0.20_265)] bg-gradient-to-r from-[oklch(0.68_0.20_265)]/20 to-[oklch(0.66_0.24_305)]/20" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                >
                  <span className="text-lg">{l.flag}</span> {l.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="glass rounded-2xl p-5">
          <h2 className="font-semibold mb-3">{t("currency")}</h2>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
            {CURRENCIES.map((c) => {
              const on = currency === c;
              return (
                <button
                  key={c}
                  onClick={() => { setCurrency(c); save.mutate({ currency: c }); }}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition ${on ? "border-[oklch(0.68_0.20_265)] bg-gradient-to-r from-[oklch(0.68_0.20_265)]/20 to-[oklch(0.66_0.24_305)]/20" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </section>

        <HuggingFacePanel />

        <section className="glass rounded-2xl p-5">

          <h2 className="font-semibold mb-3 flex items-center gap-2"><BellRing size={16} /> {t("notifications")}</h2>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={notifications}
              onChange={(e) => { setNotifications(e.target.checked); save.mutate({ notifications_enabled: e.target.checked }); }}
              className="h-4 w-4 rounded accent-[oklch(0.68_0.20_265)]"
            />
            <span className="text-sm">Enable product & billing notifications</span>
          </label>
        </section>

        <section className="glass rounded-2xl p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Coins size={16} /> {t("subscription")}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <Info label="Email" value={profQ.data?.email ?? "—"} />
            <Info label="Plan" value={profQ.data?.subscription_tier ?? "Free"} />
            <Info label={t("credits")} value={String(profQ.data?.credits ?? 0)} />
          </div>
        </section>
      </main>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 border border-white/10 p-3">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold mt-0.5 truncate">{value}</div>
    </div>
  );
}