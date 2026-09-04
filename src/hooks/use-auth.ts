import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return () => {
        mounted = false;
      };
    }
    const initialize = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        const session = data.session;
        // A token minted under a skewed clock is rejected by the backend
        // ("JWT issued at future"). Mint a fresh one before any server call.
        if (session && (session.expires_at ?? 0) * 1000 < Date.now() + 60_000) {
          await supabase.auth.refreshSession();
        } else if (session && tokenIssuedInFuture(session.access_token)) {
          await supabase.auth.refreshSession();
        }
        const { data: u, error: userError } = await supabase.auth.getUser();
        if (userError && userError.name !== "AuthSessionMissingError") throw userError;
        if (!mounted) return;
        setUser(u.user);
      } catch (error) {
        console.error("Auth initialization failed", error);
        if (mounted) setUser(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void initialize();
    let unsubscribe: (() => void) | undefined;
    try {
      const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
        setUser(session?.user ?? null);
        setLoading(false);
      });
      unsubscribe = () => sub.subscription.unsubscribe();
    } catch (error) {
      console.error("Auth subscription failed", error);
      setLoading(false);
    }
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);
  return { user, loading };
}

function tokenIssuedInFuture(accessToken: string): boolean {
  try {
    const encodedPayload = accessToken.split(".")[1];
    if (!encodedPayload) return false;
    const payload = JSON.parse(atob(encodedPayload)) as { iat?: unknown };
    return Number(payload.iat ?? 0) * 1000 > Date.now() + 30_000;
  } catch {
    return false;
  }
}
