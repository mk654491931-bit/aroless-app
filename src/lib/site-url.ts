/**
 * Yayınlanan origin'in tek kaynağı.
 * Sunucuda APP_URL → VITE_APP_URL → isteğin kendi origin'i sırasıyla çözülür.
 * Hiçbir yerde sabit domain yazılmaz (README kuralı).
 */
export function siteBaseUrl(request?: Request): string {
  const configured = (process.env["APP_URL"] ?? process.env["VITE_APP_URL"] ?? "").trim();
  const fallback = request ? new URL(request.url).origin : "";
  return (configured || fallback).replace(/\/+$/, "");
}

export function absoluteUrl(path: string, request?: Request): string {
  const base = siteBaseUrl(request);
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
