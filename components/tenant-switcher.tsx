"use client";

import { Building2, ChevronsUpDown } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useTenant } from "@/components/providers/tenant-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function TenantSwitcher({ compact }: { compact?: boolean }) {
  const { tenants } = useAuth();
  const { tenant, tenantId, setTenantId } = useTenant();

  if (tenants.length === 0) return null;
  if (tenants.length === 1 && compact) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-sm font-medium">
        <Building2 className="size-4 text-muted-foreground" />
        <span className="max-w-32 truncate">{tenants[0].name}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          className={cn("justify-between gap-2", !compact && "w-full")}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Building2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="max-w-36 truncate">{tenant?.name ?? "Select tenant"}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Tenant workspace</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {tenants.map((t) => (
          <DropdownMenuItem key={t.id} onClick={() => setTenantId(t.id)} disabled={t.id === tenantId}>
            <Building2 className="size-4" />
            <span className="flex-1 truncate">{t.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
