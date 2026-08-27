"use client";

import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock,
  Coins,
  DollarSign,
  IndianRupee,
  Inbox,
  MessageSquare,
  MessageSquareWarning,
  Phone,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useCurrency } from "@/hooks/use-currency";
import { useApi } from "@/hooks/use-api";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { BookingSetupProgress, type SetupStepStatus } from "@/components/booking/booking-setup-progress";
import { formatDateTime } from "@/lib/format";
import type {
  AgentRow,
  AppointmentServiceRow,
  AvailabilityRuleRow,
  BookingRow,
  BusinessRow,
  ConversationSummary,
  ResourceRow,
} from "@/lib/api/types";
import type { UsageCounterRow, UsageEventRow } from "@/app/api/tenants/[tenantId]/usage/route";
import type { Entitlements } from "@/lib/entitlements/resolve";
import type { Currency } from "@/lib/format";

function StatCard({
  label,
  value,
  icon: Icon,
  href,
  subText,
}: {
  label: string;
  value: string | number;
  icon: typeof Inbox;
  href: string;
  subText?: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="transition-colors hover:border-ring">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {label}
          </CardTitle>
          <Icon className="size-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{value}</div>
          {subText && <p className="text-xs text-muted-foreground mt-1">{subText}</p>}
        </CardContent>
      </Card>
    </Link>
  );
}

