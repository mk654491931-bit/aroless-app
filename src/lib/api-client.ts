/**
 * İstemci tarafı: korumalı /api uçlarına Supabase oturum jetonu ekleyerek istek atar.
 */
import { supabase } from "@/integrations/supabase/client";

const DEFAULT_TIMEOUT_MS = 10_000;

export async function apiFetch(
  input: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const headers = new Headers(init.headers);
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
  } catch {
    /* oturum yoksa uç 401 döndürecek */
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** JSON POST kısayolu; hata durumunda anlaşılır mesaj fırlatır. */
export async function apiPost<T>(path: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const res = await apiFetch(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error || "İstek başarısız oldu. Lütfen tekrar deneyin.");
  return data as T;
}
