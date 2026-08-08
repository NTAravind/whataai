"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/components/providers/auth-provider";

interface TenantContextValue {
  tenantId: string | null;
  tenant: { id: string; name: string; status: string } | null;
  setTenantId: (id: string) => void;
}

const TenantContext = createContext<TenantContextValue | null>(null);

const STORAGE_KEY = "whataai.tenant";

export function TenantProvider({ children }: { children: ReactNode }) {
  const { tenants, loading } = useAuth();
  const [tenantId, setTenantIdState] = useState<string | null>(null);
  const [prevTenants, setPrevTenants] = useState(tenants);

  if (!loading && tenants !== prevTenants) {
    setPrevTenants(tenants);
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    const next = tenants.find((t) => t.id === stored)?.id ?? tenants[0]?.id ?? null;
    setTenantIdState(next);
  }

  const setTenantId = (id: string) => {
    setTenantIdState(id);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
  };

  const value = useMemo(
    () => ({
      tenantId,
      tenant: tenants.find((t) => t.id === tenantId) ?? null,
      setTenantId,
    }),
    [tenantId, tenants],
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used within TenantProvider");
  return ctx;
}
