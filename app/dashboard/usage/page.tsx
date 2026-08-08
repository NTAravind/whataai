"use client";

import { Coins, Gauge } from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState, EmptyState, LoadingState } from "@/components/data-state";
import { formatDateTime } from "@/lib/format";
import type { UsageCounterRow, UsageEventRow } from "@/app/api/tenants/[tenantId]/usage/route";
import type { Entitlements } from "@/lib/entitlements/resolve";

export default function UsagePage() {
  const { tenantId } = useTenant();
  const base = tenantId ? `/api/tenants/${tenantId}` : null;

  const usage = useApi<{ counter: UsageCounterRow | null; events: UsageEventRow[] }>(base ? `${base}/usage` : null);
  const ent = useApi<{ entitlements: Entitlements }>(base ? `${base}/entitlements` : null);

  const loading = usage.loading || ent.loading;
  const error = usage.error ?? ent.error;

  const counter = usage.data?.counter;
  const events = usage.data?.events ?? [];
  const budget = ent.data?.entitlements.tokenBudgetMonthly ?? 0;
  const tokensUsed = counter?.tokens_used ?? 0;
  const pct = budget > 0 ? Math.min(100, Math.round((tokensUsed / budget) * 100)) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Usage" description="Token consumption and cost for this tenant" />

      {loading ? (
        <LoadingState rows={4} />
      ) : error ? (
        <ErrorState message={error} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Coins className="size-4" />
                  Tokens this period
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold">{tokensUsed.toLocaleString()}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  of {budget.toLocaleString()} monthly budget
                </p>
                <Progress className="mt-3" value={pct} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gauge className="size-4" />
                  Enforcement
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Mode</span>
                  <Badge variant={ent.data?.entitlements.enforcement === "hard" ? "destructive" : "secondary"}>
                    {ent.data?.entitlements.enforcement ?? "hard"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Allowed agent types</span>
                  <span>{ent.data?.entitlements.allowedAgentTypes.join(", ") ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Allowed channels</span>
                  <span>{ent.data?.entitlements.allowedChannels.join(", ") ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Model tier</span>
                  <span>{ent.data?.entitlements.model}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent usage events</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {events.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No usage events yet" description="Token usage is recorded once the agent replies." />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead className="text-right">Prompt</TableHead>
                      <TableHead className="text-right">Completion</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-muted-foreground">{formatDateTime(e.created_at)}</TableCell>
                        <TableCell>{e.model ?? "—"}</TableCell>
                        <TableCell className="text-right">{e.prompt_tokens}</TableCell>
                        <TableCell className="text-right">{e.completion_tokens}</TableCell>
                        <TableCell className="text-right font-medium">{e.total_tokens}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
