import {
  configuredDirectModelProviders,
  evrenStatus,
  geminiEnvKeys,
  jinaKeyCount,
  openRouterEnvKeys,
} from "./ai-keys.server";
import { ebayCredentialsConfigured as ebayConfigured } from "./ebay-auth.server";
// ============================================================================
// PRODUCT DISCOVERY — HAT ÖNCE KONTROLÜ (PREFLIGHT).
//
// BU DOSYANIN VAROLMA SEBEBİ (ölçülen olgu): ürün arama ekranı yeni hattı
// dener, başlatılamazsa **sessizce** klasik hatta düşüyordu. Kullanıcı eline
// "5 ürün" geçiyor, ekranda hiçbir uyarı yok, oysa gerçekte hat hiç çalışmadı.
// Bu, bu kod tabanında en pahalı hata türüdür: sessizce kaybolan bir adım,
// "kanıt topladık" diye yalan söylemektir.
//
// TEŞHİS NEDEN GEREKLİ: hatın çalışması ÜÇ bağımsız koşula bağlı ve üçü de
// ortamdan/veritabanından gelir:
//   1. `QSTASH_TOKEN`                    → adımı kuyruğa almayı sağlar.
//   2. `QSTASH_CURRENT_SIGNING_KEY`      → QStash'in imzasını DOĞRULAR
//      (yoksa üretimde fail-closed 503 döner; hat her adımda ölür).
//   3. `SUPABASE_SERVICE_ROLE_KEY` + migration → kalıcı iş kaydı ve atomik
//      durum geçişi. Migration uygulanmamışsa `searches` tablosunda
//      `discovery_status` kolonu yoktur ve `createDiscoveryJob` PATLAR —
//      kredi düşülür, iade edilir, kullanıcı klasik hatta düşer, sebep GÖRÜNMEZ.
//
// GÜVENLİK: Bu modül HİÇBİR sırrı döndürmez. Yalnız anahtarın VAR/YOK
// durumu ve hata MESAJI (Supabase hata metni sır içermez; anahtar değeri içermez).
// `fix` alanı kullanıcıya/panele gösterilebilir düz metindir.
// ============================================================================

/** Sır içermeyen tek kontrol satırı. */
export type PreflightCheck = {
  /** Makine tarafından okunur, testlerde sabitlenir. */
  id: string;
  /** Kullanıcıya gösterilen başlık. */
  label: string;
  ok: boolean;
  /** Eksikse neden eksik olduğu (tek cümle). */
  detail: string;
  /** Eksikse YAPILACAK İŞ (tek cümle). */
  fix: string;
  /**
   * Zorunlu DEĞİL: eksikse hat yine de çalışır, yalnız model seçimi
   * deterministik sıralamaya düşer. Toplam "hazır" kararına girmez.
   */
  optional?: boolean;
};

export type DiscoveryPreflight = {
  /** Zorunlu kontrollerin tamamı geçtiyse `true`. */
  ok: boolean;
  checks: PreflightCheck[];
  /** Tek satırlık dürüst özet. */
  summary: string;
};

/** Test edilebilirlik için daraltılmış ortam tipi. */
export type PreflightEnv = Record<string, string | undefined>;

/** Boş dize "tanımlı ama işe yaramaz" sayılır. */
const set = (env: PreflightEnv, key: string): boolean => Boolean((env[key] ?? "").trim());

/**
 * Ortam değişkenlerini denetler — SAF, ağ çağrısı yok.
 *
 * Ayrı `optional` işareti şu yüzden var: `GEMINI_API_KEY` yoksa hat düşmez,
 * yalnız 75→25 seçimi model yerine deterministik sıralamayla yapılır. Bunu
 * "eksik" diye göstermek, kullanıcıya olmayan bir arıza varmış gibi
 * yalan söylemek olurdu.
 */
