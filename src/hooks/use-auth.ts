import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      // A token minted under a skewed clock is rejected by the backend
      // ("JWT issued at future"). Mint a fresh one before any server call.
      if (session && (session.expires_at ?? 0) * 1000 < Date.now() + 60_000) {
        await supabase.auth.refreshSession();
      } else if (session) {
        const iat = Number(JSON.parse(atob(session.access_token.split(".")[1] ?? "e30"))?.iat ?? 0);
        if (iat * 1000 > Date.now() + 30_000) await supabase.auth.refreshSession();
      }
      const { data: u } = await supabase.auth.getUser();
      if (!mounted) return;
      setUser(u.user);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);
  return { user, loading };
}
