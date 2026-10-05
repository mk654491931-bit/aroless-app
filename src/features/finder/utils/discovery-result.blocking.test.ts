/**
 * ENGELLEME KURALI — kurulum eksiği aramayı BAŞLATMAMALI.
 *
 * Ölçülen hata: arama düzgün kurulmamış bir ortamda başlatılıyordu. İş kaydı
 * açılamayınca yeni hat `ok:false` dönüyor, arayüz sessizce klasik hatta
 * düşüyor ve kullanıcı 280 sn sonra "Arka plan analizi zaman aşımına uğradı"
 * kartını görüyordu — gerçek sebep ekranda hiç görünmüyordu.
 *
 * Kritik ayrım: QStash eksikliği aramayı ENGELLEMEZ (`inline` yolu çalışır),
 * veritabanı eksikliği ENGELLER (her iki yol da aynı anda düşer). Bu ayrım
 * yanlış yapılırsa sağlam bir kurulum kırılır ya da kırık kurulum çalışıyor
 * gibi görünür — ikisi de bu kod tabanının en pahalı hata türü.
 */
import { describe, expect, it } from "vitest";

import { blockingSetupIssues, type SetupReport } from "./discovery-result";

const check = (id: string, ok: boolean, fix = `${id} düzelt`): SetupReport["checks"][number] => ({
  id,
  label: id,
  ok,
  fix,
});

const report = (checks: SetupReport["checks"]): SetupReport => ({
  ok: checks.filter((c) => !c.optional).every((c) => c.ok),
  summary: "test",
  checks,
});

describe("blockingSetupIssues", () => {
  it("servis rolü anahtarı yoksa arama BAŞLATILMAZ ve düzeltme yazılır", () => {
    const issues = blockingSetupIssues(
      report([
        check("supabase_url", true),
        check("supabase_service_role", false, "service_role anahtarını ekle"),
      ]),
    );
    expect(issues).toEqual(["service_role anahtarını ekle"]);
  });

  it("migration uygulanmamışsa kolon ve RPC eksikleri engeldir", () => {
    const issues = blockingSetupIssues(
      report([
        check("db_columns", false, "migration çalıştır"),
        check("db_rpc", false, "RPC'leri oluştur"),
      ]),
    );
    expect(issues).toEqual(["migration çalıştır", "RPC'leri oluştur"]);
  });

  it("QStash anahtarları eksikse arama ENGELLENMEZ (inline yolu çalışır)", () => {
    // Bu, sağlam bir Vercel kurulumudur: hat yalnız daha yavaştır.
    const issues = blockingSetupIssues(
      report([
        check("qstash_token", false, "QSTASH_TOKEN ekle"),
        check("qstash_signing_key", false, "imza anahtarı ekle"),
        check("supabase_service_role", true),
      ]),
    );
    expect(issues).toEqual([]);
  });

  it("opsiyonel Gemini eksikliği ASLA engel değildir", () => {
    const issues = blockingSetupIssues(
      report([{ ...check("gemini", false, "GEMINI_API_KEY ekle"), optional: true }]),
    );
    expect(issues).toEqual([]);
  });

  it("rapor gelemezse engel YOK sayılır (kontrol aramayı asla kilitlemez)", () => {
    expect(blockingSetupIssues(null)).toEqual([]);
    expect(blockingSetupIssues(undefined)).toEqual([]);
  });

  it("rapor bozuksa çökmmez", () => {
    expect(blockingSetupIssues(report([]))).toEqual([]);
  });
});