export function envChecks(env: PreflightEnv = process.env): PreflightCheck[] {
  // Yalnız sağlayıcı İSMİ döner; anahtar değeri ASLA okunmaz.
  const directProviders = configuredDirectModelProviders(env);
  const evren = evrenStatus(env);
  /** Kaç okuma anahtarı var (yalnız SAYI; anahtar değeri asla okunmaz/yazılmaz). */
  const jinaKeys = jinaKeyCount(env);
  return [
    {
      id: "qstash_token",
      label: "QStash yayın jetonu",
      ok: set(env, "QSTASH_TOKEN"),
      detail: set(env, "QSTASH_TOKEN") ? "tanımlı" : "QSTASH_TOKEN yok; adımlar kuyruğa alınamaz.",
      fix: "Settings → Environment → QSTASH_TOKEN (Upstash QStash → Token)",
    },
    {
      id: "qstash_signing_key",
      label: "QStash imza anahtarı",
      ok: set(env, "QSTASH_CURRENT_SIGNING_KEY"),
      detail: set(env, "QSTASH_CURRENT_SIGNING_KEY")
        ? "tanımlı — imza doğrulanabilir"
        : "QSTASH_CURRENT_SIGNING_KEY yok; üretimde adım ucu 503 döner (fail-closed).",
      fix: "Settings → Environment → QSTASH_CURRENT_SIGNING_KEY ve QSTASH_NEXT_SIGNING_KEY",
    },
    {
      id: "supabase_url",
      label: "Supabase adresi",
      ok: set(env, "SUPABASE_URL"),
      detail: set(env, "SUPABASE_URL") ? "tanımlı" : "SUPABASE_URL yok.",
      fix: "Settings → Environment → SUPABASE_URL",
    },
    {
      id: "supabase_service_role",
      label: "Supabase servis rolü",
      ok: set(env, "SUPABASE_SERVICE_ROLE_KEY"),
      detail: set(env, "SUPABASE_SERVICE_ROLE_KEY")
        ? "tanımlı"
        : "SUPABASE_SERVICE_ROLE_KEY yok; kalıcı iş kaydı açılamaz ve hat kendini kuyruğa alamaz.",
      fix: "Supabase → Project Settings → API → service_role anahtarını SUPABASE_SERVICE_ROLE_KEY olarak ekle",
    },
    {
      id: "gemini",
      label: "Gemini seçici (isteğe bağlı)",
      // SAYIYLA: yalnız `GEMINI_API_KEY` aramak, havuz kurulumu
      // (`GEMINI_API_KEY_1..8` — README'de önerilen biçim) tanımlıyken "Yok"
      // demek oluyordu. Panelin tek işi doğru söylemek: tarayıcı ortak.
      ok: geminiEnvKeys(env).length > 0,
      optional: true,
      detail: geminiEnvKeys(env).length
        ? `tanımlı — ${geminiEnvKeys(env).length} Gemini anahtarı havuza girdi; 75→25 seçimi modele gider`
        : "Yok: 75→25 seçimi deterministik ön skorlamayla yapılır, hat yine de çalışır.",
      fix: "İsteğe bağlı — GEMINI_API_KEY (veya GEMINI_API_KEY_1..8) eklenirse seçimi Gemini yapar.",
    },
    {
      id: "serpapi",
      label: "SerpAPI / SearchAPI / Serper ürün kaynağı (isteğe bağlı)",
      ok:
        set(env, "SERPAPI_KEY") ||
        set(env, "SERP_API_KEY") ||
        set(env, "SEARCHAPI_KEY") ||
        set(env, "SEARCHAPI_API_KEY") ||
        set(env, "SERPER_API_KEY") ||
        set(env, "SERPER_KEY"),
      optional: true,
      detail:
        set(env, "SERPAPI_KEY") ||
        set(env, "SERP_API_KEY") ||
        set(env, "SEARCHAPI_KEY") ||
        set(env, "SEARCHAPI_API_KEY") ||
        set(env, "SERPER_API_KEY") ||
        set(env, "SERPER_KEY")
          ? "tanımlı — Google Shopping üzerinden gerçek mağaza fiyatı, puan ve ürün görseli aranır"
          : "Yok: gerçek fiyatlı ürün araması bu kaynağı atlar, kalan kaynaklarla hat yine çalışır.",
      fix: "İsteğe bağlı — serpapi.com (SERPAPI_KEY), searchapi.io (SEARCHAPI_KEY) veya serper.dev (SERPER_API_KEY) ücretsiz anahtarı ekle.",
    },
    {
      id: "scraperapi",
      label: "ScraperAPI pazaryeri kaynağı (isteğe bağlı)",
      ok: set(env, "SCRAPERAPI_KEY") || set(env, "SCRAPI_KEY") || set(env, "SCRAP_API_KEY"),
      optional: true,
      detail:
        set(env, "SCRAPERAPI_KEY") || set(env, "SCRAPI_KEY") || set(env, "SCRAP_API_KEY")
          ? "tanımlı — hedef ülkenin yerel pazaryerleri kazınır"
          : "Yok: yerel pazaryeri kazıması atlanır, kalan kaynaklarla hat yine çalışır.",
      fix: "İsteğe bağlı — scraperapi.com'da ücretsiz hesap açıp SCRAPERAPI_KEY ekle.",
    },
    {
      id: "jina_reader",
      label: "Ürün okuyucu anahtarı (Jina Reader)",
      ok: jinaKeys > 0,
      optional: true,
      detail:
        jinaKeys > 0
          ? `tanımlı — ${jinaKeys} anahtar yük paylaşır (≈${jinaKeys * 10}M token kota, arama başına ~75K token).`
          : "Yok: okumalar anahtarsız ücretsiz katmanda koşar (~20 istek/dk); kota dolunca 429 gelir ve o sayfanın ürün satırları havuzdan düşer.",
      fix:
        "Önerilir — jina.ai'de ücretsiz hesap aç, anahtarları JINA_API_KEY_1 ve JINA_API_KEY_2 olarak ekle " +
        "(her anahtar 10M token). Birden fazla anahtar arasında yük paylaşılır ve kota dolan anahtar soğumaya alınır.",
    },
    {
      id: "reader_fallback",
      label: "Yedek okuma sağlayıcısı (Firecrawl / ScrapingBee, isteğe bağlı)",
      // YALNIZ GERÇEKTEN BAĞLI OLAN SAĞLAYICILAR sayılır. `TAVILY_API_KEY`,
      // `EXA_API_KEY`, `SPIDER_API_KEY` ve `CRAWL4AI_URL` bu repoda okuma yoluna
      // BAĞLI DEĞİL (Tavily ayrı bir ürün kaynağıdır; diğer üçü hiçbir yerde
      // okunmuyor). Burada saymak, kullanıcıya olmayan bir yedeği varmış gibi
      // göstermek olurdu — panelin tek işi bunu engellemek.
      ok:
        set(env, "FIRECRAWL_API_KEY") ||
        set(env, "FIRECRAWL_KEY") ||
        set(env, "SCRAPINGBEE_API_KEY") ||
        set(env, "SCRAPING_BEE_API_KEY"),
      optional: true,
      detail:
        set(env, "FIRECRAWL_API_KEY") ||
        set(env, "FIRECRAWL_KEY") ||
        set(env, "SCRAPINGBEE_API_KEY") ||
        set(env, "SCRAPING_BEE_API_KEY")
          ? "tanımlı — Jina bir sayfayı veremediğinde (kota/engel) ürün satırı yedek okuyucudan gelir"
          : "Yok: Jina engellediğinde anahtarsız r.markdown.new/defuddle.md devreye girer (hat yine çalışır).",
      fix: "İsteğe bağlı — firecrawl.dev (FIRECRAWL_API_KEY) veya scrapingbee.com (SCRAPINGBEE_API_KEY).",
    },
    {
      id: "tavily_source",
      label: "Tavily web ürün kaynağı (isteğe bağlı)",
      ok: set(env, "TAVILY_API_KEY") || set(env, "TAVILY_KEY"),
      optional: true,
      detail:
        set(env, "TAVILY_API_KEY") || set(env, "TAVILY_KEY")
          ? "tanımlı — web'de yayınlanmış fiyat/puan satırları `tavily-search` kaynağından gelir (okuyucu yedeği DEĞİL)"
          : "Yok: `tavily-search` kaynağı atlanır; Jina'nın yedek okuyucusu Firecrawl/ScrapingBee'dir.",
      fix: "İsteğe bağlı — tavily.com ücretsiz anahtarını TAVILY_API_KEY olarak ekle.",
    },
    {
      id: "brave_web",
      label: "Brave web araması — `web-reviews`ün ilk motoru (isteğe bağlı)",
      // Brave AYRI bir paralel kaynak DEĞİL: var olan `web-reviews` kaynağının
      // ilk motoru. Bu yüzden burada "ürün satırı ikiye katlanır" demek yanlış
      // olur; doğru cümle: kırılgan Bing/DDG kazıması yerine resmî API +
      // ülke/dil hedeflemesi. Detay metni bunu olduğu gibi yazar.
      ok: set(env, "BRAVE_API_KEY") || set(env, "BRAVE_SEARCH_API_KEY") || set(env, "BRAVE_KEY"),
      optional: true,
      detail:
        set(env, "BRAVE_API_KEY") || set(env, "BRAVE_SEARCH_API_KEY") || set(env, "BRAVE_KEY")
          ? "tanımlı — `web-reviews` önce Brave'i sorar: ülke/dil hedefli sonuç, 24 saat önbellek, aylık ~900 sorgu bütçesi; Bing/DDG yedek kalır"
          : "Yok: `web-reviews` anahtarsız Bing → DuckDuckGo HTML'ini okur (DDG ardışık isteklerde 202 bot-guard dönebiliyor).",
      fix: "İsteğe bağlı — api.search.brave.com'dan anahtar al, BRAVE_API_KEY olarak ekle ($5/1.000 istek, ayda $5 ücretsiz kredi ≈ 1.000 sorgu).",
    },
    {
      id: "bestbuy",
      label: "Best Buy / eBay katalog API'si (isteğe bağlı)",
      // eBay artık `client_credentials` akışını KENDİSİ çalıştırıyor
      // (`ebay-auth.server.ts`): `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET` verildiğinde
      // jeton alınır ve ~2 saatte bir yenilenir. Elle kopyalanan Bearer jetonu
      // (`EBAY_OAUTH_TOKEN`) hâlâ geçerli bir kısa yol olarak kabul edilir.
      ok: ebayConfigured(env) || set(env, "BESTBUY_API_KEY") || set(env, "BEST_BUY_API_KEY"),
      optional: true,
      detail: ebayConfigured(env)
        ? "tanımlı — eBay Browse'tan gerçek fiyat + satıcı + ürün görseli okunur (jeton otomatik yenilenir)" +
          (set(env, "BESTBUY_API_KEY") || set(env, "BEST_BUY_API_KEY")
            ? " · Best Buy da tanımlı"
            : "")
        : set(env, "BESTBUY_API_KEY") || set(env, "BEST_BUY_API_KEY")
          ? "tanımlı — Best Buy kataloğundan gerçek fiyat + kullanıcı puanı + GTIN/MPN + ürün görseli ekler"
          : "Yok: ABD/küresel nişler yalnız okuyucularla ve anahtarsız kataloglarla beslenir.",
      fix:
        "İsteğe bağlı — developer.ebay.com'da uygulama oluşturup Client ID + Client Secret'ı " +
        "EBAY_CLIENT_ID / EBAY_CLIENT_SECRET olarak ekle (jeton kendiliğinden alınır). " +
        "Alternatif: developer.bestbuy.com → BESTBUY_API_KEY.",
    },
    {
      id: "cj_supplier",
      label: "CJ Dropshipping tedarik API'si (isteğe bağlı)",
      // CJ API 2.0 `CJ-Access-Token` ister; panel API Key'i ile
      // `/authentication/getAccessToken` çağrılıp jeton alınır (`resolveCjAccessToken`).
      // Anahtar yoksa kaynak 0 ms'de boş döner; MOQ/depo/fiyat bandı yuvası boş kalır.
      ok:
        set(env, "CJ_API_KEY") || set(env, "CJDROPSHIPPING_API_KEY") || set(env, "CJ_ACCESS_TOKEN"),
      optional: true,
      detail:
        set(env, "CJ_API_KEY") || set(env, "CJDROPSHIPPING_API_KEY")
          ? "tanımlı — CJ'den MOQ, depo ülkesi ve birim fiyat bandı okunur (günde ~1.000 arama, 50.000 puan)"
          : set(env, "CJ_ACCESS_TOKEN")
            ? "tanımlı — hazır access token kullanılıyor (süresi dolduğunda API Key ile değiştir)"
            : "Yok: tedarik tarafı AliExpress + Made-in-China ile çalışır; CJ'nin MOQ/depo kanıtı eklenmez.",
      fix: "İsteğe bağlı — cjdropshipping.com → Settings → API'den API Key al, CJ_API_KEY olarak ekle (jeton otomatik alınır).",
    },
    {
      id: "google_trends_keyed",
      label: "Google Trends anahtarlı yedek (isteğe bağlı)",
      // Anahtarsız Trends ucu datacenter IP'lerinde kalıcı 429 döndüğü için
      // (bu repoda ölçüldü) aynı seriyi SearchAPI/SerpAPI'den okuyan yedek yol.
      ok:
        set(env, "SEARCHAPI_KEY") ||
        set(env, "SEARCHAPI_API_KEY") ||
        set(env, "SERPAPI_KEY") ||
        set(env, "SERP_API_KEY"),
      optional: true,
      detail:
        set(env, "SEARCHAPI_KEY") ||
        set(env, "SEARCHAPI_API_KEY") ||
        set(env, "SERPAPI_KEY") ||
        set(env, "SERP_API_KEY")
          ? "tanımlı — anahtarsız Trends 429 verdiğinde gerçek aylık seri buradan okunur"
          : "Yok: niş momentumu anahtarsız Trends'e ve Wikipedia görüntülenmesine bağlı kalır.",
      fix: "İsteğe bağlı — SEARCHAPI_KEY veya SERPAPI_KEY ekle; jeton yoksa anahtarsız yol kullanılır.",
    },
    {
      id: "github_token",
      label: "GitHub API jetonu (isteğe bağlı)",
      // Resmî GitHub ARAMA kotası: kimliksiz 10 istek/dk, kimlikli 30 istek/dk
      // (docs.github.com/rest/search). Ürün bulucu bir koşuda birkaç niş ×
      // varyant aradığı için kimliksiz koşuda 403 ile satır kaybediliyordu.
      // NOT: 5.000 istek/saat genel REST kotasıdır, ARAMA uçları için geçerli
      // değildir — panelde o sayıyı yazmak yanlış bir vaat olurdu.
      ok: set(env, "GITHUB_API_TOKEN") || set(env, "GH_API_TOKEN") || set(env, "GITHUB_PAT"),
      optional: true,
      detail:
        set(env, "GITHUB_API_TOKEN") || set(env, "GH_API_TOKEN") || set(env, "GITHUB_PAT")
          ? "tanımlı — GitHub repo kanıtı kimlikli arama kotasıyla (30 istek/dk) okunur"
          : "Yok: GitHub repo kanıtı kimliksiz arama kotasında (10 istek/dk) okunur; yoğun koşuda 403 olabilir.",
      fix: "İsteğe bağlı — github.com/settings/tokens adresinden salt-okunur (public_repo) jeton üret, GITHUB_API_TOKEN olarak ekle. Git kimliği için kullanılan GITHUB_TOKEN'dan AYRI tutulur.",
    },
    {
      id: "evren",
      label: "EVREN ulusal YZ platformu (isteğe bağlı)",
      ok: evren.ready,
      optional: true,
      detail: evren.ready
        ? `tanımlı — ${evren.keys} anahtar, model: ${evren.models.join(", ")}. ` +
          "1 Kasım 2026'ya kadar kredisiz; kotanın tükendiği anda yüksek kapasite sağlar."
        : "Yok: hat yine de Gemini/Groq/Cerebras/HF ile çalışır, yalnızca EVREN'in yüksek kapasitesi kullanılmaz.",
      fix:
        "İsteğe bağlı — evren.ssyz.org.tr (e-Devlet) → API anahtarı üret, EVREN_API_KEY olarak ekle. " +
        "Uç ve model otomatik gelir; sabit model istersen EVREN_MODEL (örn. glm-5.3) yaz.",
    },
    {
      id: "ai_models",
      label: "Gelişmiş model havuzu (isteğe bağlı)",
      // Numaralı OpenRouter adları (`OPENROUTER_API_KEY_1..8`) de geçerlidir.
      ok: openRouterEnvKeys(env).length > 0 || directProviders.length > 0 || evren.ready,
      optional: true,
      detail: directProviders.length
        ? `tanımlı — doğrudan sağlayıcı: ${directProviders
            .map((p) => `${p.label} → ${p.model}`)
            .join(", ")}` + (openRouterEnvKeys(env).length ? " · OpenRouter da tanımlı" : "")
        : openRouterEnvKeys(env).length
          ? `OpenRouter tanımlı — ${openRouterEnvKeys(env).length} anahtar (DeepSeek V4.1 Flash / GLM-5.3 / Qwen3.8 / MiMo-V2.6 / Gemma 4)`
          : "Yok: hat yalnız Gemini/Groq/Cerebras/HF ile çalışır — gelişmiş modeller kullanılmaz.",
      fix:
        "İsteğe bağlı — OpenRouter anahtarı ekle VEYA doğrudan sağlayıcı anahtarı " +
        "(örn. PROVIDER_A_1 + PROVIDER_A_BASE_URL) VEYA EVREN (EVREN_API_KEY + EVREN_BASE_URL + EVREN_MODEL). " +
        "Hazır uçlar `ai-keys.server.ts` içinde.",
    },
  ];
}

