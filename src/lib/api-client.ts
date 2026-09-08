/**
 * İstemci tarafı: korumalı /api uçlarına Supabase oturum jetonu ekleyerek istek atar.
 */
import { supabase } from "@/integrations/supabase/client";
import { clientApiUrl } from "@/lib/client-env";

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  let token: string | undefined;
  try {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
  } catch (error) {
    console.error("[api-client] Could not read the Supabase session; the request may be unauthorized.", error);
  }
  if (!token && typeof window !== "undefined") {
    console.warn("[api-client] No Supabase access token available for protected API request.");
  }
  return fetch(clientApiUrl(input), {
    ...init,
    credentials: init.credentials ?? "same-origin",
    headers,
  });
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
