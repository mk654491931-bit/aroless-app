import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getSupabaseConfigError, supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/callback")({
  // Not: `ssr: false` kullanılmaz — OAuth dönüşü tam sayfa yüklemesidir; SSR'da
  // bekleyen eşleşme preview'da beyaz ekrana yol açıyordu. Bileşen sunucuda güvenli.
  component: AuthCallback,
  head: () => ({
    meta: [
      { title: "Giriş doğrulanıyor | Aroless" },
      { name: "description", content: "Aroless hesabınıza güvenli giriş doğrulanıyor." },
      { property: "og:title", content: "Giriş doğrulanıyor | Aroless" },
      { property: "og:description", content: "Aroless hesabınıza güvenli giriş doğrulanıyor." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const configError = getSupabaseConfigError();
    if (configError) {
      setError("Kimlik doğrulama yapılandırması eksik. Lütfen daha sonra tekrar deneyin.");
      return;
    }
    let done = false;
    const go = (to: string) => {
      if (done) return;
      done = true;
      void navigate({ to, replace: true });
    };

    const check = async () => {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (data.session) {
          const saved = sessionStorage.getItem("velora:post-auth") ?? "/";
          sessionStorage.removeItem("velora:post-auth");
          go(saved.startsWith("/") ? saved : "/");
        }
      } catch (caught) {
        console.error("Auth callback failed", caught);
        setError("Giriş doğrulanamadı. Lütfen tekrar deneyin.");
      }
    };

    void check();
    let unsubscribe: (() => void) | undefined;
    try {
      const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
        if (session) void check();
      });
      unsubscribe = () => sub.subscription.unsubscribe();
    } catch (caught) {
      console.error("Auth callback subscription failed", caught);
      setError("Giriş doğrulanamadı. Lütfen tekrar deneyin.");
    }
    const timer = setTimeout(() => go("/auth"), 8000);

    return () => {
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm">{error ?? "Giriş doğrulanıyor..."}</p>
      </div>
    </div>
  );
}
