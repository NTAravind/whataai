"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  BookOpenText,
  Bot,
  Briefcase,
  Building2,
  CalendarCheck,
  CalendarDays,
  Clock,
  CreditCard,
  LayoutDashboard,
  MailPlus,
  MessagesSquare,
  Settings,
  Shield,
  Sparkles,
  UserPlus,
  Users,
  Boxes,
  Wrench,
  Contact,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useTenant } from "@/components/providers/tenant-provider";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

const mainNav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/conversations", label: "Conversations", icon: MessagesSquare },
  { href: "/dashboard/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/dashboard/contacts", label: "Contacts", icon: Contact },
];

const setupNav = [
  { href: "/dashboard/businesses", label: "Businesses", icon: Briefcase },
  { href: "/dashboard/services", label: "Services", icon: Wrench },
  { href: "/dashboard/resources", label: "Resources", icon: Users },
  { href: "/dashboard/availability", label: "Availability", icon: Clock },
];

const secondaryNav = [
  { href: "/dashboard/agents", label: "AI Agents", icon: Bot },
  { href: "/dashboard/knowledge", label: "Knowledge Base", icon: BookOpenText },
  { href: "/dashboard/templates", label: "WhatsApp Templates", icon: MailPlus },
  { href: "/dashboard/usage", label: "Usage", icon: BarChart3 },
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

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
    <div className="flex min-h-screen bg-[#f7f7f4] dark:bg-background">
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-background p-3 lg:flex transition-all duration-300",
          isSidebarOpen ? "w-60" : "w-0 p-0 overflow-hidden border-none opacity-0"
        )}
      >
        <div className="flex items-center justify-between px-2 py-2">
          <Link href="/dashboard" className="flex items-center gap-2">
            <img src="/logo.svg" alt="Whata AI logo" className="size-8" />
            <span className="text-xl font-black tracking-[-0.07em] whitespace-nowrap text-[#111] dark:text-white">What<span className="text-[#25D366]">AI</span><span className="text-[#25D366]">.</span></span>
          </Link>
          <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(false)} className="h-8 w-8 shrink-0">
            <PanelLeftClose className="size-4" />
          </Button>
        </div>

        <div className="mt-3">
          <TenantSwitcher />
        </div>

        <div className="mt-4 px-2">
          <Button
            asChild
            className="w-full justify-start gap-2 shadow-sm"
            variant={pathname.startsWith("/dashboard/chat") ? "default" : "outline"}
          >
            <Link href="/dashboard/chat">
              <Sparkles className="size-4" />
              AI Co-pilot
            </Link>
          </Button>
        </div>

        <nav className="mt-4 flex flex-col gap-0.5 overflow-y-auto pr-1">
          {inAdmin ? (
            <>
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Admin
              </p>
              {adminNav.map((item) => (
                <NavLink key={item.href} {...item} pathname={pathname} />
              ))}
            </>
          ) : (
            <>
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Main
              </p>
              {mainNav.map((item) => (
                <NavLink key={item.href} {...item} pathname={pathname} />
              ))}

              <p className="mt-3 px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Booking Setup
              </p>
              {setupNav.map((item) => (
                <NavLink key={item.href} {...item} pathname={pathname} />
              ))}

              <p className="mt-3 px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Platform
              </p>
              {secondaryNav.map((item) => (
                <NavLink key={item.href} {...item} pathname={pathname} />
              ))}
            </>
          )}
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

      <div className="flex min-w-0 flex-1 flex-col relative">
        {!isSidebarOpen && (
          <Button
            variant="outline"
            size="icon"
            onClick={() => setIsSidebarOpen(true)}
            className="absolute top-4 left-4 z-50 hidden lg:flex shadow-sm bg-background/80 backdrop-blur-sm"
          >
            <PanelLeftOpen className="size-4 text-muted-foreground" />
          </Button>
        )}

        <header className="flex items-center justify-between gap-4 border-b bg-background/80 px-4 py-3 backdrop-blur lg:hidden">
          <Link href="/dashboard" className="flex items-center gap-2">
            <img src="/logo.svg" alt="Whata AI logo" className="size-7" />
            <span className="text-xl font-black tracking-[-0.07em] whitespace-nowrap text-[#111] dark:text-white">What<span className="text-[#25D366]">AI</span><span className="text-[#25D366]">.</span></span>
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
