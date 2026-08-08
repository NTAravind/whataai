"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { AuthProvider } from "@/components/providers/auth-provider";
import { TenantProvider } from "@/components/providers/tenant-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <AuthProvider>
        <TenantProvider>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          <Toaster richColors position="top-right" />
        </TenantProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
