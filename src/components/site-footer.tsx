import { Link } from "@tanstack/react-router";
import { CheckCircle, ExternalLink, FileText, Shield } from "lucide-react";
import { openCookiePreferences } from "@/components/cookie-banner";
import { AI_DISCLAIMER_TR } from "@/lib/ai-guidance";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-16 border-t border-border bg-card/20 print:hidden">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-3 md:px-6">
        <div>
          <p className="text-sm font-light uppercase tracking-[0.3em] text-foreground">Aroless</p>
          <p className="mt-3 max-w-xs text-xs leading-relaxed text-muted-foreground">
            B2B e-ticaret altyapısı: ürün istihbaratı, tedarikçi analizi ve uyum araçları tek bir
            platformda.
          </p>
          <p className="mt-4 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <CheckCircle className="h-3.5 w-3.5 text-[var(--profit,var(--primary))]" />
            KVKK uyumlu veri işleme
          </p>
        </div>

        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Shield className="h-3.5 w-3.5" /> Yasal & Uyum
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link
                to="/legal/$slug"
                params={{ slug: "kullanim-kosullari" }}
                className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <FileText className="h-3.5 w-3.5" /> Kullanım Koşulları
              </Link>
            </li>
            <li>
              <Link
                to="/legal/$slug"
                params={{ slug: "kvkk-aydinlatma-metni" }}
                className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <FileText className="h-3.5 w-3.5" /> KVKK Aydınlatma Metni
              </Link>
            </li>
            <li>
              <Link
                to="/legal/$slug"
                params={{ slug: "veri-isleme-sozlesmesi" }}
                className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <FileText className="h-3.5 w-3.5" /> Veri İşleme Sözleşmesi (DPA)
              </Link>
            </li>
            <li>
              <button
                type="button"
                onClick={openCookiePreferences}
                className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <CheckCircle className="h-3.5 w-3.5" /> Çerez Tercihleri
              </button>
            </li>
            <li>
              <Link
                to="/legal/$slug"
                params={{ slug: "cerez-politikasi" }}
                className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Shield className="h-3.5 w-3.5" /> Güvenlik & SLA
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            İletişim
          </p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <a
                href="mailto:mk65449191@gmail.com"
                className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" /> mk65449191@gmail.com
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border/70 px-4 pb-16 pt-4 text-center text-[11px] text-muted-foreground md:px-6">
        <p className="mx-auto max-w-3xl leading-relaxed text-muted-foreground/70">
          {AI_DISCLAIMER_TR}
        </p>
        <p className="mt-2">© {year} Aroless. Tüm hakları saklıdır.</p>
      </div>
    </footer>
  );
}
