import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Check,
  CircleDollarSign,
  FileText,
  Gauge,
  Layers,
  LineChart,
  Lock,
  Menu,
  Search,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  Workflow,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PLANS } from "@/lib/plans";
import "./landing/landing.css";

const ECOSYSTEMS = [
  "Trendyol",
  "Amazon",
  "TikTok Shop",
  "Shopify",
  "Hepsiburada",
  "eBay",
  "Etsy",
  "Zalando",
];

const BENTO = [
  {
    icon: Layers,
    title: "Ürün Bulucu",
    text: "Tek aramada veri kaynakları taranır; talep, rekabet ve gerçek birim maliyet (tedarik + kargo + komisyon + KDV) aynı kartta birleşir.",
  },
  {
    icon: ShieldCheck,
    title: "Trend Radar",
    text: "20+ platformdaki talep ve fiyat hareketleri izlenir; trend herkese görünmeden önce raporlanır.",
  },
  {
    icon: Workflow,
    title: "14'lü AI Konsey",
    text: "Farklı uzman roller aynı ürünü ayrı ayrı tartışır; risk, aksiyon ve varsayımlar ayrıştırılmış tek bir raporda toplanır.",
  },
  {
    icon: CircleDollarSign,
    title: "Denetçi & ROI motoru",
    text: "Rakip mağazalar ve listingler denetlenir; fiyat, stok ve kampanya senaryolarının kârlılığı önceden simüle edilir.",
  },
];

const WHAT_WE_DO = [
  {
    icon: Search,
    step: "01",
    title: "Piyasayı analist gibi tara",
    text: "20+ platform ve ülke ekonomisi izlenir; talep sıçramaları, sezon kaymaları ve marj bozulmaları herkes fark etmeden önce yüzeye çıkar.",
  },
  {
    icon: Gauge,
    step: "02",
    title: "Ürünü gerçek ekonomi ile puanla",
    text: "Ödül puanı yalnız talebi değil gerçek birim ekonomisini de okur: tedarik, kargo, komisyon, KDV, iade ve reklam. %420 trend, -%12 marjı gizleyemez.",
  },
  {
    icon: Workflow,
    step: "03",
    title: "Sınırsız deneme: eğitim simülatörü",
    text: "Karar vermeden önce sezon ve kampanya senaryolarını simüle et. Yaptığın hatanın bedelini gerçek stokla değil, simülasyonda öde.",
  },
  {
    icon: LineChart,
    step: "04",
    title: "Kanıtı ve aksiyonu birlikte al",
    text: "14'lü AI Konsey her ürün için riski, aksiyonu ve varsayımları ayrı ayrı yazar. Hangi veriye dayandığını görürsün — kara kutu yok.",
  },
];

const FAQ_ITEMS = [
  {
    q: "Veriler nereden geliyor?",
    a: "Platform ve pazar yeri kaynakları tek hatta toplanır; her skorun yanında kaynağı ve ölçüm tarihi gösterilir. Bir kaynağa erişilemediğinde sonuç doğrulanmamış olarak işaretlenir.",
  },
  {
    q: "Hangi platform ve ülkeleri kapsıyor?",
    a: "Amazon, TikTok Shop, Shopify, Trendyol, Hepsiburada, eBay, Etsy, Zalando ve daha fazlası ile 20+ ülke ekonomisi modellenir. Her ülkenin komisyon, KDV, kargo ve sertifikasyon mantığı puanlamaya dahildir.",
  },
  {
    q: "Ürün puanı nasıl hesaplanıyor?",
    a: "Puan iki parçadan oluşur: talep momentumu ve gerçek birim ekonomisi. Talep tahminleri, rekabet seviyesi, tedarik/kargo/komisyon/vergi sonrası marj, uyumluluk ve iade riski birlikte değerlendirilir. Her puanın arkasındaki kanıt kartta gösterilir.",
  },
  {
    q: "Ödeme ve iptal nasıl işliyor?",
    a: "Ödemeler Paddle üzerinden alınır. Aboneliği istediğin zaman iptal edebilirsin; dönem sonuna kadar erişimin devam eder, otomatik yenileme durur.",
  },
  {
    q: "Veri güvenliği nasıl sağlanıyor?",
    a: "Veriler Supabase üzerinde tutulur ve satır düzeyi güvenlik (RLS) ile erişim kullanıcı bazında kısıtlanır. KVKK aydınlatma metni ve veri işleme sözleşmesi uygulama içinde yer alır.",
  },
  {
    q: "Ödemeden önce deneyebilir miyim?",
    a: "Evet. Kayıt olduğunda hoş geldin kredisi tanımlanır; Ürün Bulucu'yu kredi kartı girmeden denersin.",
  },
];

