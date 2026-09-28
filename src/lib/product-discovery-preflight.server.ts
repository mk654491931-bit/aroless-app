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
      ok: set(env, "GEMINI_API_KEY"),
      optional: true,
      detail: set(env, "GEMINI_API_KEY")
        ? "tanımlı — 75→25 seçimi modele gider"
        : "Yok: 75→25 seçimi deterministik ön skorlamayla yapılır, hat yine de çalışır.",
      fix: "İsteğe bağlı — GEMINI_API_KEY eklenirse seçimi Gemini yapar.",
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
