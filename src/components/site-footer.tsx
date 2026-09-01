import { Link } from "@tanstack/react-router";
import { CheckCircle, ExternalLink, FileText, Shield, Heart } from "lucide-react";
import { openCookiePreferences } from "@/components/cookie-banner";
import { AI_DISCLAIMER_TR } from "@/lib/ai-guidance";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative mt-20 border-t border-white/10 print:hidden">
      {/* Atmospheric top glow */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--brand)]/30 to-transparent" />

      <div className="relative bg-gradient-to-b from-white/[0.02] to-transparent">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-3 md:px-6">
          {/* Brand column */}
          <div>
            <p className="text-sm font-light uppercase tracking-[0.3em] text-foreground/90">
              Aroless
            </p>
            <p className="mt-4 max-w-xs text-xs leading-relaxed text-muted-foreground">
              B2B e-ticaret altyapısı: ürün istihbaratı, tedarikçi analizi ve uyum araçları tek bir
              platformda.
            </p>
            <p className="mt-5 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
              KVKK uyumlu veri işleme
            </p>
          </div>

          {/* Legal column */}
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Shield className="h-3.5 w-3.5" /> Yasal & Uyum
            </p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <Link
                  to="/legal/$slug"
                  params={{ slug: "kullanim-kosullari" }}
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-all duration-200 hover:text-foreground hover:translate-x-0.5"
                >
                  <FileText className="h-3.5 w-3.5" /> Kullanım Koşulları
                </Link>
              </li>
              <li>
                <Link
                  to="/legal/$slug"
                  params={{ slug: "kvkk-aydinlatma-metni" }}
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-all duration-200 hover:text-foreground hover:translate-x-0.5"
                >
                  <FileText className="h-3.5 w-3.5" /> KVKK Aydınlatma Metni
                </Link>
              </li>
              <li>
                <Link
                  to="/legal/$slug"
                  params={{ slug: "veri-isleme-sozlesmesi" }}
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-all duration-200 hover:text-foreground hover:translate-x-0.5"
                >
                  <FileText className="h-3.5 w-3.5" /> Veri İşleme Sözleşmesi (DPA)
                </Link>
              </li>
              <li>
                <button
                  type="button"
                  onClick={openCookiePreferences}
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-all duration-200 hover:text-foreground hover:translate-x-0.5"
                >
                  <CheckCircle className="h-3.5 w-3.5" /> Çerez Tercihleri
                </button>
              </li>
              <li>
                <Link
                  to="/legal/$slug"
                  params={{ slug: "cerez-politikasi" }}
                  className="inline-flex items-center gap-1.5 text-muted-foreground transition-all duration-200 hover:text-foreground hover:translate-x-0.5"
                >
                  <Shield className="h-3.5 w-3.5" /> Güvenlik & SLA
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact column */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              İletişim
            </p>
            <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
              <li>
                <a
                  href="mailto:mk65449191@gmail.com"
                  className="inline-flex items-center gap-1.5 transition-all duration-200 hover:text-foreground hover:translate-x-0.5"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> mk65449191@gmail.com
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/[0.06] px-4 pb-16 pt-5 text-center text-[11px] text-muted-foreground md:px-6">
          <p className="mx-auto max-w-3xl leading-relaxed text-muted-foreground/60">
            {AI_DISCLAIMER_TR}
          </p>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-muted-foreground/80">
            © {year} Aroless. Tüm hakları saklıdır.
            <Heart size={10} className="text-[var(--brand)] opacity-60" />
          </p>
        </div>
      </div>
    </footer>
  );
}
