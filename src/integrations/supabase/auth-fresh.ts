import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "./client";

/** Returns the token only if it is currently valid (not expired, not future-issued). */
function tokenIssues(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1] ?? "e30")) as {
      iat?: number;
      exp?: number;
    };
    const now = Date.now();
    if ((payload.exp ?? 0) * 1000 < now + 30_000) return true;
    // Client clock ahead of the auth server => "JWT issued at future".
    if ((payload.iat ?? 0) * 1000 > now + 5_000) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Attaches a Supabase bearer token, minting a fresh one when the current token
 * is expired or was issued with a skewed clock ("JWT issued at future").
 */
export const attachFreshSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const { data } = await supabase.auth.getSession();
    let token = data.session?.access_token;
    if (token && tokenIssues(token)) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      token = refreshed.session?.access_token ?? token;
    }
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);
