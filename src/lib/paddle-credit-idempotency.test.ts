/**
 * PADDLE KREDİ İDEMPOTANSİYETİ — kalıcı değişmez testi.
 *
 * ÖLÇÜLEN HATA (gerçek Postgres 18'de `process_paddle_event` çağrılarak üretildi):
 * `credits = credits + GREATEST(_search_credits, 0)` KOŞULSUZ çalışıyordu ve
 * tekilleştirme yalnız `event_id` bazındaydı. Paddle aynı ödeme için birden çok
 * olay gönderdiğinden (`transaction.completed` + `transaction.updated`, her biri
 * KENDİ `event_id`siyle) aynı işlem için kredi İKİ KEZ ekleniyordu — uygulama
 * katmanındaki "kayıtlı mı?" kontrolü ÖNCE OKU–SONRA YAZ olduğu için yarışı
 * kapatmıyor. Kredi paranın karşılığıdır; iki kat vermek geri alınamaz.
 *
 * Bu test, DÜZELTMENİN ETKİN OLAN son tanımda durduğunu kilitler. Yeni bir
 * migration fonksiyonu yeniden tanımlarsa ve bekçiyi taşımazsa burası kırılır —
 * istenen davranış budur, çünkü sessiz gerileme para kaybıdır.
 *
 * NEDEN DOSYA İÇERİĞİ: sandbox'ta canlı veritabanı yok; SQL `supabase db push`
 * ile uygulanır. Aynı yaklaşım depoda zaten kullanılıyor
 * (`supabase-migrations.test.ts`, komisyon penceresi bekçisi).
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const read = (name: string) => readFileSync(new URL(name, `file://${MIGRATIONS_DIR}`), "utf8");

/** Fonksiyonu tanımlayan dosyalar (sıralı) — SONUNCUSU etkin olandır. */
const definitions = files
  .map((name) => ({ name, sql: read(name) }))
  .filter((f) => f.sql.includes("CREATE OR REPLACE FUNCTION public.process_paddle_event("));

const effective = definitions[definitions.length - 1];
const effectiveSql = effective?.sql ?? "";

/** Fonksiyonun imzası (parantez içi) — gövdedeki değişkenlerle karışmasın. */
function signatureOf(sql: string): string {
  const open = sql.indexOf("CREATE OR REPLACE FUNCTION public.process_paddle_event(");
  const close = sql.indexOf(") RETURNS", open);
  return open === -1 || close === -1 ? "" : sql.slice(open, close);
}

