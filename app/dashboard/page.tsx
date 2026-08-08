"use client";

import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Coins,
  Inbox,
  MessageSquareWarning,
  Phone,
} from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import type { AgentRow, ConversationSummary, WaAccountRow } from "@/lib/api/types";
import type { UsageCounterRow, UsageEventRow } from "@/app/api/tenants/[tenantId]/usage/route";
import type { Entitlements } from "@/lib/entitlements/resolve";

function StatCard({
  label,
  value,
  icon: Icon,
  href,
}: {
  label: string;
  value: string | number;
  icon: typeof Inbox;
  href: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="transition-colors hover:border-ring">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
          <Icon className="size-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{value}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function DashboardPage() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const base = tenantId ? `/api/tenants/${tenantId}` : null;

  const conv = useApi<{ conversations: ConversationSummary[] }>(base ? `${base}/conversations` : null);
  const agents = useApi<{ agents: AgentRow[] }>(base ? `${base}/agents` : null);
  const wa = useApi<{ waAccounts: WaAccountRow[] }>(base ? `${base}/wa-accounts` : null);
  const usage = useApi<{ counter: UsageCounterRow | null; events: UsageEventRow[] }>(base ? `${base}/usage` : null);
  const ent = useApi<{ entitlements: Entitlements }>(base ? `${base}/entitlements` : null);

  const loading = conv.loading || agents.loading || wa.loading || usage.loading || ent.loading;
  const error = conv.error ?? agents.error ?? wa.error ?? usage.error ?? ent.error;

  const conversations = conv.data?.conversations ?? [];
  const unread = conversations.reduce((n, c) => n + (c.unread_count || 0), 0);
  const tokensUsed = usage.data?.counter?.tokens_used ?? 0;
  const budget = ent.data?.entitlements.tokenBudgetMonthly ?? 0;
  const budgetPct = budget > 0 ? Math.min(100, Math.round((tokensUsed / budget) * 100)) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={tenant?.name ?? "Dashboard"}
        description="Your AI workspace at a glance"
      >
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/conversations">
            Open inbox
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </PageHeader>

      {loading ? (
        <LoadingState rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => { conv.reload(); agents.reload(); wa.reload(); usage.reload(); ent.reload(); }} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Conversations" value={conversations.length} icon={Inbox} href="/dashboard/conversations" />
            <StatCard label="Unread" value={unread} icon={MessageSquareWarning} href="/dashboard/conversations" />
            <StatCard label="Agents" value={agents.data?.agents.length ?? 0} icon={Bot} href="/dashboard/agents" />
            <StatCard label="WhatsApp numbers" value={wa.data?.waAccounts.length ?? 0} icon={Phone} href="/dashboard/settings" />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Recent conversations</CardTitle>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/dashboard/conversations">View all</Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-1">
                {conversations.length === 0 ? (
                  <EmptyState title="No conversations yet" description="Inbound WhatsApp messages will show up here." />
                ) : (
                  conversations.slice(0, 5).map((c) => (
                    <Link
                      key={c.id}
                      href={`/dashboard/conversations/${c.id}`}
                      className="flex items-center justify-between gap-3 rounded-md px-3 py-2 transition-colors hover:bg-accent"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {c.contact?.full_name ?? c.contact?.phone_number ?? c.contact?.email ?? "Unknown"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.contact?.phone_number ?? c.contact?.email}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {c.unread_count > 0 ? (
                          <Badge variant="secondary">{c.unread_count} new</Badge>
                        ) : null}
                        {c.status === "needs_human" ? <Badge variant="destructive">needs human</Badge> : null}
                      </div>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Coins className="size-4" />
                  Monthly usage
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">Tokens used</span>
                    <span className="font-medium">
                      {tokensUsed.toLocaleString()} / {budget.toLocaleString()}
                    </span>
                  </div>
                  <Progress value={budgetPct} />
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-muted p-3">
                    <dt className="text-muted-foreground">Plan</dt>
                    <dd className="mt-0.5 font-medium">{ent.data?.entitlements.planId ? "Active plan" : "Free defaults"}</dd>
                  </div>
                  <div className="rounded-lg bg-muted p-3">
                    <dt className="text-muted-foreground">Enforcement</dt>
                    <dd className="mt-0.5 font-medium capitalize">{ent.data?.entitlements.enforcement ?? "hard"}</dd>
                  </div>
                </dl>
                {ent.data?.entitlements.allowedAgentTypes?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {ent.data.entitlements.allowedAgentTypes.map((t) => (
                      <Badge key={t} variant="outline">{t}</Badge>
                    ))}
                  </div>
                ) : null}
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href="/dashboard/usage">View usage details</Link>
                </Button>
              </CardContent>
            </Card>
          </div>

          <div>
            <h2 className="mb-3 text-base font-medium">Agents</h2>
            {agents.loading ? (
              <Skeleton className="h-20 w-full" />
            ) : (agents.data?.agents.length ?? 0) === 0 ? (
              <EmptyState title="No agents yet" description="Create an agent to start replying automatically." />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {agents.data!.agents.map((a) => (
                  <Link key={a.id} href={`/dashboard/agents/${a.id}`}>
                    <Card className="h-full transition-colors hover:border-ring">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Bot className="size-4 text-muted-foreground" />
                            <p className="font-medium">{a.name}</p>
                          </div>
                          <Badge variant={a.enabled ? "default" : "secondary"}>
                            {a.enabled ? "enabled" : "disabled"}
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{a.type}</p>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
