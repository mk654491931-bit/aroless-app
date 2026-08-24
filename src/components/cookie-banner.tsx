import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Cookie, Shield, BarChart3, Megaphone } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const COOKIE_KEY = "velora_cookie_consent";
export const OPEN_COOKIE_PREFS = "velora:open-cookie-preferences";

export type CookieConsent = {
  essential: true;
  analytics: boolean;
  marketing: boolean;
  decidedAt: string;
};

export function openCookiePreferences() {
  window.dispatchEvent(new CustomEvent(OPEN_COOKIE_PREFS));
}

function read(): CookieConsent | null {
  try {
    const raw = localStorage.getItem(COOKIE_KEY);
    return raw ? (JSON.parse(raw) as CookieConsent) : null;
  } catch {
    return null;
  }
}

function save(c: Omit<CookieConsent, "essential" | "decidedAt">) {
  const value: CookieConsent = { essential: true, decidedAt: new Date().toISOString(), ...c };
  localStorage.setItem(COOKIE_KEY, JSON.stringify(value));
  return value;
}

export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    const existing = read();
    if (!existing) setVisible(true);
    else {
      setAnalytics(existing.analytics);
      setMarketing(existing.marketing);
    }
    const onOpen = () => setPrefsOpen(true);
    window.addEventListener(OPEN_COOKIE_PREFS, onOpen);
    return () => window.removeEventListener(OPEN_COOKIE_PREFS, onOpen);
  }, []);

  const decide = (a: boolean, m: boolean) => {
    save({ analytics: a, marketing: m });
    setAnalytics(a);
    setMarketing(m);
    setVisible(false);
    setPrefsOpen(false);
  };

  return (
    <>
      {visible && (
        <div className="fixed inset-x-0 bottom-0 z-[60] p-3 pr-3 print:hidden md:p-4 md:pr-40">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 rounded-2xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur md:flex-row md:items-center md:justify-between md:gap-6">
            <div className="flex items-start gap-3">
              <Cookie className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand,var(--primary))]" />
              <p className="text-xs leading-relaxed text-muted-foreground md:text-sm">
                Aroless, platform deneyiminizi iyileştirmek ve analitik hizmetler sunmak için
                çerezler kullanır.{" "}
                <Link
                  to="/legal/$slug"
                  params={{ slug: "cerez-politikasi" }}
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  Çerez Politikası
                </Link>
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPrefsOpen(true)}
                className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Tercihleri Yönet
              </button>
              <button
                type="button"
                onClick={() => decide(false, false)}
                className="h-9 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent/40"
              >
                Reddet
              </button>
              <button
                type="button"
                onClick={() => decide(true, true)}
                className="h-9 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Tümünü Kabul Et
              </button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={prefsOpen} onOpenChange={setPrefsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cookie className="h-4 w-4" /> Çerez Tercihleri
            </DialogTitle>
            <DialogDescription>
              Hangi çerez kategorilerine izin verdiğinizi seçin. Tercihleriniz tarayıcınızda
              saklanır.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <PrefRow
              icon={Shield}
              title="Zorunlu Çerezler"
              desc="Oturum, güvenlik ve temel işlevler. Devre dışı bırakılamaz."
              checked
              disabled
            />
            <PrefRow
              icon={BarChart3}
              title="Analitik Çerezler"
              desc="Anonim kullanım ölçümü ile ürünü iyileştirmemizi sağlar."
              checked={analytics}
              onChange={setAnalytics}
            />
            <PrefRow
              icon={Megaphone}
              title="Pazarlama Çerezleri"
              desc="Kampanya performansı ve ilgi alanına dayalı iletişim."
              checked={marketing}
              onChange={setMarketing}
            />
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <button
              type="button"
              onClick={() => decide(false, false)}
              className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Tümünü Reddet
            </button>
            <button
              type="button"
              onClick={() => decide(analytics, marketing)}
              className="h-9 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              Tercihleri Kaydet
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PrefRow({
  icon: Icon,
  title,
  desc,
  checked,
  onChange,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card/40 p-3">
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand,var(--primary))]" />
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={(v) => onChange?.(v)} />
    </div>
  );
}