/** Fonksiyon gövdesi (CREATE … $function$;). */
function bodyOf(sql: string): string {
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.process_paddle_event(");
  const end = sql.indexOf("$function$;", start);
  return start === -1 ? "" : sql.slice(start, end === -1 ? undefined : end);
}

const signature = signatureOf(effectiveSql);
const body = bodyOf(effectiveSql);
const sqlParamNames = [
  ...signature.matchAll(/(_[a-z_]+)\s+(?:text|uuid|timestamptz|bigint|boolean|integer|jsonb)\b/g),
].map((m) => m[1]!);

describe("process_paddle_event — kredi idempotansı", () => {
  it("fonksiyonun en az bir tanımı vardır ve etkin tanım adı geçerlidir", () => {
    expect(definitions.length).toBeGreaterThan(0);
    expect(effective?.name).toMatch(/^\d{14}_.+\.sql$/);
    expect(effective?.name).toContain("paddle_credit_idempotency");
  });

  it("KREDİ KOŞULSUZ EKLENMEZ — eski hatalı biçim etkin tanımda yok", () => {
    expect(body).not.toMatch(/credits\s*=\s*credits\s*\+\s*GREATEST\(COALESCE\(_search_credits/);
    expect(body).not.toMatch(/credits\s*=\s*credits\s*\+\s*GREATEST\(COALESCE\(_sim_credits/);
  });

  it("kredi DEFTER üzerinden tek seferlik talep edilir (kararı tekil indeks verir)", () => {
    expect(body).toContain("INSERT INTO public.credit_ledger");
    // Kısmi tekil indeksle eşleşen çakışma hedefi (yoksa ON CONFLICT hata verir).
    expect(body).toContain("ON CONFLICT (ref_key) WHERE ref_key IS NOT NULL DO NOTHING");
    expect(body).toContain("RETURNING id INTO _ledger_id");
    expect(body).toMatch(/_ledger_claimed\s*:=\s*_ledger_id IS NOT NULL/);
    // Profil kredisi YALNIZ talep başarılıysa artar ve artış talep kontrolünden SONRA gelir.
    const claim = body.indexOf("_ledger_claimed := _ledger_id IS NOT NULL");
    const grant = body.indexOf("credits     = credits + _search_grant");
    expect(claim).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(claim);
  });

  it("anahtar İŞLEM kimliğidir; işlem yoksa olay kimliğine düşer", () => {
    expect(body).toContain("'paddle:' || COALESCE(NULLIF(_transaction_id, ''), _event_id)");
  });

  it("kredi deftere 'paddle' sebebiyle ve işlem iziyle yazılır", () => {
    // `credit_ledger` şeması 'paddle' sebebini sayıyordu ama YAZAN kod yoktu:
    // en büyük kredi kaynağı teşhis edilemiyordu.
    expect(body).toMatch(/'paddle',\s*\n\s*_ledger_key/);
    expect(body).toContain("'transaction_id', _transaction_id");
    expect(body).toContain("'event_id',       _event_id");
  });

  it("defter yoksa kredi KAYBOLMAZ (eski davranışa düşer)", () => {
    expect(body).toContain("to_regclass('public.credit_ledger') IS NOT NULL");
    expect(body).toMatch(/_ledger_claimed\s*:=\s*true/);
  });

  it("yetkiler dar kalır: yalnız service_role çağırabilir", () => {
    expect(effectiveSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.process_paddle_event\([\s\S]*?FROM PUBLIC, anon, authenticated;/,
    );
    expect(effectiveSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.process_paddle_event\([\s\S]*?TO service_role;/,
    );
  });

  it("bekçinin dayandığı tekil indeks uygulanan zincirde var", () => {
    // İndeks yoksa `ON CONFLICT (ref_key)` HER çağrıda hata verir ve webhook
    // sonsuz 500 döngüsüne girer: bekçinin ön koşulu kilitlenir.
    const owners = files.filter((name) => read(name).includes("credit_ledger_ref_key_uniq"));
    expect(owners.length).toBeGreaterThan(0);
    expect(read(owners[0]!)).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_ref_key_uniq[\s\S]*?WHERE ref_key IS NOT NULL/,
    );
  });
});

/**
 * İMZA UYUMU: SQL parametre adları ile çağıran TypeScript sözlükleri eşleşmezse
 * PostgREST çalışma anında hata verir ve ödeme akışı düşer. Test, adların iki
 * tarafta da birebir aynı olduğunu kilitler.
 */
describe("process_paddle_event — çağrı imzası uyumu", () => {
  const callSites: { file: string; anchor: string; stop: string }[] = [
    {
      file: "./paddle-webhook.server.ts",
      anchor: "const args = {",
      stop: "} as Record<string, unknown>",
    },
    { file: "./paddle.functions.ts", anchor: 'rpc("process_paddle_event", {', stop: "\n    })" },
  ];

  it("SQL imzası 19 parametre alır (adlar ve sıra sabit)", () => {
    expect(sqlParamNames.length).toBe(19);
    expect(sqlParamNames[0]).toBe("_event_id");
    expect(sqlParamNames[18]).toBe("_payload");
  });

  for (const site of callSites) {
    it(`${site.file} aynı 19 adı geçirir`, () => {
      const src = readFileSync(new URL(site.file, import.meta.url), "utf8");
      const start = src.indexOf(site.anchor);
      expect(start, `${site.file}: çağrı bloğu bulunamadı`).toBeGreaterThan(-1);
      const end = src.indexOf(site.stop, start);
      expect(end, `${site.file}: çağrı bloğu bitişi bulunamadı`).toBeGreaterThan(start);
      const block = src.slice(start, end);
      const passed = [...block.matchAll(/(_[a-z_]+):/g)].map((m) => m[1]!);
      expect(passed.sort()).toEqual([...sqlParamNames].sort());
    });
  }
});
