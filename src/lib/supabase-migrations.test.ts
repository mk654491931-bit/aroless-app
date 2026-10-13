/**
 * MIGRATION DOSYA ADI REGRESYON TESTİ.
 *
 * Supabase CLI, migration dosyasının adından version'ı `_` işaretinden önceki
 * parça olarak çıkarır ve onu `20060102150405` biçiminde ayrıştırır. Yani
 * `supabase_migrations.schema_migrations.version` = dosya adının ilk `_`'den
 * öncesi. Ad 14 haneli timestamp ile başlamıyorsa kayıt `db push` için geçersiz
 * olur: dosya "yeni migration" sayılır ve yeniden uygulanır.
 *
 * Yeniden uygulanmak çoğu dosyada zararsız görünse de `CREATE INDEX` /
 * `CREATE TRIGGER` gibi korumasız ifadelerde ortada patlatır, artık veri
 * bozan `DELETE`/`UPDATE` içeren dosyalarda ise kalıcı hasar verir. Bu test
 * yeni dosyaların bu tuzağa girmesini baştan engeller.
 *
 * TEK İSTİSNA: aşağıdaki dosya. Adı kasıtlı olarak bozuk bırakıldı ve
 * düzeltilmemesi gerekiyor — düzeltmek `db push`'u tetikleyip dosyayı yeniden
 * uygulatır, oysa dosyanın 5. bölümü sabit bir e-posta listesi dışındaki tüm
 * admin rollerini siler. Gerekçe dosyanın kendi başlığında yazılı.
 *
 * `$0` çalışır: yalnızca dosya adlarını okur, veritabanına dokunmaz.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMISSION_MAX_MONTHS } from "./affiliate";

/** Adı bilerek bozuk bırakılan, yeniden adlandırılmaması gereken dosya. */
const LEGACY_MALFORMED = "20260827_100000_harden_admin_and_security.sql";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

const filenames = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

/** CLI'nin okuduğu version: adın ilk `_`'den öncesi. */
function versionOf(filename: string): string {
  return filename.split("_")[0] ?? "";
}

function readMigration(filename: string): string {
  return readFileSync(new URL(`${filename}`, `file://${MIGRATIONS_DIR}`), "utf8");
}

describe("supabase/migrations dosya adlari", () => {
  it("en az bir migration dosyasi icerir", () => {
    expect(filenames.length).toBeGreaterThan(0);
    expect(filenames).toContain(LEGACY_MALFORMED);
  });

  it("her dosya 14 haneli timestamp ile baslar", () => {
    const malformed = filenames
      .filter((name) => name !== LEGACY_MALFORMED)
      .filter((name) => !/^\d{14}_.+\.sql$/.test(name));

    expect(malformed).toEqual([]);
  });

  it("version'lar birbirinden ayirt edilebilir", () => {
    const versions = filenames.map(versionOf);
    expect([...new Set(versions)].sort()).toEqual([...versions].sort());
  });

  it("bir version baska bir version'in onek olamaz", () => {
    // `20260827` aynı anda `20260827000000` ve `20260827120000` ile varsa CLI
    // hangisinin hangi dosyaya ait olduğunu ayırt edemez. İzin verilen çakışma
    // yalnızca belgelenmiş eski dosyanın ürettiği ikilidir.
    const versions = [...new Set(filenames.map(versionOf))].sort();
    const collisions: string[] = [];

    for (const shorter of versions) {
      for (const longer of versions) {
        if (shorter !== longer && longer.startsWith(shorter)) {
          collisions.push(`${shorter} → ${longer}`);
        }
      }
    }

    expect(collisions).toEqual(["20260827 → 20260827000000", "20260827 → 20260827120000"]);
  });
});

/**
 * Yeniden çalıştırılamayan migration'ın YARI UYGULANMIŞ bir veritabanı bırakır.
 *
 * Ölçülen canlı olay: `20260824013156_…` korumasız `CREATE POLICY` ile
 * başlıyordu; ikinci çalıştırmada "policy already exists" ile durup
 * `bump_rate_limit` fonksiyonunu hiç uygulamadı. Sonuç: tablo var, RPC yok ve
 * her istek "Could not find the function public.bump_rate_limit" hatası
 * veriyordu.
 *
 * Kural: bir politika oluşturan migration, oluşturmadan önce aynı politika
 * adını `DROP POLICY IF EXISTS` ile düşürmüş olmalı.
 */
