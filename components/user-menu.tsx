"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { useTenant } from "@/components/providers/tenant-provider";
import { useCurrency } from "@/hooks/use-currency";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import type { Currency } from "@/lib/format";

function initials(name: string | null) {
  if (!name) return "?";
  return name.slice(0, 2).toUpperCase();
}

export function UserMenu() {
  const { user, isGod, signOut } = useAuth();
  const { tenant } = useTenant();
  const router = useRouter();
  const { currency, toggleCurrency } = useCurrency(tenant?.currency as Currency | undefined);

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar className="size-8">
          <AvatarFallback>{initials(user?.email ?? null)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="truncate text-sm font-medium">{user?.email}</span>
          {isGod ? <Badge variant="secondary" className="w-fit text-xs">god-mode</Badge> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={toggleCurrency}>
          <span className="flex items-center gap-2">
            <span className="font-mono text-xs">{currency === "USD" ? "₹" : "$"}</span>
            Switch to {currency === "USD" ? "INR" : "USD"}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
