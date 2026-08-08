"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Building2,
  CreditCard,
  LayoutDashboard,
  MailPlus,
  MessageSquareText,
  MessagesSquare,
  Settings,
  Shield,
  Sparkles,
  UserPlus,
  Users,
  Boxes,
} from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useTenant } from "@/components/providers/tenant-provider";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

const dashboardNav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/conversations", label: "Conversations", icon: MessagesSquare },
  { href: "/dashboard/agents", label: "Agents", icon: Sparkles },
  { href: "/dashboard/usage", label: "Usage", icon: BarChart3 },
  { href: "/dashboard/templates", label: "Templates", icon: MailPlus },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const adminNav = [
  { href: "/admin", label: "Admin overview", icon: Shield, exact: true },
  { href: "/admin/tenants", label: "Tenants", icon: Building2 },
  { href: "/admin/plans", label: "Plans", icon: Boxes },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/admin/god-users", label: "God users", icon: UserPlus },
];

function NavLink({
  href,
  label,
  icon: Icon,
  exact,
  pathname,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  pathname: string;
}) {
  const active = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { loading, user, isGod } = useAuth();
  const { tenantId } = useTenant();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (!user) return null;

  const inAdmin = pathname.startsWith("/admin");

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-background p-3 lg:flex">
        <Link href="/dashboard" className="flex items-center gap-2 px-2 py-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <MessageSquareText className="size-4" />
          </div>
          <span className="font-semibold tracking-tight">Whata AI</span>
        </Link>

        <div className="mt-3">
          <TenantSwitcher />
        </div>

        <nav className="mt-4 flex flex-col gap-0.5">
          <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {inAdmin ? "Admin" : "Workspace"}
          </p>
          {(inAdmin ? adminNav : dashboardNav).map((item) => (
            <NavLink key={item.href} {...item} pathname={pathname} />
          ))}
        </nav>

        <div className="mt-auto space-y-3">
          {isGod && !inAdmin ? (
            <Button asChild variant="outline" size="sm" className="w-full justify-start gap-2">
              <Link href="/admin/tenants">
                <Shield className="size-4" />
                God-mode admin
              </Link>
            </Button>
          ) : null}
          <div className="flex items-center justify-between border-t pt-3">
            <UserMenu />
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b bg-background/80 px-4 py-3 backdrop-blur lg:hidden">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <MessageSquareText className="size-4" />
            </div>
            Whata AI
          </Link>
          <div className="flex items-center gap-2">
            <TenantSwitcher compact />
            <ThemeToggle />
          </div>
        </header>

        <main className="min-w-0 flex-1">
          {!inAdmin && !tenantId ? (
            <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-4 text-center">
              <Users className="size-10 text-muted-foreground" />
              <div>
                <p className="font-medium">No tenant workspace</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  You’re signed in but not a member of any tenant yet. Ask your platform admin
                  to add you via the tenants admin.
                </p>
              </div>
              {isGod ? (
                <Button asChild>
                  <Link href="/admin/tenants">Manage tenants</Link>
                </Button>
              ) : null}
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