/**
 * Veritabanı yoklamasının ham sonucu (testte sahte verilir).
 *
 * `undefined` = YAPILAMADI (ör. servis rolü anahtarı yok). Bu bilinçli olarak
 * `null`'dan ayrıdır: `null` = "yoklandı ve temiz", `undefined` = "hiç
 * yoklanamadı". İkisi yeşil gösterilirse kullanıcı doğrulanmamış bir şeyi
 * doğrulanmış sanar — sessiz yalanın en ince hâli.
 */
export type SchemaProbe = {
  /** `searches` tablosundan tek satır okunabildi mi + kolonlar var mı. */
  columnsError?: string | null;
  /** `advance_discovery_status` RPC'si çağrılabiliyor mu. */
  rpcError?: string | null;
};

/** Yoklama yapıldı mı, yoksa yapılamadı mı? */
const NOT_CHECKED = "doğrulanamadı: SUPABASE_SERVICE_ROLE_KEY yok, veritabanına gidilmedi.";

/**
 * Supabase şemasını denetler.
 *
 * Neden İKİ yoklama: migration tek dosyada iki farklı şey ekliyordu — yeni
 * kolonlar (`discovery_status`, `discovery_progress`, …) ve üç RPC. Kullanıcı
 * ya hep uygulamış ya hiç uygulamamış olsa da AYRI ayrı sorgulamak, "tablo
 * yok" ile "RPC yok" ayrımını korur: ikisi farklı hatalar ve farklı düzeltmeler.
 *
 * `columnsError`/`rpcError` Supabase'in HATA METNİDİR; anahtar değeri içermez
 * ve kullanıcıya güvenle gösterilebilir.
 */
