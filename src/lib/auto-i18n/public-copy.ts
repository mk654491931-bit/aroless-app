/**
 * PUBLIC SAYFA ÇEVİRİLERİ (landing + /affiliate).
 *
 * NEDEN AYRI DOSYA: `dict-*` sözlükleri uygulama ekranları için üretilmişti ve
 * 3000+ anahtar taşıyor; public pazarlama yüzeyi (landing ve affiliate sayfası)
 * sonradan yazıldığı için sözlüklerde HİÇ karşılığı yoktu. Ölçüm: landing ve
 * /affiliate üzerindeki 100+ görünür metnin neredeyse tamamı altı dilin
 * hiçbirinde bulunmuyordu — yani dil değiştirildiğinde bu sayfalar Türkçe
 * kalıyordu ("dil tüm siteye uygulanmıyor" şikâyetinin kökü).
 *
 * NEDEN BURADA (sözlük dosyalarına değil): bu metinler elle yazılır ve tek
 * kaynaktan gözden geçirilebilir olmalı. `runtime` sözlüğü
 * `{ ...dict, ...extrasFor(lang) }` ile kurar, yani buradaki kayıtlar ilgili
 * dilde yüklenen sözlüğü geçersiz kılar (override) ve ek/eksik anahtar
 * sorununu doğurmaz.
 *
 * KURAL: anahtar, kaynak metnin DOM'daki hâlidir (boşluklar tek boşluğa
 * indirgenmiş ve kırpılmış). Test bu sözleşmeyi dosyalardan okuyarak doğrular.
 */
export type PublicCopyLang = "en" | "es" | "de" | "fr" | "ar";

type Copy = Record<PublicCopyLang, string>;

