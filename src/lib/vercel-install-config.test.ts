// Vercel build'ının hangi paket yöneticisiyle kurulacağını kilitler.
//
// ÖLÇÜLEN CANLI HATA (build logu):
//   Running "install" command: `bun install`...
//   bun install v1.3.14
//   Resolved, downloaded and extracted [18]
//   … ve 8 saniyede hata.
//
// Neden oluyor: depoda `bun.lock` ve `bunfig.toml` olduğu için Vercel CLI
// paket yöneticisini `bun` olarak seçiyor. `bun.lock` içindeki 36 paketin
// çözülmüş adresleri `https://europe-west1-npm.pkg.dev/lovable-core-prod/
// sandbox-npm-cache/...` üzerine yazılmış; bu kova yalnızca geliştirme
// ortamından erişilebilir, Vercel build makinesinden 403 alır ve kurulum
// saniyeler içinde çöker. `package-lock.json` ise yalnızca
// `registry.npmjs.org` kullanıyor.
//
// Bu yüzden kurulum Vercel'de **açıkça** npm'e sabitlenir; otomatik algılama
// (bun.lock'a bakıp bun seçmek) kırılgandır.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function repoFile(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${name}`, import.meta.url)), "utf8");
}

describe("vercel.json", () => {
  const config = JSON.parse(repoFile("vercel.json")) as Record<string, string>;

  it("kurulumu npm'e sabitler (bun.lock özel registry'den çözümlüyor)", () => {
    expect(config.installCommand).toBe("npm ci");
  });

  it("derleme komutu package.json'daki build scriptini çalıştırır", () => {
    expect(config.buildCommand).toBe("npm run build");
  });

  it("şema doğrulamasını kıracak yorum anahtarı taşımaz", () => {
    // `vercel.json` şeması `additionalProperties: false` kullanır: yorum
    // amaçlı `//` anahtarları build'i şema doğrulamasında kırar.
    expect(Object.keys(config).sort()).toEqual(["$schema", "buildCommand", "installCommand"]);
  });
});

describe("lockfile'ler", () => {
  it("package-lock.json yalnızca npm registry'sini kullanır", () => {
    const lock = repoFile("package-lock.json");
    const resolved = [...lock.matchAll(/"resolved": "https:\/\/([^/]+)\//g)].map((m) => m[1]);
    expect(resolved.length).toBeGreaterThan(0);
    expect([...new Set(resolved)]).toEqual(["registry.npmjs.org"]);
  });

  it("bun.lock özel registry'den paket çözümlüyor (Vercel bunu kullanamaz)", () => {
    // Bu bir KONTROL değil, bir HAT BİLDİRİSİ: kayıtlıysa Vercel'de kurulum
    // çöker. Değişirse `bun install` Vercel'de çalışabilir hale gelir.
    const privateUrls = [...repoFile("bun.lock").matchAll(/https:\/\/europe-west1-npm\.pkg\.dev/g)];
    expect(privateUrls.length).toBeGreaterThan(0);
  });
});