const PLAN_DESCRIPTIONS: Record<string, string> = {
  Starter: "Tek başına araştırma yapan satıcılar için.",
  Pro: "Büyüyen mağazalar ve küçük ekipler için.",
  Business: "Birden fazla kanalı yöneten ekipler için.",
};

function ProductPreview() {
  return (
    <div className="al-preview" aria-label="Örnek ürün analiz raporu">
      <div className="al-preview-top">
        <span className="al-preview-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="al-preview-url">app.aroless.com / ürün-raporu</span>
        <span className="al-preview-tag">Örnek görünüm</span>
      </div>

      <div className="al-preview-body">
        <div className="al-preview-head">
          <div className="al-product">
            <span className="al-product-icon" aria-hidden="true">
              <Smartphone size={18} strokeWidth={1.6} />
            </span>
            <div style={{ minWidth: 0 }}>
              <p className="al-preview-kicker">Ürün raporu · 12 Kasım</p>
              <h3>Manyetik telefon tutucu</h3>
              <p>Ev &amp; Yaşam · Trendyol + TikTok Shop</p>
            </div>
          </div>
          <div>
            <div className="al-score">
              <svg viewBox="0 0 72 72" aria-hidden="true">
                <circle
                  cx="36"
                  cy="36"
                  r="30"
                  fill="none"
                  stroke="var(--al-sage-2)"
                  strokeWidth="5"
                />
                <circle
                  cx="36"
                  cy="36"
                  r="30"
                  fill="none"
                  stroke="var(--al-green)"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray="188.5"
                  strokeDashoffset="30.2"
                  transform="rotate(-90 36 36)"
                />
              </svg>
              <div>
                <strong>84</strong>
                <small>/100</small>
              </div>
            </div>
            <span className="al-score-label">Fırsat skoru</span>
          </div>
        </div>

        <div className="al-metrics">
          <div className="al-metric">
            <span>Birim maliyet</span>
            <strong>₺184</strong>
            <small>Tedarik + kargo</small>
          </div>
          <div className="al-metric">
            <span>Önerilen fiyat</span>
            <strong>₺499</strong>
            <small>Pazar ortalaması</small>
          </div>
          <div className="al-metric">
            <span>Net marj</span>
            <strong>%31</strong>
            <small>Komisyon sonrası</small>
          </div>
        </div>

        <div className="al-chart">
          <div className="al-chart-head">
            <span>Talep ivmesi</span>
            <span className="al-chart-up">
              <TrendingUp size={11} /> +38%
            </span>
          </div>
          <svg viewBox="0 0 320 58" preserveAspectRatio="none" aria-hidden="true">
            <path
              d="M0 48 C 24 46, 36 42, 56 44 S 92 38, 112 36 S 146 39, 168 30 S 202 24, 224 26 S 260 18, 284 14 S 306 12, 320 6 L 320 58 L 0 58 Z"
              fill="rgba(28, 90, 67, 0.08)"
            />
            <path
              d="M0 48 C 24 46, 36 42, 56 44 S 92 38, 112 36 S 146 39, 168 30 S 202 24, 224 26 S 260 18, 284 14 S 306 12, 320 6"
              fill="none"
              stroke="var(--al-green)"
              strokeLinecap="round"
              strokeWidth="1.8"
            />
          </svg>
          <div className="al-chart-axis">
            <span>Eyl</span>
            <span>Eki</span>
            <span>Kas</span>
          </div>
        </div>

        <div className="al-evidence">
          <p className="al-evidence-title">Kanıtlar</p>
          <div className="al-evidence-row">
            <BadgeCheck size={12} strokeWidth={2} />
            <span>Trendyol · son 30 gün</span>
            <b>1.240 satış</b>
          </div>
          <div className="al-evidence-row">
            <BadgeCheck size={12} strokeWidth={2} />
            <span>TikTok Shop · içerik hacmi</span>
            <b>18 video</b>
          </div>
          <div className="al-evidence-row">
            <BadgeCheck size={12} strokeWidth={2} />
            <span>Amazon · rekabet seviyesi</span>
            <b>Orta</b>
          </div>
        </div>

        <div className="al-verdict">
          <span className="al-verdict-dot" aria-hidden="true" />
          <span>Değerlendirme: test etmeye değer</span>
          <span>3 kanıt doğrulandı</span>
        </div>
      </div>

      <div className="al-preview-foot">
        <Lock size={11} />
        Veriler kaynak etiketiyle gösterilir; skorun arkasındaki kanıt açıktır.
      </div>
    </div>
  );
}

