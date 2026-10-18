// ============================================================================
// GITHUB REPOS — nişin açık kaynak hareketi (ANAHTARSIZ çalışır, jetonla güçlenir).
//
// ÖLÇÜLEN DARBOĞAZ (2026-10): GitHub arama API'si kimlik doğrulamasız 60
// istek/saat verir ve ürün bulucu TEK koşuda birkaç niş × varyant arayabilir;
// bu yüzden 403 ile kaybedilen koşular oluyordu. Jeton eklendiğinde sınır
// 5.000 istek/saate çıkar (resmî doküman: "rate limit for authenticated
// requests"). Jeton YOKSA kaynak eskisi gibi anahtarsız çalışır — bu yüzden
// jeton İSTEĞE BAĞLIDIR.
//
// JETON ADI NEDEN `GITHUB_API_TOKEN`: bu repoda `GITHUB_TOKEN` git işlemleri
// için ayrılmıştır (Freebuff/GitHub App tarafından yönetilir) ve AI/GitHub
// modelleri de onu otomatik okumaz. API kotası için AYRI, açık bir ad
// kullanmak, git kimliğiyle veri kimliğini karıştırmaz.
//
// DÜRÜSTLÜK:
//   • Yalnız yanıtta YAZAN sayılar kullanılır (yıldız, fork, açık issue, son
//     push tarihi). Yoksa `null`/boş kalır.
//   • Repo ürün DEĞİLDİR: kaynak `NON_PRODUCT_SOURCES` içindedir, ürün kartı
//     üretmez — yalnız talep/ekosistem bağlamıdır.
//   • `archived` repo elenir: bakımı bitmiş proje "canlı ekosistem" kanıtı
//     değildir.
// ============================================================================

import type { RawProduct } from "./product-discovery.types";

/** Jeton adları — ilk dolu olan kullanılır. */
export function githubApiToken(env: Record<string, string | undefined> = process.env): string {
  for (const name of ["GITHUB_API_TOKEN", "GH_API_TOKEN", "GITHUB_PAT"]) {
    const v = (env[name] ?? "").trim();
    if (v) return v;
  }
  return "";
}

/**
 * GitHub API başlıkları — SAF (test edilebilir).
 *
 * Jeton varsa `Authorization: Bearer …` eklenir; yoksa başlık kümesi
 * anahtarsız çağrıyla AYNIDIR (davranış değişmez, yalnız kota artar).
 */
export function githubApiHeaders(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  const token = githubApiToken(env);
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

/** Okunan repo alanları (GitHub `search/repositories` şeması). */
type GhRepo = {
  full_name?: unknown;
  description?: unknown;
  stargazers_count?: unknown;
  forks_count?: unknown;
  open_issues_count?: unknown;
  pushed_at?: unknown;
  html_url?: unknown;
  language?: unknown;
  archived?: unknown;
  topics?: unknown;
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

/** Son push'tan bu yana geçen gün — ölçülmüş tarih yoksa `null`. */
export function daysSincePush(pushedAt: unknown, now = Date.now()): number | null {
  const t = Date.parse(String(pushedAt ?? ""));
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((now - t) / 86_400_000);
  return days >= 0 ? days : null;
}

/**
 * GitHub arama yanıtını bağlam satırlarına çevirir — SAF, ağ YOK.
 *
 * Her satır bir repo; `notes` içine YALNIZ ölçülmüş sayılar yazılır
 * (`N yıldız`, `N fork`, `son push N gün önce`). Bu satırlar aday ürün
 * havuzuna girmez (bkz. `NON_PRODUCT_SOURCES`); nişin ekosistem büyüklüğünü
 * ve canlılığını kanıtlar.
 */
export function parseGithubRepos(payload: unknown, limit = 8): RawProduct[] {
  const items = (payload as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const out: RawProduct[] = [];
  for (const raw of items) {
    const repo = (raw ?? {}) as GhRepo;
    const title = String(repo.full_name ?? "").trim();
    if (!title) continue;
    // Bakımı bitmiş repo "canlı ekosistem" kanıtı değildir.
    if (repo.archived === true) continue;

    const stars = num(repo.stargazers_count);
    const forks = num(repo.forks_count);
    const issues = num(repo.open_issues_count);
    const days = daysSincePush(repo.pushed_at);
    const language = String(repo.language ?? "").trim();
    const topics = Array.isArray(repo.topics)
      ? (repo.topics as unknown[]).map((t) => String(t ?? "").trim()).filter(Boolean).slice(0, 4)
      : [];

    out.push({
      title: `${title} — ${String(repo.description ?? "niş aracı").slice(0, 120)}`,
      brand: "",
      seller: "",
      priceUsd: null,
      rating: null,
      ratingCount: null,
      inStock: null,
      source: "github",
      url: String(repo.html_url ?? ""),
      notes: [
        stars !== null ? `${stars.toLocaleString("tr-TR")} yıldız` : "",
        forks !== null ? `${forks.toLocaleString("tr-TR")} fork` : "",
        issues !== null ? `${issues.toLocaleString("tr-TR")} açık konu` : "",
        days !== null ? `son push ${days} gün önce` : "",
        language,
        topics.length ? `etiketler ${topics.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 200),
    });
    if (out.length >= limit) break;
  }
  return out;
}