describe("supabase/migrations yeniden calistirilabilirligi", () => {
  it("bump_rate_limit icin onarim migration'i var ve tamamen korumasiz", () => {
    const repair = filenames.find((name) => name.includes("rate_limit_rpc_repair"));
    expect(repair).toBeDefined();

    const sql = readMigration(repair!);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.api_rate_limits");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.bump_rate_limit");
    // Politika hemen önce düşürülmeli.
    expect(sql).toMatch(/DROP POLICY IF EXISTS[\s\S]*CREATE POLICY "admins_read_rate_limits"/);
    // Fonksiyon tanımından sonra yetki verilmeli.
    expect(sql.indexOf("CREATE OR REPLACE FUNCTION public.bump_rate_limit")).toBeLessThan(
      sql.indexOf("GRANT EXECUTE ON FUNCTION public.bump_rate_limit"),
    );
  });

  it("api_rate_limits politikasini kuran migration yeniden calistirilabilir", () => {
    const owner = filenames.filter((name) =>
      readMigration(name).includes('CREATE POLICY "admins_read_rate_limits"'),
    );
    expect(owner.length).toBeGreaterThan(0);
    for (const name of owner) {
      const sql = readMigration(name);
      expect(sql, `${name} politikayı önce düşürmüyor`).toMatch(
        /DROP POLICY IF EXISTS "admins_read_rate_limits"[\s\S]*CREATE POLICY "admins_read_rate_limits"/,
      );
    }
  });
});

/**
 * KOMİSYON PENCERESİ (12 AY) REGRESYON TESTİ.
 *
 * Ölçülen risk: komisyon satırını İKİ AYRI yol yazar
 * (`process_paddle_event()` ve `record_affiliate_commission()`). Sınır yalnız
 * birine gömülürse affiliate 12. aydan sonra da komisyon kazanmaya devam eder ve
 * bu, gerçek para çıkışı olarak geri alınamaz. Bu test sınırın TEK yerde
 * (BEFORE INSERT bekçisinde) durduğunu, mahsup edilen ayı saymadığını ve SQL
 * sayısının `src/lib/affiliate.ts` (`COMMISSION_MAX_MONTHS`) ile AYNI olduğunu
 * kilitler.
 */
describe("affiliate komisyon penceresi (max 12 ay)", () => {
  const capFile = filenames.find((name) => name.includes("affiliate_commission_cap"));

  it("pencere migration'i vardir ve adi gecerlidir", () => {
    expect(capFile).toBeDefined();
    expect(/^\d{14}_.+\.sql$/.test(capFile!)).toBe(true);
  });

  it("bekci TRIGGER'dir (komisyon yazan her yolu kapsar) ve yeniden calistirilabilir", () => {
    const sql = readMigration(capFile!);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.enforce_affiliate_commission_cap\(\)/);
    expect(sql).toMatch(/BEFORE INSERT ON public\.affiliate_commissions/);
    // Yeniden çalıştırma: trigger önce düşürülür (yoksa ikinci push patlar).
    expect(sql).toMatch(
      /DROP TRIGGER IF EXISTS enforce_affiliate_commission_cap ON public\.affiliate_commissions;[\s\S]*CREATE TRIGGER enforce_affiliate_commission_cap/,
    );
    // Mahsup edilen (iade) ay pencereyi tüketmez: gelir üretmemiştir.
    expect(sql).toMatch(/status <> 'reversed'/);
    // Pencere dolduğunda satır YAZILMAZ ve durum ayrı raporlanır.
    expect(sql).toContain("RETURN NULL");
    expect(sql).toContain("'cap_reached'");
  });

  it("SQL siniri TS sabitiyle AYNI (ayrisma sessizce yasanmaz)", () => {
    const sql = readMigration(capFile!);
    const literals = [...sql.matchAll(/_max_months\s+integer\s*:=\s*(\d+)\s*;/g)].map((m) =>
      Number(m[1]),
    );
    // Hem trigger hem `record_affiliate_commission()` aynı sayıyı taşımalı.
    expect(literals.length).toBeGreaterThanOrEqual(2);
    for (const value of literals) expect(value).toBe(COMMISSION_MAX_MONTHS);
  });
});
