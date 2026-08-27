"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AuthChangeEvent } from "@supabase/supabase-js";
import { api } from "@/lib/api/client";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import type { MeResponse } from "@/app/api/me/route";

interface AuthContextValue {
  loading: boolean;
  user: MeResponse["user"] | null;
  isGod: boolean;
  tenants: MeResponse["tenants"];
  roles: Record<string, string>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeResponse>({ user: null, isGod: false, tenants: [], roles: {} });

  const refresh = useCallback(async () => {
    try {
      const data = await api<MeResponse>("/api/me");
      setMe(data);
    } catch {
      setMe({ user: null, isGod: false, tenants: [], roles: {} });
    }
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowser();

    const { data: sub } = supabase.auth.onAuthStateChange((event: AuthChangeEvent) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
        void refresh();
      }
      if (event === "SIGNED_OUT") {
        setMe({ user: null, isGod: false, tenants: [], roles: {} });
      }
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await getSupabaseBrowser().auth.signOut();
    setMe({ user: null, isGod: false, tenants: [], roles: {} });
  }, []);

  const value = useMemo(
    () => ({ loading, user: me.user, isGod: me.isGod, tenants: me.tenants, roles: me.roles, refresh, signOut }),
    [loading, me, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
