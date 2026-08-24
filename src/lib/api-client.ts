/**
 * İstemci tarafı: korumalı /api uçlarına Supabase oturum jetonu ekleyerek istek atar.
 */
import { supabase } from "@/integrations/supabase/client";

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
  } catch {
    /* oturum yoksa uç 401 döndürecek */
  }
  return fetch(input, { ...init, headers });
}

/** JSON POST kısayolu; hata durumunda anlaşılır mesaj fırlatır. */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error || "İstek başarısız oldu. Lütfen tekrar deneyin.");
  return data as T;
}
