"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

export default function AuthCallbackPage() {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    let cancelled = false;
    async function finish() {
      const supabase = getSupabaseBrowser();
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next") ?? "/";
      const go = (path: string) => {
        if (!cancelled) router.replace(path);
      };

      const code = params.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) return go(`/login?error=${encodeURIComponent(error.message)}`);
        return go(next);
      }

      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) return go(`/login?error=${encodeURIComponent(error.message)}`);
        return go(next.startsWith("/") ? next : "/");
      }

      return go(`/login?error=${encodeURIComponent("Invalid auth link")}`);
    }
    finish();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <p className="text-sm text-muted-foreground">Signing you in…</p>
    </div>
  );
}