export default function DashboardPage() {
  const { tenant } = useTenant();
  const { currency, formatCurrency } = useCurrency(tenant?.currency as Currency | undefined);
  const tenantId = tenant?.id ?? null;
  const base = tenantId ? `/api/tenants/${tenantId}` : null;

  const conv = useApi<{ conversations: ConversationSummary[] }>(base ? `${base}/conversations` : null);
  const agents = useApi<{ agents: AgentRow[] }>(base ? `${base}/agents` : null);
  const usage = useApi<{ counter: UsageCounterRow | null; events: UsageEventRow[] }>(base ? `${base}/usage` : null);
  const ent = useApi<{ entitlements: Entitlements }>(base ? `${base}/entitlements` : null);
  const bookingsApi = useApi<{ bookings: BookingRow[] }>(base ? `${base}/bookings` : null);

  const businessesApi = useApi<{ businesses: BusinessRow[] }>(base ? `${base}/businesses` : null);
  const servicesApi = useApi<{ services: AppointmentServiceRow[] }>(base ? `${base}/appointment-services` : null);
  const resourcesApi = useApi<{ resources: ResourceRow[] }>(base ? `${base}/resources` : null);
  const rulesApi = useApi<{ rules: AvailabilityRuleRow[] }>(base ? `${base}/availability-rules` : null);

  const loading =
    conv.loading ||
    agents.loading ||
    usage.loading ||
    ent.loading ||
    bookingsApi.loading ||
    businessesApi.loading ||
    servicesApi.loading ||
    resourcesApi.loading ||
    rulesApi.loading;

  const error =
    conv.error ??
    agents.error ??
    usage.error ??
    ent.error ??
    bookingsApi.error ??
    businessesApi.error ??
    servicesApi.error ??
    resourcesApi.error ??
    rulesApi.error;

  const conversations = conv.data?.conversations ?? [];
  const bookings = bookingsApi.data?.bookings ?? [];
  const agentList = agents.data?.agents ?? [];

  // Metrics calculation
  const nowISO = new Date().toISOString();
  const todayStr = new Date().toISOString().slice(0, 10);

  const todayBookings = bookings.filter((b) => b.start_time.startsWith(todayStr));
  const upcomingBookings = bookings.filter((b) => b.start_time >= nowISO && b.status !== "cancelled");
  const pendingBookings = bookings.filter((b) => b.status === "pending");
  const cancelledBookings = bookings.filter((b) => b.status === "cancelled");
  const aiHandledConversations = conversations.filter((c) => c.status === "active" || c.status === "completed");

  const setupStatus: SetupStepStatus = {
    hasBusiness: (businessesApi.data?.businesses ?? []).length > 0,
    hasResources: (resourcesApi.data?.resources ?? []).length > 0,
    hasServices: (servicesApi.data?.services ?? []).length > 0,
    hasRequirements: (servicesApi.data?.services ?? []).some((s) => Boolean(s.active_schema_id)),
    hasAvailability: (rulesApi.data?.rules ?? []).length > 0,
    hasAgent: agentList.length > 0,
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={tenant?.name ?? "Overview"}
        description="Multi-Tenant Schema-Driven WhatsApp AI Booking Engine"
      >
        <Button asChild size="sm">
          <Link href="/dashboard/bookings">
            <CalendarCheck className="size-4 mr-1.5" />
            Manage Bookings
          </Link>
        </Button>
        <Button asChild className="gap-2">
          <Link href="/dashboard/chat">
            <Sparkles className="h-4 w-4" />
            AI Co-pilot
          </Link>
        </Button>
      </PageHeader>

      {loading ? (
        <LoadingState rows={4} />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            conv.reload();
            agents.reload();
            usage.reload();
            ent.reload();
            bookingsApi.reload();
          }}
        />
      ) : (
        <>
          {/* Setup Progress */}
          <BookingSetupProgress status={setupStatus} />

          {/* Stats Bar */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              label="Today's Bookings"
              value={todayBookings.length}
              icon={CalendarCheck}
              href="/dashboard/bookings"
              subText={`${upcomingBookings.length} total upcoming`}
            />
            <StatCard
              label="Pending Approval"
              value={pendingBookings.length}
              icon={Clock}
              href="/dashboard/bookings"
              subText={`${cancelledBookings.length} cancelled`}
            />
            <StatCard
              label="Conversations Today"
              value={conversations.length}
              icon={Inbox}
              href="/dashboard/conversations"
              subText={`${aiHandledConversations.length} AI handled`}
            />
            <StatCard
              label="AI Agents Active"
              value={agentList.filter((a) => a.enabled).length}
              icon={Bot}
              href="/dashboard/agents"
              subText={`${agentList.length} total agents`}
            />
            <StatCard
              label="Cost This Period"
              value={formatCurrency(usage.data?.counter?.cost_usd ?? 0, 4)}
              icon={currency === "INR" ? IndianRupee : DollarSign}
              href="/dashboard/usage"
              subText={`${(usage.data?.counter?.tokens_used ?? 0).toLocaleString()} tokens`}
            />
          </div>

          {/* Main Content Grid */}
          <div className="grid gap-6 lg:grid-cols-5">
            {/* Upcoming Bookings Table */}
            <Card className="lg:col-span-3">
              <CardHeader className="flex flex-row items-center justify-between py-4">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <CalendarDays className="size-4 text-primary" />
                  Upcoming Bookings
                </CardTitle>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/dashboard/bookings">View all</Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-1 p-0">
                {upcomingBookings.length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      title="No upcoming bookings"
                      description="Bookings created via WhatsApp AI or manual entries will appear here."
                    />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead>Service</TableHead>
                        <TableHead>When</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {upcomingBookings.slice(0, 5).map((b) => (
                        <TableRow key={b.id}>
                          <TableCell className="font-medium text-xs">
                            {b.customer?.full_name ?? b.customer?.phone_number ?? "Guest"}
                          </TableCell>
                          <TableCell className="text-xs">{b.service?.name ?? "Booking"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDateTime(b.start_time)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={b.status === "confirmed" ? "default" : "secondary"}>
                              {b.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Recent Conversations */}
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between py-4">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <MessageSquare className="size-4 text-primary" />
                  Recent Conversations
                </CardTitle>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/dashboard/conversations">Inbox</Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-1">
                {conversations.length === 0 ? (
                  <EmptyState
                    title="No conversations"
                    description="Inbound customer WhatsApp messages will show up here."
                  />
                ) : (
                  conversations.slice(0, 5).map((c) => (
                    <Link
                      key={c.id}
                      href={`/dashboard/conversations/${c.id}`}
                      className="flex items-center justify-between gap-3 rounded-md px-3 py-2 transition-colors hover:bg-accent"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {c.contact?.full_name ?? c.contact?.phone_number ?? "Unknown"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.channel} · {formatDateTime(c.last_message_at ?? "")}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {c.unread_count > 0 ? (
                          <Badge variant="secondary">{c.unread_count} new</Badge>
                        ) : null}
                        {c.status === "needs_human" ? (
                          <Badge variant="destructive">Needs Human</Badge>
                        ) : (
                          <Badge variant="outline">AI</Badge>
                        )}
                      </div>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