export function schemaChecks(probe: SchemaProbe): PreflightCheck[] {
  const columnCheck = (error: string | null | undefined): PreflightCheck => {
    if (error === undefined) {
      return {
        id: "db_columns",
        label: "searches keşif kolonları",
        ok: false,
        detail: NOT_CHECKED,
        fix: "Önce SUPABASE_SERVICE_ROLE_KEY ekle, sonra bu sayfayı yenile.",
      };
    }
    return {
      id: "db_columns",
      label: "searches keşif kolonları",
      ok: error === null,
      detail: error === null ? "ok" : `kolonlar okunamadı: ${error.slice(0, 160)}`,
      fix: "Supabase SQL Editor'da çalıştır: supabase/migrations/20260927000000_product_discovery_pipeline.sql",
    };
  };
  const rpcCheck = (error: string | null | undefined): PreflightCheck => {
    if (error === undefined) {
      return {
        id: "db_rpc",
        label: "Atomik durum RPC'si",
        ok: false,
        detail: NOT_CHECKED,
        fix: "Önce SUPABASE_SERVICE_ROLE_KEY ekle, sonra bu sayfayı yenile.",
      };
    }
    return {
      id: "db_rpc",
      label: "Atomik durum RPC'si",
      ok: error === null,
      detail:
        error === null
          ? "advance_discovery_status çağrılabiliyor"
          : `RPC çağrılamadı: ${error.slice(0, 160)}`,
      fix: "Aynı migration'ı uygula (advance_discovery_status / finish_discovery_job tanımları içinde)",
    };
  };
  return [columnCheck(probe.columnsError), rpcCheck(probe.rpcError)];
}

