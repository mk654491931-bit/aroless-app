import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  component: AuthCallback,
  head: () => ({
    meta: [
      { title: "Giriş doğrulanıyor | Velora" },
      { name: "description", content: "Velora hesabınıza güvenli giriş doğrulanıyor." },
      { property: "og:title", content: "Giriş doğrulanıyor | Velora" },
      { property: "og:description", content: "Velora hesabınıza güvenli giriş doğrulanıyor." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    let done = false;
    const go = (to: string) => {
      if (done) return;
      done = true;
      void navigate({ to, replace: true });
    };

    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        const saved = sessionStorage.getItem("velora:post-auth") ?? "/";
        sessionStorage.removeItem("velora:post-auth");
        go(saved.startsWith("/") ? saved : "/");
      }
    };

    void check();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) void check();
    });
    const timer = setTimeout(() => go("/auth"), 8000);

    return () => {
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm">Giriş doğrulanıyor…</p>
      </div>
    </div>
  );
}
