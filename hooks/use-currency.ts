"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useState, useEffect, useCallback } from "react";
import { useTenant } from "@/components/providers/tenant-provider";
import { formatCurrency as formatCurrencyUtil, type Currency } from "@/lib/format";

export function useCurrency(initialCurrency?: Currency) {
  const { tenantId } = useTenant();
  const [currency, setCurrency] = useState<Currency>(() => {
    if (initialCurrency) return initialCurrency;
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("whataai-currency");
      if (saved === "INR" || saved === "USD") return saved as Currency;
    }
    return "USD";
  });

  // Sync with tenant data when it changes (but not on initial render)
  useEffect(() => {
    if (initialCurrency) {
      setCurrency(initialCurrency);
    }
  }, [initialCurrency]);

  const toggleCurrency = useCallback(async () => {
    const next = currency === "USD" ? "INR" : "USD";
    setCurrency(next);
    localStorage.setItem("whataai-currency", next);

    if (tenantId) {
      try {
        await fetch(`/api/tenants/${tenantId}/currency`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currency: next }),
        });
      } catch {
        // Silent fail - localStorage already updated
      }
    }
  }, [currency, tenantId]);

  const formatCurrency = (amountUsd: number, fractionDigits = 4) => {
    return formatCurrencyUtil(amountUsd, currency, fractionDigits);
  };

  return { currency, toggleCurrency, formatCurrency };
}