/**
 * Kontrol listesinden tek satırlık özet üretir.
 *
 * SIRA ÖNEMLİ: eksik anahtarlar önce, sonra şema. Kullanıcıya önce
 * "anahtarı koy" demek, veritabanı hatası göstermekten daha hızlı ilerletir.
 */
export function summarize(checks: readonly PreflightCheck[]): string {
  const missing = checks.filter((c) => !c.ok && !c.optional);
  const optionalMissing = checks.filter((c) => !c.ok && c.optional);
  if (!missing.length) {
    return optionalMissing.length
      ? `Hat çalışmaya hazır (${optionalMissing.length} isteğe bağlı eksik).`
      : "Hat çalışmaya hazır.";
  }
  return `${missing.length} zorunlu eksik: ${missing.map((c) => c.label).join(", ")}.`;
}

/** Tüm saf kontrolleri tek nesnede toplar (ağ yok). */
export function buildPreflight(
  env: PreflightEnv = process.env,
  probe: SchemaProbe,
): DiscoveryPreflight {
  const checks = [...envChecks(env), ...schemaChecks(probe)];
  return {
    ok: checks.every((c) => c.ok || c.optional),
    checks,
    summary: summarize(checks),
  };
}

/**
 * Canlı yoklama: ortam + gerçek Supabase erişimi.
 *
 * YANLIŞLIK YAPMADIR: `advance_discovery_status` bir UPDATE çalıştırır, bu
 * yüzden YANLIŞ bir kimlik (`_job_id` = tümü sıfır UUID) ve ETKİSİZ bir
 * geçiş (`queued` → `queued`) çağrılır: hiçbir satır eşleşmez, hiçbir şey
 * değişmez, hata dönebilir — döndüyse RPC yok demektir. Bu "yokla" bir
 * SELECT'ten daha güvenlidir çünkü SELECT bazı projelerde RLS'e takılıp
 * yanlış "yok" sinyali verirken bu çağrı servis rolüyle gider.
 */
export async function runDiscoveryPreflight(): Promise<DiscoveryPreflight> {
  const serviceRole = (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
  if (!serviceRole) {
    // Servis rolü yoksa veritabanına hiç gidilmez. Sonuç `undefined` alanlarla
    // kurulur → iki şema kontrolü de "doğrulanamadı" der. Hem yanlış "şema
    // eksik" izlenimi üretmemiş hem de yoklanmamışı yeşil göstermemiş oluruz.
    return buildPreflight(process.env, { columnsError: undefined, rpcError: undefined });
  }
  const { JOB_TABLE, jobStore } = await import("./discovery-jobs.server");
  const store = jobStore();
  const { error: columnsError } = await store
    .from(JOB_TABLE)
    .select("discovery_status, discovery_progress, charged_credits")
    .limit(1);
  const { error: rpcError } = await store.rpc("advance_discovery_status", {
    _job_id: "00000000-0000-0000-0000-000000000000",
    _from: "queued",
    _to: "queued",
    _progress: null,
  });
  return buildPreflight(process.env, {
    columnsError: columnsError?.message ?? null,
    rpcError: rpcError?.message ?? null,
  });
}
