"use client";

import Link from "next/link";
import { Boxes, Building2, CreditCard, UserPlus } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState, LoadingState } from "@/components/data-state";
import { formatDateTime } from "@/lib/format";

interface TenantRow {
  id: string;
  name: string;
  status: string;
  created_at: string;
}
interface PlanRow {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}
interface SubscriptionRow {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
}
interface GodUserRow {
  id: string;
  email: string;
  created_at: string;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  active: "default",
  approved: "default",
  connected: "default",
  canceled: "secondary",
  expired: "secondary",
  trialing: "secondary",
  suspended: "destructive",
  past_due: "destructive",
};

function Status({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>{status}</Badge>;
}

export default function AdminOverviewPage() {
  const tenants = useApi<{ tenants: TenantRow[] }>("/api/admin/tenants");
  const plans = useApi<{ plans: PlanRow[] }>("/api/admin/plans");
  const subscriptions = useApi<{ subscriptions: SubscriptionRow[] }>("/api/admin/subscriptions");
  const godUsers = useApi<{ godUsers: GodUserRow[] }>("/api/admin/god-users");

  const loading = tenants.loading || plans.loading || subscriptions.loading || godUsers.loading;
  const error = tenants.error ?? plans.error ?? subscriptions.error ?? godUsers.error;

  if (loading) return <AdminScaffold><LoadingState rows={6} /></AdminScaffold>;
  if (error) return <AdminScaffold><ErrorState message={error} /></AdminScaffold>;

  const stats = [
    { label: "Tenants", value: tenants.data?.tenants.length ?? 0, icon: Building2, href: "/admin/tenants" },
    { label: "Active plans", value: plans.data?.plans.filter((p) => p.is_active).length ?? 0, icon: Boxes, href: "/admin/plans" },
    { label: "Subscriptions", value: subscriptions.data?.subscriptions.length ?? 0, icon: CreditCard, href: "/admin/subscriptions" },
    { label: "God users", value: godUsers.data?.godUsers.length ?? 0, icon: UserPlus, href: "/admin/god-users" },
  ];

  return (
    <AdminScaffold>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="transition-colors hover:border-primary/50">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
                <s.icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{s.value}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent tenants</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(tenants.data?.tenants ?? []).slice(0, 5).map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell><Status status={t.status} /></TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(t.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent subscriptions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(subscriptions.data?.subscriptions ?? []).slice(0, 5).map((s) => {
                  const tenant = tenants.data?.tenants.find((t) => t.id === s.tenant_id);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{tenant?.name ?? s.tenant_id.slice(0, 8)}</TableCell>
                      <TableCell><Status status={s.status} /></TableCell>
                      <TableCell className="text-muted-foreground">{formatDateTime(s.created_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AdminScaffold>
  );
}

function AdminScaffold({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Admin overview"
        description="Platform-level control across tenants, plans, and subscriptions"
      />
      {children}
    </div>
  );
}