export const PUBLIC_COPY: Record<string, Copy> = {
  /* ---------------- Navigasyon / footer ---------------- */
  Platform: {
    en: "Platform",
    es: "Plataforma",
    de: "Plattform",
    fr: "Plateforme",
    ar: "المنصة",
  },
  FAQ: {
    en: "FAQ",
    es: "Preguntas frecuentes",
    de: "FAQ",
    fr: "FAQ",
    ar: "الأسئلة الشائعة",
  },
  Pricing: { en: "Pricing", es: "Precios", de: "Preise", fr: "Tarifs", ar: "الأسعار" },
  Affiliate: {
    en: "Affiliate",
    es: "Afiliados",
    de: "Partnerprogramm",
    fr: "Affiliation",
    ar: "التسويق بالعمولة",
  },
  "What we do": {
    en: "What we do",
    es: "Qué hacemos",
    de: "Was wir tun",
    fr: "Ce que nous faisons",
    ar: "ما نقوم به",
  },
  "Yasal metinler": {
    en: "Legal documents",
    es: "Textos legales",
    de: "Rechtstexte",
    fr: "Mentions légales",
    ar: "النصوص القانونية",
  },

  /* ---------------- Hero ---------------- */
  "Piyasa sinyallerini kârlı ürün kararlarına çevir.": {
    en: "Turn market signals into profitable product decisions.",
    es: "Convierte las señales del mercado en decisiones rentables de producto.",
    de: "Verwandle Marktsignale in profitable Produktentscheidungen.",
    fr: "Transformez les signaux du marché en décisions produits rentables.",
    ar: "حوّل إشارات السوق إلى قرارات منتجات مربحة.",
  },
  "Ücretsiz başla": {
    en: "Start free",
    es: "Empieza gratis",
    de: "Kostenlos starten",
    fr: "Commencer gratuitement",
    ar: "ابدأ مجانًا",
  },
  "Nasıl çalışıyor?": {
    en: "How does it work?",
    es: "¿Cómo funciona?",
    de: "Wie funktioniert es?",
    fr: "Comment ça marche ?",
    ar: "كيف يعمل؟",
  },
  "Kredi kullanımı — sürpriz fatura yok": {
    en: "Credit-based usage — no surprise invoices",
    es: "Uso por créditos: sin facturas sorpresa",
    de: "Nutzung über Credits — keine Überraschungsrechnung",
    fr: "Usage par crédits — aucune facture surprise",
    ar: "الاستهلاك بالرصيد — بلا فواتير مفاجئة",
  },
  "Başlamak için kredi kartı gerekmez": {
    en: "No credit card needed to start",
    es: "No necesitas tarjeta para empezar",
    de: "Keine Kreditkarte zum Start nötig",
    fr: "Aucune carte bancaire requise pour commencer",
    ar: "لا حاجة إلى بطاقة ائتمان للبدء",
  },
  "Kayıt sonrası hemen kullanılabilir": {
    en: "Usable right after sign-up",
    es: "Disponible justo después de registrarte",
    de: "Direkt nach der Registrierung nutzbar",
    fr: "Utilisable dès l'inscription",
    ar: "جاهز للاستخدام فور التسجيل",
  },
  "Şu platformlar için modelleme yapılır": {
    en: "Modelled for these platforms",
    es: "Modelado para estas plataformas",
    de: "Modelliert für diese Plattformen",
    fr: "Modélisé pour ces plateformes",
    ar: "النمذجة لهذه المنصات",
  },

  /* ---------------- Ne yapıyoruz ---------------- */
  "Dört adım, tek sonuç: izlenebilir karar.": {
    en: "Four steps, one outcome: a traceable decision.",
    es: "Cuatro pasos, un resultado: una decisión trazable.",
    de: "Vier Schritte, ein Ergebnis: eine nachvollziehbare Entscheidung.",
    fr: "Quatre étapes, un résultat : une décision traçable.",
    ar: "أربع خطوات ونتيجة واحدة: قرار قابل للتتبع.",
  },
  "Piyasayı analist gibi tara": {
    en: "Scan the market like an analyst",
    es: "Analiza el mercado como un analista",
    de: "Den Markt wie ein Analyst scannen",
    fr: "Analysez le marché comme un analyste",
    ar: "امسح السوق كما يفعل المحلل",
  },
  "Tek aramada veri kaynakları taranır; talep, rekabet ve gerçek birim maliyet (tedarik + kargo + komisyon + KDV) aynı kartta birleşir.":
    {
      en: "Data sources are scanned in a single search; demand, competition and true unit cost (sourcing + shipping + commission + VAT) come together on one card.",
      es: "Las fuentes de datos se rastrean en una sola búsqueda; demanda, competencia y coste unitario real (compra + envío + comisión + IVA) se unen en una tarjeta.",
      de: "Datenquellen werden in einer Suche gescannt; Nachfrage, Wettbewerb und echte Stückkosten (Einkauf + Versand + Provision + MwSt.) landen auf einer Karte.",
      fr: "Les sources de données sont scannées en une seule recherche ; demande, concurrence et coût unitaire réel (achat + livraison + commission + TVA) réunis sur une carte.",
      ar: "تُمسح مصادر البيانات في بحث واحد؛ ويجتمع الطلب والمنافسة والتكلفة الحقيقية للوحدة (الشراء + الشحن + العمولة + الضريبة) في بطاقة واحدة.",
    },
  "Ürünü gerçek ekonomi ile puanla": {
    en: "Score the product with real economics",
    es: "Puntúa el producto con economía real",
    de: "Produkte mit echten Zahlen bewerten",
    fr: "Notez le produit avec l'économie réelle",
    ar: "قيّم المنتج باقتصاد حقيقي",
  },
  "Puan iki parçadan oluşur: talep momentumu ve gerçek birim ekonomisi. Talep tahminleri, rekabet seviyesi, tedarik/kargo/komisyon/vergi sonrası marj, uyumluluk ve iade riski birlikte değerlendirilir. Her puanın arkasındaki kanıt kartta gösterilir.":
    {
      en: "The score has two parts: demand momentum and true unit economics. Demand estimates, competition level, margin after sourcing/shipping/commission/tax, compliance and refund risk are weighed together. The evidence behind every score is shown on the card.",
      es: "La puntuación tiene dos partes: momentum de demanda y economía unitaria real. Se ponderan estimaciones de demanda, nivel de competencia, margen tras compra/envío/comisión/impuestos, cumplimiento y riesgo de devolución. La evidencia de cada puntuación se muestra en la tarjeta.",
      de: "Der Score besteht aus zwei Teilen: Nachfragemomentum und echte Stückökonomie. Nachfrageprognosen, Wettbewerbsniveau, Marge nach Einkauf/Versand/Provision/Steuer, Compliance und Retourrisiko werden gemeinsam bewertet. Die Belege hinter jedem Score stehen auf der Karte.",
      fr: "Le score comporte deux volets : l'élan de la demande et l'économie unitaire réelle. Estimations de demande, niveau de concurrence, marge après achat/livraison/commission/taxe, conformité et risque de retour sont pondérés ensemble. La preuve de chaque score figure sur la carte.",
      ar: "يتكوّن التقييم من جزأين: زخم الطلب واقتصاد الوحدة الحقيقي. تُوزن تقديرات الطلب ومستوى المنافسة والهامش بعد الشراء والشحن والعمولة والضريبة والالتزام ومخاطر الإرجاع معًا. ويظهر الدليل وراء كل تقييم على البطاقة.",
    },
  "Kanıtı ve aksiyonu birlikte al": {
    en: "Get evidence and action together",
    es: "Recibe evidencia y acción juntas",
    de: "Belege und Handlung gemeinsam",
    fr: "Preuve et action ensemble",
    ar: "الدليل والإجراء معًا",
  },
  "14'lü AI Konsey her ürün için riski, aksiyonu ve varsayımları ayrı ayrı yazar. Hangi veriye dayandığını görürsün — kara kutu yok.":
    {
      en: "The 14-agent AI Council writes risk, action and assumptions separately for each product. You see what it is based on — no black box.",
      es: "El Consejo de IA de 14 agentes escribe riesgo, acción y supuestos por separado para cada producto. Ves en qué se basa: sin caja negra.",
      de: "Der 14-köpfige KI-Rat schreibt Risiko, Handlung und Annahmen für jedes Produkt getrennt. Du siehst, worauf es beruht — keine Blackbox.",
      fr: "Le Conseil IA à 14 agents rédige risque, action et hypothèses séparément pour chaque produit. Vous voyez sur quoi il s'appuie — pas de boîte noire.",
      ar: "يكتب مجلس الذكاء الاصطناعي المكوّن من 14 وكيلًا المخاطر والإجراء والافتراضات لكل منتج على حدة. ترى ما يستند إليه — بلا صندوق أسود.",
    },
  "Sınırsız deneme: eğitim simülatörü": {
    en: "Unlimited practice: training simulator",
    es: "Práctica ilimitada: simulador de formación",
    de: "Unbegrenzt üben: Trainingssimulator",
    fr: "Entraînement illimité : simulateur de formation",
    ar: "تدريب بلا حدود: محاكي التعليم",
  },
  "Karar vermeden önce sezon ve kampanya senaryolarını simüle et. Yaptığın hatanın bedelini gerçek stokla değil, simülasyonda öde.":
    {
      en: "Simulate season and campaign scenarios before you decide. Pay for your mistakes in the simulation, not with real stock.",
      es: "Simula escenarios de temporada y campaña antes de decidir. Paga tus errores en la simulación, no con stock real.",
      de: "Simuliere Saison- und Kampagnenszenarien, bevor du entscheidest. Bezahle Fehler in der Simulation, nicht mit echtem Bestand.",
      fr: "Simulez des scénarios de saison et de campagne avant de décider. Payez vos erreurs dans la simulation, pas avec du stock réel.",
      ar: "حاكِ سيناريوهات الموسم والحملات قبل أن تقرر. ادفع ثمن أخطائك في المحاكاة لا بمخزون حقيقي.",
    },

  "Uçtan uca izlenebilen bir hat": {
    en: "A pipeline you can trace end to end",
    es: "Un proceso trazable de principio a fin",
    de: "Eine durchgängig nachvollziehbare Pipeline",
    fr: "Un pipeline traçable de bout en bout",
    ar: "مسار قابل للتتبع من البداية إلى النهاية",
  },
  "Veri toplama → kaynak doğrulama → puanlama → konsey raporu. Her adım deterministik ve tekrarlanabilir.":
    {
      en: "Data collection → source verification → scoring → council report. Every step is deterministic and repeatable.",
      es: "Recogida de datos → verificación de fuentes → puntuación → informe del consejo. Cada paso es determinista y repetible.",
      de: "Datenerhebung → Quellenprüfung → Bewertung → Ratsbericht. Jeder Schritt ist deterministisch und wiederholbar.",
      fr: "Collecte des données → vérification des sources → notation → rapport du conseil. Chaque étape est déterministe et reproductible.",
      ar: "جمع البيانات → التحقق من المصادر → التقييم → تقرير المجلس. كل خطوة حتمية وقابلة للتكرار.",
    },
  "Ürün Bulucu": {
    en: "Product Finder",
    es: "Buscador de productos",
    de: "Produktfinder",
    fr: "Chercheur de produits",
    ar: "مكتشف المنتجات",
  },
  "Trend Radar": {
    en: "Trend Radar",
    es: "Radar de tendencias",
    de: "Trend-Radar",
    fr: "Radar de tendances",
    ar: "رادار الاتجاهات",
  },
  "14'lü AI Konsey": {
    en: "14-agent AI Council",
    es: "Consejo de IA de 14 agentes",
    de: "14-köpfiger KI-Rat",
    fr: "Conseil IA à 14 agents",
    ar: "مجلس الذكاء الاصطناعي (14 وكيلًا)",
  },
  "Farklı uzman roller aynı ürünü ayrı ayrı tartışır; risk, aksiyon ve varsayımlar ayrıştırılmış tek bir raporda toplanır.":
    {
      en: "Different expert roles debate the same product separately; risk, action and assumptions are collected in one separated report.",
      es: "Distintos roles expertos debaten el mismo producto por separado; riesgo, acción y supuestos se reúnen en un único informe separado.",
      de: "Verschiedene Expertenrollen diskutieren dasselbe Produkt getrennt; Risiko, Handlung und Annahmen werden in einem getrennten Bericht gebündelt.",
      fr: "Différents rôles experts débattent du même produit séparément ; risque, action et hypothèses sont réunis dans un rapport unique et séparé.",
      ar: "تناقش أدوار خبراء مختلفة المنتج نفسه كلٌّ على حدة؛ وتُجمع المخاطر والإجراء والافتراضات في تقرير واحد مفصول.",
    },
  "Denetçi & ROI motoru": {
    en: "Auditor & ROI engine",
    es: "Auditor y motor de ROI",
    de: "Auditor & ROI-Motor",
    fr: "Auditeur et moteur de ROI",
    ar: "المدقق ومحرك العائد",
  },
  "Rakip mağazalar ve listingler denetlenir; fiyat, stok ve kampanya senaryolarının kârlılığı önceden simüle edilir.":
    {
      en: "Competitor stores and listings are audited; the profitability of price, stock and campaign scenarios is simulated in advance.",
      es: "Se auditan tiendas y anuncios de la competencia; se simula de antemano la rentabilidad de escenarios de precio, stock y campaña.",
      de: "Wettbewerber-Shops und Listings werden geprüft; die Rentabilität von Preis-, Bestands- und Kampagnenszenarien wird vorab simuliert.",
      fr: "Les boutiques et annonces concurrentes sont auditées ; la rentabilité des scénarios de prix, stock et campagne est simulée à l'avance.",
      ar: "يجري تدقيق متاجر المنافسين وقوائمهم؛ وتُحاكى مسبقًا ربحية سيناريوهات السعر والمخزون والحملات.",
    },
  "20+ platformdaki talep ve fiyat hareketleri izlenir; trend herkese görünmeden önce raporlanır.":
    {
      en: "Demand and price movements on 20+ platforms are tracked; the trend is reported before everyone sees it.",
      es: "Se siguen los movimientos de demanda y precio en más de 20 plataformas; la tendencia se informa antes de que todos la vean.",
      de: "Nachfrage- und Preisbewegungen auf 20+ Plattformen werden verfolgt; der Trend wird gemeldet, bevor ihn alle sehen.",
      fr: "Les mouvements de demande et de prix sur plus de 20 plateformes sont suivis ; la tendance est signalée avant que tout le monde la voie.",
      ar: "تُتابع تحركات الطلب والأسعار على أكثر من 20 منصة؛ ويُبلّغ عن الاتجاه قبل أن يراه الجميع.",
    },
  "20+ platform ve ülke ekonomisi izlenir; talep sıçramaları, sezon kaymaları ve marj bozulmaları herkes fark etmeden önce yüzeye çıkar.":
    {
      en: "The economies of 20+ platforms and countries are monitored; demand spikes, season shifts and margin erosion surface before anyone else notices.",
      es: "Se vigilan las economías de más de 20 plataformas y países; los picos de demanda, los cambios de temporada y la erosión del margen salen a la luz antes que nadie.",
      de: "Die Ökonomie von 20+ Plattformen und Ländern wird überwacht; Nachfragespitzen, Saisonverschiebungen und Margenverfall zeigen sich, bevor es andere bemerken.",
      fr: "L'économie de plus de 20 plateformes et pays est surveillée ; pics de demande, décalages saisonniers et érosion des marges apparaissent avant tout le monde.",
      ar: "تُراقب اقتصادات أكثر من 20 منصة ودولة؛ فتظهر قفزات الطلب وتحولات الموسم وتآكل الهامش قبل أن يلاحظها أحد.",
    },
  "Veri ve erişim": {
    en: "Data and access",
    es: "Datos y acceso",
    de: "Daten und Zugriff",
    fr: "Données et accès",
    ar: "البيانات والوصول",
  },
  "Supabase RLS ile satır düzeyi yetkilendirme · KVKK aydınlatma ve veri işleme sözleşmesi · ödemeler Paddle üzerinden":
    {
      en: "Row-level authorisation with Supabase RLS · KVKK privacy notice and data processing agreement · payments via Paddle",
      es: "Autorización a nivel de fila con Supabase RLS · aviso de privacidad KVKK y contrato de tratamiento de datos · pagos con Paddle",
      de: "Zeilenbasierte Autorisierung mit Supabase RLS · KVKK-Datenschutzhinweis und Auftragsverarbeitungsvertrag · Zahlungen über Paddle",
      fr: "Autorisation au niveau des lignes avec Supabase RLS · information KVKK et contrat de traitement des données · paiements via Paddle",
      ar: "تفويض على مستوى الصفوف عبر Supabase RLS · إشعار الخصوصية KVKK واتفاقية معالجة البيانات · المدفوعات عبر Paddle",
    },
  "Amazon, TikTok Shop, Shopify, Trendyol, Hepsiburada, eBay, Etsy, Zalando ve daha fazlası ile 20+ ülke ekonomisi modellenir. Her ülkenin komisyon, KDV, kargo ve sertifikasyon mantığı puanlamaya dahildir.":
    {
      en: "The economies of 20+ countries are modelled with Amazon, TikTok Shop, Shopify, Trendyol, Hepsiburada, eBay, Etsy, Zalando and more. Each country's commission, VAT, shipping and certification logic is included in the scoring.",
      es: "Se modelan las economías de más de 20 países con Amazon, TikTok Shop, Shopify, Trendyol, Hepsiburada, eBay, Etsy, Zalando y más. La lógica de comisión, IVA, envío y certificación de cada país entra en la puntuación.",
      de: "Die Ökonomie von 20+ Ländern wird mit Amazon, TikTok Shop, Shopify, Trendyol, Hepsiburada, eBay, Etsy, Zalando und mehr modelliert. Provision, MwSt., Versand und Zertifizierungslogik jedes Landes fließen in die Bewertung ein.",
      fr: "L'économie de plus de 20 pays est modélisée avec Amazon, TikTok Shop, Shopify, Trendyol, Hepsiburada, eBay, Etsy, Zalando et d'autres. La logique de commission, TVA, livraison et certification de chaque pays entre dans la notation.",
      ar: "تُنمذج اقتصادات أكثر من 20 دولة مع Amazon وTikTok Shop وShopify وTrendyol وHepsiburada وeBay وEtsy وZalando وغيرها. وتُدرج منطق العمولة والضريبة والشحن والشهادات لكل دولة في التقييم.",
    },

  "Gerçek fiyatlar için /pricing →": {
    en: "See real prices at /pricing →",
    es: "Precios reales en /pricing →",
    de: "Echte Preise unter /pricing →",
    fr: "Tarifs réels sur /pricing →",
    ar: "الأسعار الفعلية على /pricing ←",
  },

  /* ---------------- Fiyat önizlemesi ---------------- */
  "Şeffaf fiyatlandırma. Tüm modüller açık.": {
    en: "Transparent pricing. Every module unlocked.",
    es: "Precios transparentes. Todos los módulos abiertos.",
    de: "Transparente Preise. Alle Module freigeschaltet.",
    fr: "Tarifs transparents. Tous les modules ouverts.",
    ar: "تسعير شفاف. كل الوحدات مفتوحة.",
  },
  "En popüler": {
    en: "Most popular",
    es: "Más popular",
    de: "Am beliebtesten",
    fr: "Le plus populaire",
    ar: "الأكثر شيوعًا",
  },
  "Tüm modüller açık": {
    en: "All modules unlocked",
    es: "Todos los módulos abiertos",
    de: "Alle Module freigeschaltet",
    fr: "Tous les modules ouverts",
    ar: "كل الوحدات مفتوحة",
  },
  "Kayıt ol ve hoş geldin kredinle Ürün Bulucu'yu dene. Kurulum, uzun entegrasyon ya da kredi kartı gerekmez.":
    {
      en: "Sign up and try Product Finder with your welcome credits. No setup, no long integration, no credit card.",
      es: "Regístrate y prueba el Buscador de productos con tus créditos de bienvenida. Sin instalación, sin integración larga y sin tarjeta.",
      de: "Registriere dich und teste den Produktfinder mit deinem Willkommensguthaben. Keine Einrichtung, keine lange Integration, keine Kreditkarte.",
      fr: "Inscrivez-vous et essayez le Chercheur de produits avec vos crédits de bienvenue. Pas d'installation, pas de longue intégration, pas de carte bancaire.",
      ar: "سجّل وجرّب مكتشف المنتجات برصيد الترحيب. بلا إعداد ولا تكامل طويل ولا بطاقة ائتمان.",
    },
  "İlk analizini dakikalar içinde al.": {
    en: "Get your first analysis within minutes.",
    es: "Obtén tu primer análisis en minutos.",
    de: "Erhalte deine erste Analyse in Minuten.",
    fr: "Obtenez votre première analyse en quelques minutes.",
    ar: "احصل على تحليلك الأول في دقائق.",
  },

  /* ---------------- Landing FAQ ---------------- */
  "Hangi platform ve ülkeleri kapsıyor?": {
    en: "Which platforms and countries are covered?",
    es: "¿Qué plataformas y países cubre?",
    de: "Welche Plattformen und Länder sind abgedeckt?",
    fr: "Quelles plateformes et quels pays sont couverts ?",
    ar: "ما المنصات والدول المشمولة؟",
  },
  "Veri güvenliği nasıl sağlanıyor?": {
    en: "How is data security ensured?",
    es: "¿Cómo se garantiza la seguridad de los datos?",
    de: "Wie wird die Datensicherheit gewährleistet?",
    fr: "Comment la sécurité des données est-elle assurée ?",
    ar: "كيف تُؤمَّن حماية البيانات؟",
  },
  "Veriler Supabase üzerinde tutulur ve satır düzeyi güvenlik (RLS) ile erişim kullanıcı bazında kısıtlanır. KVKK aydınlatma metni ve veri işleme sözleşmesi uygulama içinde yer alır.":
    {
      en: "Data is stored on Supabase and access is restricted per user with row-level security (RLS). The KVKK privacy notice and data processing agreement are available in the app.",
      es: "Los datos se guardan en Supabase y el acceso se restringe por usuario con seguridad a nivel de fila (RLS). El aviso de privacidad KVKK y el contrato de tratamiento están en la app.",
      de: "Daten liegen auf Supabase und der Zugriff wird pro Nutzer mit Row-Level-Security (RLS) eingeschränkt. KVKK-Datenschutzhinweis und Auftragsverarbeitungsvertrag sind in der App verfügbar.",
      fr: "Les données sont stockées sur Supabase et l'accès est restreint par utilisateur via la sécurité au niveau des lignes (RLS). L'information KVKK et le contrat de traitement figurent dans l'app.",
      ar: "تُخزَّن البيانات على Supabase ويُقيَّد الوصول لكل مستخدم عبر أمان مستوى الصفوف (RLS). ويتوفر إشعار KVKK واتفاقية معالجة البيانات داخل التطبيق.",
    },
  "Ödeme ve iptal nasıl işliyor?": {
    en: "How do payment and cancellation work?",
    es: "¿Cómo funcionan el pago y la cancelación?",
    de: "Wie funktionieren Zahlung und Kündigung?",
    fr: "Comment fonctionnent le paiement et l'annulation ?",
    ar: "كيف يعمل الدفع والإلغاء؟",
  },
  "Ödemeler Paddle üzerinden alınır. Aboneliği istediğin zaman iptal edebilirsin; dönem sonuna kadar erişimin devam eder, otomatik yenileme durur.":
    {
      en: "Payments are collected via Paddle. You can cancel the subscription any time; access continues until the end of the period and auto-renewal stops.",
      es: "Los pagos se cobran a través de Paddle. Puedes cancelar la suscripción cuando quieras; el acceso continúa hasta el final del periodo y la renovación automática se detiene.",
      de: "Zahlungen laufen über Paddle. Du kannst das Abonnement jederzeit kündigen; der Zugang läuft bis zum Ende des Zeitraums weiter und die automatische Verlängerung stoppt.",
      fr: "Les paiements sont encaissés via Paddle. Vous pouvez annuler l'abonnement à tout moment ; l'accès se poursuit jusqu'à la fin de la période et le renouvellement automatique s'arrête.",
      ar: "تُحصَّل المدفوعات عبر Paddle. يمكنك إلغاء الاشتراك في أي وقت؛ ويستمر الوصول حتى نهاية الفترة ويتوقف التجديد التلقائي.",
    },
  "Ödemeden önce deneyebilir miyim?": {
    en: "Can I try before paying?",
    es: "¿Puedo probarlo antes de pagar?",
    de: "Kann ich vor der Zahlung testen?",
    fr: "Puis-je essayer avant de payer ?",
    ar: "هل يمكنني التجربة قبل الدفع؟",
  },
  "Evet. Kayıt olduğunda hoş geldin kredisi tanımlanır; Ürün Bulucu'yu kredi kartı girmeden denersin.":
    {
      en: "Yes. Welcome credits are added when you sign up; you can try Product Finder without entering a credit card.",
      es: "Sí. Al registrarte se añaden créditos de bienvenida; puedes probar el Buscador de productos sin introducir tarjeta.",
      de: "Ja. Bei der Registrierung erhältst du Willkommensguthaben; du kannst den Produktfinder ohne Kreditkarte testen.",
      fr: "Oui. Des crédits de bienvenue sont ajoutés à l'inscription ; vous pouvez essayer le Chercheur de produits sans carte bancaire.",
      ar: "نعم. يُضاف رصيد ترحيبي عند التسجيل؛ ويمكنك تجربة مكتشف المنتجات دون إدخال بطاقة ائتمان.",
    },
  "Ürün puanı nasıl hesaplanıyor?": {
    en: "How is the product score calculated?",
    es: "¿Cómo se calcula la puntuación del producto?",
    de: "Wie wird der Produkt-Score berechnet?",
    fr: "Comment le score produit est-il calculé ?",
    ar: "كيف يُحسب تقييم المنتج؟",
  },
  "Ödül puanı yalnız talebi değil gerçek birim ekonomisini de okur: tedarik, kargo, komisyon, KDV, iade ve reklam. %420 trend, -%12 marjı gizleyemez.":
    {
      en: "The score reads real unit economics, not just demand: sourcing, shipping, commission, VAT, refunds and ads. A 420% trend cannot hide a -12% margin.",
      es: "La puntuación lee la economía unitaria real, no solo la demanda: compra, envío, comisión, IVA, devoluciones y anuncios. Una tendencia del 420% no puede ocultar un margen del -12%.",
      de: "Der Score liest echte Stückökonomie, nicht nur Nachfrage: Einkauf, Versand, Provision, MwSt., Retouren und Werbung. Ein Trend von 420 % kann eine Marge von -12 % nicht verbergen.",
      fr: "Le score lit l'économie unitaire réelle, pas seulement la demande : achat, livraison, commission, TVA, retours et publicité. Une tendance de 420 % ne peut pas cacher une marge de -12 %.",
      ar: "يقرأ التقييم اقتصاد الوحدة الحقيقي لا الطلب فقط: الشراء والشحن والعمولة والضريبة والإرجاع والإعلان. فاتجاه ‎420% لا يمكنه إخفاء هامش ‎-12%.",
    },

  /* ---------------- /affiliate sayfası ---------------- */
  "Affiliate programı": {
    en: "Affiliate program",
    es: "Programa de afiliados",
    de: "Partnerprogramm",
    fr: "Programme d'affiliation",
    ar: "برنامج التسويق بالعمولة",
  },
  "Başvuru için giriş yap": {
    en: "Sign in to apply",
    es: "Inicia sesión para solicitar",
    de: "Zum Bewerben anmelden",
    fr: "Connectez-vous pour postuler",
    ar: "سجّل الدخول للتقديم",
  },
  "1 · Başvur": {
    en: "1 · Apply",
    es: "1 · Solicita",
    de: "1 · Bewerben",
    fr: "1 · Postuler",
    ar: "1 · قدّم",
  },
  "2 · Kodunu al": {
    en: "2 · Get your code",
    es: "2 · Recibe tu código",
    de: "2 · Code erhalten",
    fr: "2 · Recevez votre code",
    ar: "2 · احصل على رمزك",
  },
  "3 · Paylaş, komisyon biriksin": {
    en: "3 · Share and earn commission",
    es: "3 · Comparte y gana comisión",
    de: "3 · Teilen und Provision sammeln",
    fr: "3 · Partagez et cumulez la commission",
    ar: "3 · شارك واجمع العمولة",
  },
  "4 · Ödemeni al": {
    en: "4 · Get paid",
    es: "4 · Cobra",
    de: "4 · Auszahlung erhalten",
    fr: "4 · Recevez votre paiement",
    ar: "4 · استلم أجرك",
  },
  "Aşağıdaki sayılar platformun gerçekte uyguladığı kurallardır. Panelde ve ödeme kaydında da aynı değerler görünür.":
    {
      en: "The numbers below are the rules the platform actually enforces. The same values appear in the panel and the payout record.",
      es: "Las cifras siguientes son las reglas que la plataforma aplica de verdad. Los mismos valores aparecen en el panel y en el registro de pago.",
      de: "Die folgenden Zahlen sind die Regeln, die die Plattform tatsächlich anwendet. Dieselben Werte erscheinen im Panel und im Auszahlungsdatensatz.",
      fr: "Les chiffres ci-dessous sont les règles réellement appliquées par la plateforme. Les mêmes valeurs figurent dans le panneau et dans l'enregistrement du paiement.",
      ar: "الأرقام أدناه هي القواعد التي تطبقها المنصة فعليًا. وتظهر القيم نفسها في اللوحة وفي سجل الدفع.",
    },
  "%30 oran": {
    en: "30% rate",
    es: "Tasa del 30%",
    de: "30 % Satz",
    fr: "Taux de 30 %",
    ar: "نسبة ‎30%",
  },
  "En fazla 12 ay": {
    en: "Up to 12 months",
    es: "Hasta 12 meses",
    de: "Maximal 12 Monate",
    fr: "Jusqu'à 12 mois",
    ar: "حتى 12 شهرًا",
  },
  "30 gün bekleme": {
    en: "30-day hold",
    es: "Retención de 30 días",
    de: "30 Tage Wartezeit",
    fr: "Attente de 30 jours",
    ar: "انتظار 30 يومًا",
  },
  "$75 eşiği": {
    en: "$75 threshold",
    es: "Umbral de $75",
    de: "75 $ Schwelle",
    fr: "Seuil de 75 $",
    ar: "حد ‎75$",
  },
  "İade mahsubu": {
    en: "Refund offset",
    es: "Compensación de reembolsos",
    de: "Rückerstattungsverrechnung",
    fr: "Compensation des remboursements",
    ar: "خصم المبالغ المُرجَعة",
  },
  "Doğrulanmış hesap şartı": {
    en: "Verified-account requirement",
    es: "Requisito de cuenta verificada",
    de: "Erfordernis verifiziertes Konto",
    fr: "Exigence de compte vérifié",
    ar: "شرط الحساب المُوثَّق",
  },
  "Komisyon ve ödeme kuralları": {
    en: "Commission and payout rules",
    es: "Reglas de comisión y pago",
    de: "Provisions- und Auszahlungsregeln",
    fr: "Règles de commission et de paiement",
    ar: "قواعد العمولة والدفع",
  },
  "Sık sorulanlar": {
    en: "Frequently asked questions",
    es: "Preguntas frecuentes",
    de: "Häufige Fragen",
    fr: "Questions fréquentes",
    ar: "الأسئلة الشائعة",
  },
  "Program şartları": {
    en: "Program terms",
    es: "Términos del programa",
    de: "Programmbedingungen",
    fr: "Conditions du programme",
    ar: "شروط البرنامج",
  },
  "Programı başlat": {
    en: "Start the program",
    es: "Comenzar el programa",
    de: "Programm starten",
    fr: "Lancer le programme",
    ar: "ابدأ البرنامج",
  },
  "Şartları oku": {
    en: "Read the terms",
    es: "Leer los términos",
    de: "Bedingungen lesen",
    fr: "Lire les conditions",
    ar: "اقرأ الشروط",
  },
  "Giriş yap ve başvur": {
    en: "Sign in and apply",
    es: "Inicia sesión y solicita",
    de: "Anmelden und bewerben",
    fr: "Connectez-vous et postulez",
    ar: "سجّل الدخول وقدّم",
  },
  "Başvurun birkaç dakika sürer": {
    en: "Applying takes a few minutes",
    es: "Solicitar tarda unos minutos",
    de: "Die Bewerbung dauert wenige Minuten",
    fr: "La candidature prend quelques minutes",
    ar: "يستغرق التقديم دقائق",
  },
  "Kitle/kanal beyanı ve şartların kabulü yeterli. Onaydan sonra affiliate kodun panelde görünür; kazancını ve beklemede/ödenebilir bakiyeni aynı yerden takip edersin.":
    {
      en: "Declaring your audience/channels and accepting the terms is enough. After approval your affiliate code appears in the panel; you track earnings and your held/payable balance in the same place.",
      es: "Basta con declarar tu audiencia/canales y aceptar los términos. Tras la aprobación tu código de afiliado aparece en el panel; sigues tus ganancias y el saldo retenido/pagable en el mismo sitio.",
      de: "Angabe von Zielgruppe/Kanälen und Annahme der Bedingungen genügt. Nach der Freigabe erscheint dein Partner-Code im Panel; Verdienst und offener/auszahlbarer Saldo siehst du an derselben Stelle.",
      fr: "Déclarer votre audience/canaux et accepter les conditions suffit. Après validation, votre code d'affiliation apparaît dans le panneau ; vous suivez vos gains et votre solde retenu/payable au même endroit.",
      ar: "يكفي الإفصاح عن جمهورك/قنواتك وقبول الشروط. وبعد الموافقة يظهر رمز التسويق في اللوحة؛ وتتابع أرباحك ورصيدك المعلّق/القابل للدفع في المكان نفسه.",
    },
  "Başvuru ve ödemeler manuel ilerler; onay süresi garanti edilmez. Ödeme tarihi vaat edilmez.": {
    en: "Applications and payouts are handled manually; approval time is not guaranteed. No payment date is promised.",
    es: "Las solicitudes y los pagos se tramitan manualmente; no se garantiza el plazo de aprobación. No se promete fecha de pago.",
    de: "Bewerbungen und Auszahlungen laufen manuell; eine Freigabefrist wird nicht garantiert. Ein Auszahlungstermin wird nicht zugesagt.",
    fr: "Les candidatures et paiements sont traités manuellement ; le délai de validation n'est pas garanti. Aucune date de paiement n'est promise.",
    ar: "تُعالج الطلبات والمدفوعات يدويًا؛ ولا يُضمن وقت الموافقة. ولا يُوعَد بتاريخ دفع.",
  },
  "Kodum takipçilere indirim veriyor mu?": {
    en: "Does my code give followers a discount?",
    es: "¿Mi código da descuento a mis seguidores?",
    de: "Gibt mein Code Followern einen Rabatt?",
    fr: "Mon code offre-t-il une réduction à mes abonnés ?",
    ar: "هل يمنح رمزي خصمًا لمتابعيّ؟",
  },
  "Hayır. Affiliate kodu komisyonun kime gideceğini belirler; uygulama indirim hesaplamaz. İndirimler tek kaynaktan (Paddle paneli) yönetilir — orada aynı metinle bir indirim tanımlarsan takipçin onu kullanabilir.":
    {
      en: "No. The affiliate code decides who receives the commission; the app does not calculate discounts. Discounts are managed from a single source (the Paddle dashboard) — if you define a discount with the same code there, your follower can use it.",
      es: "No. El código de afiliado determina quién recibe la comisión; la app no calcula descuentos. Los descuentos se gestionan desde una única fuente (el panel de Paddle): si defines ahí un descuento con el mismo código, tu seguidor podrá usarlo.",
      de: "Nein. Der Partner-Code bestimmt, wer die Provision erhält; die App berechnet keine Rabatte. Rabatte werden zentral verwaltet (Paddle-Dashboard) — legst du dort einen Rabatt mit demselben Code an, kann dein Follower ihn nutzen.",
      fr: "Non. Le code d'affiliation détermine qui reçoit la commission ; l'app ne calcule pas de remise. Les remises sont gérées depuis une source unique (le tableau de bord Paddle) — si vous y créez une remise avec le même code, votre abonné pourra l'utiliser.",
      ar: "لا. يحدد رمز التسويق من يتلقى العمولة؛ ولا يحسب التطبيق الخصومات. تُدار الخصومات من مصدر واحد (لوحة Paddle) — وإذا أنشأت هناك خصمًا بالرمز نفسه، أمكن متابعك استخدامه.",
    },
  "Ödeme ne zaman yapılır?": {
    en: "When is payment made?",
    es: "¿Cuándo se paga?",
    de: "Wann wird ausgezahlt?",
    fr: "Quand le paiement a-t-il lieu ?",
    ar: "متى يتم الدفع؟",
  },
  "Vergi numarası vermek zorunda mıyım?": {
    en: "Do I have to provide a tax number?",
    es: "¿Tengo que dar un número fiscal?",
    de: "Muss ich eine Steuernummer angeben?",
    fr: "Dois-je fournir un numéro fiscal ?",
    ar: "هل يجب تقديم رقم ضريبي؟",
  },
  "Hayır, opsiyoneldir ve ödeme için şart değildir. Bazı ülkelerde banka veya Wise yüksek tutarlı transferlerde isteyebilir; o durumda bilgi sana iletilecektir. Vergi/mükellefiyet yükümlülüğü sana aittir.":
    {
      en: "No, it is optional and not required for payment. In some countries the bank or Wise may request it for high-value transfers; you would be informed in that case. Tax obligations remain yours.",
      es: "No, es opcional y no es un requisito para cobrar. En algunos países el banco o Wise pueden pedirlo para transferencias altas; en ese caso se te informará. Las obligaciones fiscales son tuyas.",
      de: "Nein, sie ist optional und keine Voraussetzung für die Auszahlung. In manchen Ländern kann die Bank oder Wise sie bei hohen Beträgen verlangen; dann wirst du informiert. Steuerpflichten bleiben bei dir.",
      fr: "Non, il est facultatif et non requis pour le paiement. Dans certains pays, la banque ou Wise peut le demander pour des transferts élevés ; vous en serez informé. Les obligations fiscales restent les vôtres.",
      ar: "لا، فهو اختياري وليس شرطًا للدفع. وقد تطلبه بعض البنوك أو Wise في التحويلات الكبيرة، وسيُبلَّغ لك ذلك. أما الالتزامات الضريبية فتبقى عليك.",
    },
  "Kendi hesabımdan alım yaparsam?": {
    en: "What if I buy from my own account?",
    es: "¿Y si compro desde mi propia cuenta?",
    de: "Was, wenn ich über mein eigenes Konto kaufe?",
    fr: "Et si j'achète depuis mon propre compte ?",
    ar: "ماذا لو اشتركت من حسابي الخاص؟",
  },
  "Kendine atıf yasaktır. Aynı cihazdan kendi kodunla açılan ikinci hesap atıf üretmez ve tespit edilirse komisyon ödenmez.":
    {
      en: "Self-referral is forbidden. A second account opened from the same device with your own code generates no attribution, and if detected no commission is paid.",
      es: "La autoreferencia está prohibida. Una segunda cuenta abierta desde el mismo dispositivo con tu propio código no genera atribución y, si se detecta, no se paga comisión.",
      de: "Selbstwerbung ist untersagt. Ein zweites Konto vom selben Gerät mit deinem eigenen Code erzeugt keine Zuordnung; wird es erkannt, wird keine Provision gezahlt.",
      fr: "L'auto-parrainage est interdit. Un second compte ouvert depuis le même appareil avec votre propre code ne génère aucune attribution ; en cas de détection, aucune commission n'est versée.",
      ar: "الإحالة الذاتية ممنوعة. الحساب الثاني من الجهاز نفسه وبرمزك لا يولّد إحالة، وإن اكتُشف فلا تُدفع عمولة.",
    },
  "Başvurum ne zaman onaylanır?": {
    en: "When is my application approved?",
    es: "¿Cuándo se aprueba mi solicitud?",
    de: "Wann wird meine Bewerbung freigegeben?",
    fr: "Quand ma candidature est-elle validée ?",
    ar: "متى تتم الموافقة على طلبي؟",
  },

  /* ---------------- Landing: affiliate bölümü (yeni) ---------------- */
  "Aroless'u paylaş, aylık komisyon kazan.": {
    en: "Share Aroless, earn monthly commission.",
    es: "Comparte Aroless y gana comisión mensual.",
    de: "Aroless teilen, monatliche Provision verdienen.",
    fr: "Partagez Aroless et gagnez une commission mensuelle.",
    ar: "شارك Aroless واكسب عمولة شهرية.",
  },
  "Affiliate programını gör": {
    en: "See the affiliate program",
    es: "Ver el programa de afiliados",
    de: "Partnerprogramm ansehen",
    fr: "Voir le programme d'affiliation",
    ar: "اطّلع على برنامج التسويق بالعمولة",
  },
  "Örnek yorumlar": {
    en: "Sample reviews",
    es: "Reseñas de ejemplo",
    de: "Beispielrezensionen",
    fr: "Avis d'exemple",
    ar: "مراجعات توضيحية",
  },
  SSS: {
    en: "FAQ",
    es: "FAQ",
    de: "FAQ",
    fr: "FAQ",
    ar: "الأسئلة الشائعة",
  },
  "Bu yorumlar gerçek müşteri yorumu değildir; ürünün hangi sorunlara cevap verdiğini göstermek için yazılmış temsilî örneklerdir.":
    {
      en: "These are not real customer reviews; they are illustrative examples written to show which problems the product solves.",
      es: "No son reseñas reales de clientes; son ejemplos ilustrativos escritos para mostrar qué problemas resuelve el producto.",
      de: "Dies sind keine echten Kundenbewertungen, sondern illustrative Beispiele, die zeigen, welche Probleme das Produkt löst.",
      fr: "Ce ne sont pas de vrais avis clients ; ce sont des exemples illustratifs montrant quels problèmes le produit résout.",
      ar: "ليست هذه مراجعات عملاء حقيقية، بل أمثلة توضيحية كُتبت لإظهار المشكلات التي يحلّها المنتج.",
    },

  /* ---------------- Public sayfa: araç merkezi (/tools) ---------------- */
  "Fiyatları gör": {
    en: "See pricing",
    es: "Ver precios",
    de: "Preise ansehen",
    fr: "Voir les tarifs",
    ar: "اطّلع على الأسعار",
  },
  "Araç merkezi": {
    en: "Tool centre",
    es: "Centro de herramientas",
    de: "Werkzeug-Zentrale",
    fr: "Centre d'outils",
    ar: "مركز الأدوات",
  },
  "Tüm AI araçlarını tek panelde çalıştır.": {
    en: "Run every AI tool from one panel.",
    es: "Ejecuta todas las herramientas de IA desde un solo panel.",
    de: "Nutze alle KI-Werkzeuge in einem Panel.",
    fr: "Exécutez tous les outils IA depuis un seul panneau.",
    ar: "شغّل جميع أدوات الذكاء الاصطناعي من لوحة واحدة.",
  },
  "Ürün bulmadan tedarik görüşmesine, gerçek maliyet hesabından listing optimizasyonuna kadar tüm araçlar aynı panelde çalışır; her çıktı risk, aksiyon ve varsayım olarak geri döner.":
    {
      en: "From product discovery to supplier negotiation, from true cost maths to listing optimisation, every tool runs in the same panel — and each output comes back as risk, action and assumptions.",
      es: "Desde la búsqueda de producto hasta la negociación con el proveedor, del cálculo del coste real a la optimización del listing, todo se ejecuta en el mismo panel, y cada resultado vuelve como riesgo, acción y supuestos.",
      de: "Von der Produktsuche über die Lieferantenverhandlung und echte Kostenrechnung bis zur Listing-Optimierung läuft alles in einem Panel — und jede Ausgabe kommt als Risiko, Handlung und Annahmen zurück.",
      fr: "De la recherche de produit à la négociation fournisseur, du calcul du coût réel à l'optimisation du listing, tout s'exécute dans le même panneau — et chaque résultat revient sous forme de risque, action et hypothèses.",
      ar: "من البحث عن المنتج إلى التفاوض مع المورّد، ومن حساب التكلفة الحقيقية إلى تحسين الإدراج، تعمل كل الأدوات في اللوحة نفسها، ويعود كل ناتج كخطر وإجراء وافتراضات.",
    },
  "AI araç": {
    en: "AI tools",
    es: "Herramientas de IA",
    de: "KI-Werkzeuge",
    fr: "Outils IA",
    ar: "أدوات ذكاء اصطناعي",
  },
  "araç modülü": {
    en: "tool modules",
    es: "módulos de herramientas",
    de: "Werkzeugmodule",
    fr: "modules d'outils",
    ar: "وحدات أدوات",
  },
  "Araç modülleri": {
    en: "Tool modules",
    es: "Módulos de herramientas",
    de: "Werkzeugmodule",
    fr: "Modules d'outils",
    ar: "وحدات الأدوات",
  },
  "Her modül kendi ekranında çalışır ve girdilerini tek yerde toplar. Ücretsiz plan Ürün Bulucu'yu kapsar; Starter, Pro ve Business paketlerinde tüm araç modülleri açılır.":
    {
      en: "Each module runs on its own screen and gathers its inputs in one place. The free plan covers Product Finder; every tool module opens on Starter, Pro and Business plans.",
      es: "Cada módulo funciona en su propia pantalla y reúne sus datos en un lugar. El plan gratuito cubre el Buscador de productos; todos los módulos de herramientas se abren en los planes Starter, Pro y Business.",
      de: "Jedes Modul läuft auf einem eigenen Bildschirm und sammelt seine Eingaben an einer Stelle. Der kostenlose Plan umfasst den Produktfinder; in den Paketen Starter, Pro und Business sind alle Werkzeugmodule offen.",
      fr: "Chaque module dispose de son propre écran et regroupe ses saisies au même endroit. Le forfait gratuit couvre le Chercheur de produits ; tous les modules d'outils sont ouverts avec les forfaits Starter, Pro et Business.",
      ar: "تعمل كل وحدة على شاشتها وتجمع مدخلاتها في مكان واحد. تغطي الخطة المجانية مكتشف المنتجات، وتُفتح جميع وحدات الأدوات في خطط Starter وPro وBusiness.",
    },
  "Modülü aç": {
    en: "Open module",
    es: "Abrir módulo",
    de: "Modul öffnen",
    fr: "Ouvrir le module",
    ar: "افتح الوحدة",
  },
  "Ücretli paketlerde tüm araçlar açık": {
    en: "Every tool is open on paid plans",
    es: "Todas las herramientas están abiertas en los planes de pago",
    de: "In den bezahlten Paketen sind alle Werkzeuge offen",
    fr: "Tous les outils sont ouverts avec les forfaits payants",
    ar: "جميع الأدوات مفتوحة في الخطط المدفوعة",
  },
  "Starter, Pro ve Business arasındaki fark modül erişimi değil, aylık kullanım kotasıdır: hangi ücretli paketi seçersen tüm araç modülleri açık olur. Ücretsiz plan Ürün Bulucu ve hoş geldin kredisiyle başlar.":
    {
      en: "The difference between Starter, Pro and Business is not module access but the monthly usage quota: whichever paid plan you pick, every tool module is open. The free plan starts with Product Finder and a welcome credit.",
      es: "La diferencia entre Starter, Pro y Business no es el acceso a módulos, sino la cuota de uso mensual: elijas el plan de pago que elijas, todos los módulos están abiertos. El plan gratuito empieza con el Buscador de productos y un crédito de bienvenida.",
      de: "Der Unterschied zwischen Starter, Pro und Business ist nicht der Modulzugang, sondern das monatliche Nutzungskontingent: egal welches bezahlte Paket du wählst, alle Werkzeugmodule sind offen. Der kostenlose Plan startet mit Produktfinder und einem Willkommens-Credit.",
      fr: "La différence entre Starter, Pro et Business n'est pas l'accès aux modules mais le quota d'usage mensuel : quel que soit le forfait payant choisi, tous les modules sont ouverts. Le forfait gratuit démarre avec le Chercheur de produits et un crédit de bienvenue.",
      ar: "الفرق بين Starter وPro وBusiness ليس في الوصول إلى الوحدات بل في حصة الاستخدام الشهرية: أي خطة مدفوعة تختارها تُفتح كل وحدات الأدوات. تبدأ الخطة المجانية بمكتشف المنتجات ورصيد ترحيبي.",
    },
  "Paketleri karşılaştır": {
    en: "Compare plans",
    es: "Comparar planes",
    de: "Pakete vergleichen",
    fr: "Comparer les forfaits",
    ar: "قارن الخطط",
  },
  "Araç çıktıları karar desteklidir; kesin satış veya kâr garantisi vermez.": {
    en: "Tool output is decision support; it guarantees no sales or profit.",
    es: "Los resultados de las herramientas son apoyo a la decisión; no garantizan ventas ni beneficios.",
    de: "Werkzeugergebnisse sind Entscheidungshilfen; sie garantieren weder Umsatz noch Gewinn.",
    fr: "Les résultats des outils sont une aide à la décision ; ils ne garantissent ni ventes ni bénéfices.",
    ar: "مخرجات الأدوات دعم للقرار؛ وهي لا تضمن مبيعات أو أرباحًا.",
  },

  /* ---------------- Araç kataloğu (tools-catalog.ts) ---------------- */
  "Sourcing & Factory Hub": {
    en: "Sourcing & Factory Hub",
    es: "Centro de abastecimiento y fábrica",
    de: "Sourcing- und Fabrik-Hub",
    fr: "Hub sourcing et usine",
    ar: "مركز التوريد والمصنع",
  },
  "Fabrika pazarlığından tedarikçi doğrulamaya kadar sourcing sürecini tek akışta yönet.": {
    en: "Manage the whole sourcing flow in one stream, from factory negotiation to supplier verification.",
    es: "Gestiona todo el proceso de abastecimiento en un solo flujo, de la negociación en fábrica a la verificación del proveedor.",
    de: "Steuere den gesamten Sourcing-Ablauf in einem Fluss — von der Fabrikverhandlung bis zur Lieferantenprüfung.",
    fr: "Pilotez tout le sourcing en un seul flux, de la négociation en usine à la vérification du fournisseur.",
    ar: "أدر مسار التوريد كاملًا في تدفق واحد، من التفاوض مع المصنع إلى التحقق من المورّد.",
  },
  "Financial & Cost Engine": {
    en: "Financial & Cost Engine",
    es: "Motor financiero y de costes",
    de: "Finanz- und Kosten-Engine",
    fr: "Moteur financier et de coûts",
    ar: "محرك التمويل والتكاليف",
  },
  "Depoziti göndermeden gerçek maliyeti, gereken sermayeyi ve ödeme riskini hesapla.": {
    en: "Work out the true cost, the capital you need and the payment risk before you send the deposit.",
    es: "Calcula el coste real, el capital necesario y el riesgo de pago antes de enviar el depósito.",
    de: "Berechne echte Kosten, benötigtes Kapital und Zahlungsrisiko, bevor du die Anzahlung sendest.",
    fr: "Calculez le coût réel, le capital nécessaire et le risque de paiement avant d'envoyer l'acompte.",
    ar: "احسب التكلفة الحقيقية ورأس المال المطلوب ومخاطر الدفع قبل إرسال الدفعة المقدمة.",
  },
  "Growth & Market AI": {
    en: "Growth & Market AI",
    es: "IA de crecimiento y mercado",
    de: "Wachstums- und Markt-KI",
    fr: "IA croissance et marché",
    ar: "ذكاء النمو والسوق",
  },
  "Ürünü altı AI motoruyla puanla, 90 günlük plana bağla, sepeti büyüt, stok tarihini kaçırma, rakip reklamını çöz.":
    {
      en: "Score the product with six AI engines, turn it into a 90-day plan, grow the basket, keep track of stock dates and decode competitor ads.",
      es: "Puntúa el producto con seis motores de IA, conviértelo en un plan de 90 días, amplía el carrito, no pierdas las fechas de stock y descifra la publicidad rival.",
      de: "Bewerte das Produkt mit sechs KI-Motoren, mache daraus einen 90-Tage-Plan, vergrößere den Warenkorb, verpasse keine Bestelltermine und entschlüssele Konkurrenzwerbung.",
      fr: "Notez le produit avec six moteurs d'IA, transformez-le en plan de 90 jours, augmentez le panier, ne manquez aucune date de stock et décryptez la publicité concurrente.",
      ar: "قيّم المنتج بستة محركات ذكاء اصطناعي، وحوّله إلى خطة 90 يومًا، وكبّر السلة، ولا تفوّت مواعيد المخزون، وفكّك إعلانات المنافسين.",
    },
  "Listing & Conversion Studio": {
    en: "Listing & Conversion Studio",
    es: "Estudio de listing y conversión",
    de: "Listing- und Conversion-Studio",
    fr: "Studio listing et conversion",
    ar: "استوديو الإدراج والتحويل",
  },
  "Trafiği satışa çeviren katman: arama görünürlüğü, görsel brief, yorum sinyali ve fiyat stratejisi.":
    {
      en: "The layer that turns traffic into sales: search visibility, visual brief, review signals and pricing strategy.",
      es: "La capa que convierte el tráfico en ventas: visibilidad en búsqueda, brief visual, señales de reseñas y estrategia de precio.",
      de: "Die Ebene, die Traffic in Verkäufe verwandelt: Sichtbarkeit in der Suche, visuelles Briefing, Rezensionssignale und Preisstrategie.",
      fr: "La couche qui transforme le trafic en ventes : visibilité en recherche, brief visuel, signaux d'avis et stratégie de prix.",
      ar: "الطبقة التي تحوّل الزيارات إلى مبيعات: الظهور في البحث، والموجز البصري، وإشارات المراجعات، واستراتيجية السعر.",
    },
  "E-Com News Explainer": {
    en: "E-Com News Explainer",
    es: "Explicador de noticias e-commerce",
    de: "E-Com-News-Erklärer",
    fr: "Décryptage des actus e-commerce",
    ar: "شارح أخبار التجارة الإلكترونية",
  },
  "Sektör haberini ürün ve fiyat kararına bağlayan açıklayıcı katman.": {
    en: "The explainer layer that links industry news to product and pricing decisions.",
    es: "La capa explicativa que conecta las noticias del sector con las decisiones de producto y precio.",
    de: "Die Erklär-Ebene, die Branchennews mit Produkt- und Preisentscheidungen verbindet.",
    fr: "La couche explicative qui relie l'actualité du secteur aux décisions produit et prix.",
    ar: "طبقة الشرح التي تربط أخبار القطاع بقرارات المنتج والسعر.",
  },
  "AI Supplier Negotiator": {
    en: "AI Supplier Negotiator",
    es: "Negociador de proveedores con IA",
    de: "KI-Lieferantenverhandler",
    fr: "Négociateur fournisseur IA",
    ar: "مفاوض المورّدين بالذكاء الاصطناعي",
  },
  "Supplier Offer Analyzer": {
    en: "Supplier Offer Analyzer",
    es: "Analizador de ofertas de proveedores",
    de: "Lieferangebot-Analysator",
    fr: "Analyseur d'offres fournisseurs",
    ar: "محلّل عروض المورّدين",
  },
  "Supplier Legitimacy Detector": {
    en: "Supplier Legitimacy Detector",
    es: "Detector de legitimidad de proveedores",
    de: "Lieferanten-Legitimitätsprüfer",
    fr: "Détecteur de légitimité fournisseur",
    ar: "كاشف مصداقية المورّد",
  },
  "Review ➔ Spec Sheet": {
    en: "Review ➔ Spec Sheet",
    es: "Reseñas ➔ Ficha técnica",
    de: "Rezensionen ➔ Spec-Blatt",
    fr: "Avis ➔ Fiche technique",
    ar: "المراجعات ➔ ورقة المواصفات",
  },
  "Pazaryeri Uyum & Gating Denetçisi": {
    en: "Marketplace Compliance & Gating Auditor",
    es: "Auditor de cumplimiento y gating en marketplaces",
    de: "Marktplatz-Compliance- und Gating-Prüfer",
    fr: "Auditeur conformité et gating marketplaces",
    ar: "مدقّق الامتثال والبوابات في الأسواق",
  },
  "Reverse Cost Engineer": {
    en: "Reverse Cost Engineer",
    es: "Ingeniería inversa de costes",
    de: "Reverse-Cost-Engineer",
    fr: "Ingénierie inverse des coûts",
    ar: "هندسة التكلفة العكسية",
  },
  "Landed Cost Calculator": {
    en: "Landed Cost Calculator",
    es: "Calculadora de coste final",
    de: "Landed-Cost-Rechner",
    fr: "Calculateur de coût rendu",
    ar: "حاسبة التكلفة النهائية",
  },
  "Minimum Capital Planner": {
    en: "Minimum Capital Planner",
    es: "Planificador de capital mínimo",
    de: "Mindestkapital-Planer",
    fr: "Planificateur de capital minimal",
    ar: "مخطّط رأس المال الأدنى",
  },
  "Packaging & Desi Optimizer": {
    en: "Packaging & Desi Optimizer",
    es: "Optimizador de embalaje y desi",
    de: "Verpackungs- und Desi-Optimierer",
    fr: "Optimiseur d'emballage et desi",
    ar: "محسّن التغليف والوزن الحجمي",
  },
  "Supplier Milestone Shield": {
    en: "Supplier Milestone Shield",
    es: "Escudo de hitos del proveedor",
    de: "Lieferanten-Meilenstein-Schutz",
    fr: "Bouclier des jalons fournisseur",
    ar: "درع مراحل المورّد",
  },
  "HS Kodu & Gümrük Vergisi": {
    en: "HS Code & Customs Duty",
    es: "Código HS y aranceles",
    de: "HS-Code & Zolltarif",
    fr: "Code SH et droits de douane",
    ar: "رمز HS والرسوم الجمركية",
  },
  "Multi-AI Consensus Score": {
    en: "Multi-AI Consensus Score",
    es: "Puntuación de consenso multi-IA",
    de: "Multi-KI-Konsens-Score",
    fr: "Score de consensus multi-IA",
    ar: "تقييم الإجماع متعدد النماذج",
  },
  "Bundle & AOV Booster": {
    en: "Bundle & AOV Booster",
    es: "Impulsor de packs y ticket medio",
    de: "Bundle- und AOV-Booster",
    fr: "Booster de packs et panier moyen",
    ar: "معزّز الحزم ومتوسط السلة",
  },
  "Lead-Time Countdown": {
    en: "Lead-Time Countdown",
    es: "Cuenta atrás del plazo de entrega",
    de: "Lieferzeit-Countdown",
    fr: "Compte à rebours du délai",
    ar: "عدّاد مدة التوريد",
  },
  "Arbitrage Matrix": {
    en: "Arbitrage Matrix",
    es: "Matriz de arbitraje",
    de: "Arbitrage-Matrix",
    fr: "Matrice d'arbitrage",
    ar: "مصفوفة المراجحة",
  },
  "Competitor Ad Hook Extractor": {
    en: "Competitor Ad Hook Extractor",
    es: "Extractor de ganchos publicitarios",
    de: "Wettbewerbs-Ad-Hook-Extraktor",
    fr: "Extracteur d'accroches publicitaires",
    ar: "مستخرج خطّافات إعلانات المنافسين",
  },
  "Rakip İlan İstihbaratı": {
    en: "Competitor Listing Intelligence",
    es: "Inteligencia de anuncios de la competencia",
    de: "Wettbewerbs-Listing-Intelligence",
    fr: "Veille sur les annonces concurrentes",
    ar: "استخبارات إعلانات المنافسين",
  },
  "90 Günlük Büyüme Planı": {
    en: "90-Day Growth Plan",
    es: "Plan de crecimiento de 90 días",
    de: "90-Tage-Wachstumsplan",
    fr: "Plan de croissance sur 90 jours",
    ar: "خطة نمو لمدة 90 يومًا",
  },
  "Listing SEO Optimizer": {
    en: "Listing SEO Optimizer",
    es: "Optimizador SEO del listing",
    de: "Listing-SEO-Optimierer",
    fr: "Optimiseur SEO de listing",
    ar: "محسّن SEO للإدراج",
  },
  "Görsel & A+ İçerik Brief": {
    en: "Visual & A+ Content Brief",
    es: "Brief visual y de contenido A+",
    de: "Visual- & A+-Content-Brief",
    fr: "Brief visuel et contenu A+",
    ar: "موجز المحتوى المرئي وA+",
  },
  "Yorum Sentiment Radarı": {
    en: "Review Sentiment Radar",
    es: "Radar de sentimiento de reseñas",
    de: "Rezensions-Stimmungsradar",
    fr: "Radar de sentiment des avis",
    ar: "رادار مشاعر المراجعات",
  },
  "Fiyat & Buy Box Stratejisi": {
    en: "Price & Buy Box Strategy",
    es: "Estrategia de precio y Buy Box",
    de: "Preis- und Buy-Box-Strategie",
    fr: "Stratégie prix et Buy Box",
    ar: "استراتيجية السعر وBuy Box",
  },
  "News & AI Explainer": {
    en: "News & AI Explainer",
    es: "Noticias y explicador de IA",
    de: "News & KI-Erklärer",
    fr: "Actus et décryptage IA",
    ar: "الأخبار وشارح الذكاء الاصطناعي",
  },
};