export function MarketingLanding() {
  return (
    <div className="aroless-landing min-h-screen">
      <header className="al-header">
        <div className="al-container al-header-inner">
          <Link to="/" className="al-brand" aria-label="Aroless ana sayfa">
            <span className="al-mark">
              <img src="/logo-mark.png" alt="" width={21} height={21} />
            </span>
            <span className="al-wordmark">
              Aroless
              <small>Ürün araştırma platformu</small>
            </span>
          </Link>

          <nav className="al-nav" aria-label="Ana menü">
            <a href="#platform" className="al-nav-link">
              Nasıl çalışır
            </a>
            <a href="#architecture" className="al-nav-link">
              Platform
            </a>
            <a href="#pricing" className="al-nav-link">
              Fiyatlar
            </a>
            <a href="#faq" className="al-nav-link">
              SSS
            </a>
            <Link to="/tools" className="al-nav-link">
              Araçlar
            </Link>
            <Link to="/affiliate" className="al-nav-link">
              Affiliate
            </Link>
          </nav>

          <div className="al-header-actions">
            <Link to="/auth" className="al-header-signin">
              Giriş yap
            </Link>
            <Link to="/auth" search={{ mode: "signup" }} className="al-btn al-btn-primary">
              Ücretsiz başla
            </Link>
            <details className="al-mobile-menu">
              <summary aria-label="Menüyü aç">
                <Menu size={18} />
              </summary>
              <div className="al-mobile-panel">
                <a href="#platform">Nasıl çalışır</a>
                <a href="#architecture">Platform</a>
                <a href="#pricing">Fiyatlar</a>
                <a href="#faq">SSS</a>
                <Link to="/tools">Araçlar</Link>
                <Link to="/affiliate">Affiliate</Link>
                <Link to="/auth">Giriş yap</Link>
                <Link to="/auth" search={{ mode: "signup" }} className="al-mobile-cta">
                  Ücretsiz başla
                </Link>
              </div>
            </details>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="al-hero">
          <div className="al-container">
            <div className="al-hero-grid">
              <div className="al-hero-copy">
                <p className="al-eyebrow">E-ticaret ekipleri için karar platformu</p>
                <h1 className="al-display">Piyasa sinyallerini kârlı ürün kararlarına çevir.</h1>
                <p className="al-lead">
                  Aroless; ürün bulucudan kâr hesabına, trend radarından reklam metnine kadar tüm
                  araştırmanızı tek bir çalışma masasında toplar. Talep, rekabet ve gerçek maliyet
                  aynı ekranda görünür; her skorun arkasındaki kaynak açıktır.
                </p>

                <ul className="al-checks">
                  {["Kaynağı görünen skorlar", "Ülke bazlı kâr hesabı", "Tek panelde tüm akış"].map(
                    (item) => (
                      <li key={item}>
                        <Check size={14} strokeWidth={2.4} />
                        {item}
                      </li>
                    ),
                  )}
                </ul>

                <div className="al-actions">
                  <Link to="/auth" search={{ mode: "signup" }} className="al-btn al-btn-primary">
                    Ücretsiz başla
                    <ArrowRight size={15} />
                  </Link>
                  <a href="#platform" className="al-btn al-btn-secondary">
                    Nasıl çalışıyor?
                  </a>
                </div>

                <ul className="al-microtrust">
                  <li>
                    <Check size={11} strokeWidth={2.4} />
                    Kredi kullanımı — sürpriz fatura yok
                  </li>
                  <li>
                    <Check size={11} strokeWidth={2.4} />
                    Başlamak için kredi kartı gerekmez
                  </li>
                  <li>
                    <Check size={11} strokeWidth={2.4} />
                    Kayıt sonrası hemen kullanılabilir
                  </li>
                </ul>
              </div>

              <div className="al-hero-visual">
                <ProductPreview />
                <div className="al-float-card" aria-hidden="true">
                  <span className="al-float-icon">
                    <TrendingUp size={14} strokeWidth={1.8} />
                  </span>
                  <div>
                    <p>Trend radarı</p>
                    <strong>Ev &amp; Yaşam · +24%</strong>
                  </div>
                  <span className="al-float-badge">Bu hafta</span>
                </div>
                <p className="al-hero-caption">Örnek ürün raporu · Aroless çalışma alanı</p>
              </div>
            </div>

            <div className="al-logo-strip">
              <p>Şu platformlar için modelleme yapılır</p>
              <ul>
                {ECOSYSTEMS.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* What we do */}
        <section id="platform" className="al-section scroll-mt-24">
          <div className="al-container">
            <div className="al-section-head al-section-head-split">
              <div>
                <p className="al-eyebrow">Nasıl çalışır</p>
                <h2 className="al-h2">Dört adım, tek sonuç: izlenebilir karar.</h2>
              </div>
              <p className="al-section-sub">
                Ürün araştırmasını tahminden çıkarıp izlenebilir bir akışa dönüştürür. Her adım aynı
                çalışma alanında birbirine bağlanır.
              </p>
            </div>

            <div className="al-step-grid">
              {WHAT_WE_DO.map((card) => {
                const Icon = card.icon;
                return (
                  <article key={card.title} className="al-step">
                    <div className="al-step-top">
                      <span className="al-step-num">{card.step}</span>
                      <span className="al-step-icon">
                        <Icon size={16} strokeWidth={1.7} />
                      </span>
                    </div>
                    <h3>{card.title}</h3>
                    <p>{card.text}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* Platform modules */}
        <section id="architecture" className="al-section al-section-dark scroll-mt-24">
          <div className="al-container">
            <div className="al-section-head al-section-head-split">
              <div>
                <p className="al-eyebrow">Platform</p>
                <h2 className="al-h2">Uçtan uca izlenebilen bir hat</h2>
              </div>
              <p className="al-section-sub">
                Veri toplama → kaynak doğrulama → puanlama → konsey raporu. Her adım deterministik
                ve tekrarlanabilir.
              </p>
            </div>

            <div className="al-module-grid">
              {BENTO.map((card) => {
                const Icon = card.icon;
                return (
                  <article key={card.title} className="al-module">
                    <span className="al-module-icon">
                      <Icon size={17} strokeWidth={1.7} />
                    </span>
                    <h3>{card.title}</h3>
                    <p>{card.text}</p>
                  </article>
                );
              })}
            </div>

            <div className="al-compliance">
              <div className="al-compliance-copy">
                <FileText size={16} strokeWidth={1.7} />
                <div>
                  <strong>Veri ve erişim</strong>
                  <p>
                    Supabase RLS ile satır düzeyi yetkilendirme · KVKK aydınlatma ve veri işleme
                    sözleşmesi · ödemeler Paddle üzerinden
                  </p>
                </div>
              </div>
              <Link
                to="/legal/$slug"
                params={{ slug: "kvkk-aydinlatma-metni" }}
                className="al-compliance-link"
              >
                Yasal metinler <ArrowUpRight size={12} />
              </Link>
            </div>
          </div>
        </section>

        {/* Editorial quote */}
        <section className="al-quote-band">
          <div className="al-container">
            <span className="al-quote-mark" aria-hidden="true">
              “
            </span>
            <blockquote className="al-quote">
              İyi karar, daha fazla veri değil; doğru veriyi doğru yerde göstermektir.
            </blockquote>
            <p className="al-quote-source">Aroless ürün ekibi</p>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="al-section scroll-mt-24">
          <div className="al-container">
            <div className="al-section-head al-section-head-split">
              <div>
                <p className="al-eyebrow">Fiyatlandırma</p>
                <h2 className="al-h2">Şeffaf fiyatlandırma. Tüm modüller açık.</h2>
              </div>
              <p className="al-section-sub">
                Modül ayrımı yok; paketler yalnızca aylık kullanım hacmini değiştirir. Güncel
                fiyatlar ödeme adımında gösterilir.
              </p>
            </div>

            <div className="al-pricing-grid">
              {PLANS.map((plan) => (
                <article
                  key={plan.id}
                  className={`al-plan ${plan.highlight ? "al-plan-featured" : ""}`}
                >
                  <div className="al-plan-top">
                    <h3 className="al-plan-label">{plan.label}</h3>
                    {plan.highlight && <span className="al-plan-badge">En popüler</span>}
                  </div>
                  <div className="al-plan-price">
                    <strong>${plan.usd}</strong>
                    <span>/ay</span>
                  </div>
                  <p className="al-plan-desc">{PLAN_DESCRIPTIONS[plan.id]}</p>
                  <div className="al-plan-rule" />
                  <ul className="al-plan-list">
                    {plan.features.slice(0, 5).map((feature) => (
                      <li key={feature}>
                        <Check size={12} strokeWidth={2.4} />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Link to="/pricing" className="al-plan-cta">
                    Planı incele <ArrowRight size={12} />
                  </Link>
                </article>
              ))}
            </div>

            <p className="al-pricing-note">
              Güncel ve bağlayıcı fiyatlar her zaman{" "}
              <Link to="/pricing" title="Gerçek fiyatlar için /pricing →">
                fiyatlandırma sayfasında
              </Link>{" "}
              ve ödeme adımında gösterilir.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="al-section scroll-mt-24">
          <div className="al-container al-faq-grid">
            <div className="al-faq-intro">
              <p className="al-eyebrow">SSS</p>
              <h2 className="al-h2">Sıkça sorulan sorular</h2>
              <p>
                Ürün, veri ve faturalandırma hakkında en sık sorulanlar. Aradığınız cevabı
                bulamadıysanız destek ekibimize yazabilirsiniz.
              </p>
            </div>

            <div className="al-faq-list">
              <Accordion type="single" collapsible>
                {FAQ_ITEMS.map((item, i) => (
                  <AccordionItem key={item.q} value={`faq-${i}`} className="al-faq-item">
                    <AccordionTrigger className="al-faq-trigger">{item.q}</AccordionTrigger>
                    <AccordionContent className="al-faq-content">
                      <p>{item.a}</p>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="al-cta">
          <div className="al-container al-cta-inner">
            <div className="al-cta-copy">
              <h2>İlk analizini dakikalar içinde al.</h2>
              <p>
                Kayıt ol ve hoş geldin kredinle Ürün Bulucu'yu dene. Kurulum, uzun entegrasyon ya da
                kredi kartı gerekmez.
              </p>
              <ul className="al-cta-checks">
                {[
                  "Kredi kartı gerekmez",
                  "Kayıt anında hoş geldin kredisi",
                  "İstediğin zaman iptal",
                ].map((item) => (
                  <li key={item}>
                    <Check size={12} strokeWidth={2.4} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="al-cta-actions">
              <Link to="/auth" search={{ mode: "signup" }} className="al-btn al-btn-light">
                Ücretsiz başla
                <ArrowRight size={15} />
              </Link>
              <Link to="/pricing" className="al-btn al-btn-ghost-light">
                Fiyatları gör
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="al-footer">
        <div className="al-container al-footer-main">
          <div className="al-footer-brand">
            <Link to="/" className="al-brand" aria-label="Aroless ana sayfa">
              <span className="al-mark">
                <img src="/logo-mark.png" alt="" width={21} height={21} />
              </span>
              <span className="al-wordmark">
                Aroless
                <small>Ürün araştırma platformu</small>
              </span>
            </Link>
            <p>
              E-ticaret ekiplerinin ürün araştırmasını, kâr hesabını ve pazar kararlarını tek
              çalışma alanında toplayan karar platformu.
            </p>
            <p className="al-footer-affiliate">
              <Link to="/affiliate">Aroless'u paylaş, aylık komisyon kazan.</Link>
            </p>
            <p className="al-footer-affiliate-terms">
              <span>%30 oran</span> · <span>En fazla 12 ay</span> · <span>30 gün bekleme</span> ·{" "}
              <span>$75 eşiği</span>
            </p>
          </div>

          <div className="al-footer-col">
            <h3>Platform</h3>
            <ul>
              <li>
                <a href="#platform">Nasıl çalışır</a>
              </li>
              <li>
                <a href="#architecture">Platform</a>
              </li>
              <li>
                <Link to="/tools">Araçlar</Link>
              </li>
              <li>
                <Link to="/pricing">Fiyatlar</Link>
              </li>
            </ul>
          </div>

          <div className="al-footer-col">
            <h3>Şirket</h3>
            <ul>
              <li>
                <Link to="/affiliate">Affiliate programı</Link>
              </li>
              <li>
                <a href="#faq">SSS</a>
              </li>
              <li>
                <Link to="/auth">Giriş yap</Link>
              </li>
              <li>
                <Link to="/auth" search={{ mode: "signup" }}>
                  Ücretsiz başla
                </Link>
              </li>
            </ul>
          </div>

          <div className="al-footer-col">
            <h3>Yasal</h3>
            <ul>
              <li>
                <Link to="/legal/$slug" params={{ slug: "kvkk-aydinlatma-metni" }}>
                  KVKK aydınlatma metni
                </Link>
              </li>
              <li>
                <Link to="/legal/$slug" params={{ slug: "veri-isleme-sozlesmesi" }}>
                  Veri işleme sözleşmesi
                </Link>
              </li>
              <li>
                <Link to="/legal/$slug" params={{ slug: "cerez-politikasi" }}>
                  Çerez politikası
                </Link>
              </li>
              <li>
                <Link to="/legal/$slug" params={{ slug: "kullanim-kosullari" }}>
                  Kullanım koşulları
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="al-container">
          <div className="al-footer-bottom">
            <span>© {new Date().getFullYear()} Aroless. Tüm hakları saklıdır.</span>
            <div>
              <Link to="/legal/$slug" params={{ slug: "kvkk-aydinlatma-metni" }}>
                Gizlilik
              </Link>
              <Link to="/legal/$slug" params={{ slug: "kullanim-kosullari" }}>
                Koşullar
              </Link>
              <Link to="/pricing">Fiyatlar</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
