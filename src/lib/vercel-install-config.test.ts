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

describe("package-lock.json senkron", () => {
  // ÖLÇÜLEN İKİNCİ HATA: `npm ci` paket.json ile lock dosyası uyumsuzsa
  // KURULUM BAŞLAMADAN reddeder:
  //   npm error `npm ci` can only install packages when your package.json and
  //   package-lock.json … are in sync.
  //   Missing: @upstash/qstash@2.12.0 from lock file
  //   Missing: jose@6.2.12 / jose@5.10.0 / neverthrow@7.2.0 / uncrypto@0.1.3
  // Bu, Vercel'de 12 saniyede düşen hataydı: bir bağımlılık package.json'a
  // eklenmiş ama lock dosyası güncellenmemişti.
  const pkg = JSON.parse(repoFile("package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const lock = JSON.parse(repoFile("package-lock.json")) as {
    lockfileVersion?: number;
    packages?: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>;
  };
  const root = lock.packages?.[""] ?? {};

  it("lockfileVersion 3'tür", () => {
    expect(lock.lockfileVersion).toBe(3);
  });

  it("package.json'daki HER doğrudan bağımlılık lock kökünde tanımlı", () => {
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };
    const locked = { ...root.dependencies, ...root.devDependencies };
    const missing = Object.keys(declared).filter((name) => !locked[name]);
    expect(missing).toEqual([]);
  });

  it("kilitli sürümler package.json ile birebir aynı", () => {
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };
    const locked = { ...root.dependencies, ...root.devDependencies };
    const mismatched = Object.entries(declared).filter(
      ([name, range]) => locked[name] && locked[name] !== range,
    );
    expect(mismatched).toEqual([]);
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