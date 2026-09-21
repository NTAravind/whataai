"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, XCircle, Clock } from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErrorState, EmptyState, LoadingState } from "@/components/data-state";
import { formatDateTime } from "@/lib/format";
import type { AutomationRow, AutomationRunRow } from "@/lib/api/types";

export default function AutomationRunsPage() {
  const { tenantId } = useTenant();
  const params = useParams<{ id: string }>();
  const base = tenantId ? `/api/tenants/${tenantId}` : null;

  const automation = useApi<{ automation: AutomationRow }>(
    base ? `${base}/automations/${params.id}` : null,
  );
  const runs = useApi<{ runs: AutomationRunRow[] }>(
    base ? `${base}/automations/${params.id}/runs` : null,
  );

  const [expanded, setExpanded] = useState<string | null>(null);
  const list = runs.data?.runs ?? [];

  const statusBadge = (status: AutomationRunRow["status"]) => {
    if (status === "completed")
      return (
        <Badge className="bg-emerald-600 text-white">
          <CheckCircle2 className="size-3" />
          Completed
        </Badge>
      );
    if (status === "running")
      return (
        <Badge variant="secondary">
          <Clock className="size-3 animate-pulse" />
          Running
        </Badge>
      );
    return (
      <Badge variant="destructive">
        <XCircle className="size-3" />
        Failed
      </Badge>
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={`Run history${automation.data?.automation ? ` — ${automation.data.automation.name}` : ""}`}
        description="Every execution of this automation, with per-step results."
      >
        <Button asChild variant="outline" size="sm">
          <Link href={`/dashboard/automations`}>
            <ArrowLeft className="size-4" />
            Back to automations
          </Link>
        </Button>
      </PageHeader>

      {runs.loading ? (
        <LoadingState rows={4} />
      ) : runs.error ? (
        <ErrorState message={runs.error} onRetry={runs.reload} />
      ) : list.length === 0 ? (
        <EmptyState
          title="No runs yet"
          description="Runs appear here the first time this automation triggers. Manual automations can be run from a conversation."
        />
      ) : (
        <div className="space-y-3">
          {list.map((run) => (
            <div key={run.id} className="overflow-hidden rounded-xl border bg-card">
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
                onClick={() => setExpanded(expanded === run.id ? null : run.id)}
              >
                {expanded === run.id ? (
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {statusBadge(run.status)}
                    {run.contact ? (
                      <span className="text-sm">
                        {run.contact.full_name ?? run.contact.phone_number ?? "Contact"}
                      </span>
                    ) : (
                      <Badge variant="outline">No contact</Badge>
                    )}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">{formatDateTime(run.started_at)}</span>
                {run.durationMs != null ? (
                  <span className="text-xs text-muted-foreground">{Math.round(run.durationMs)}ms</span>
                ) : null}
              </button>
              {expanded === run.id ? (
                <div className="border-t bg-muted/30 px-4 py-3">
                  {run.error ? (
                    <p className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
                      {run.error}
                    </p>
                  ) : null}
                  <p className="rounded-lg border bg-card p-3 text-sm">
                    {run.steps_count} step{run.steps_count === 1 ? "" : "s"} executed — per-step output is not
                    retained in run history.
                  </p>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {automation.data?.automation?.trigger_type === "manual" ? (
        <p className="text-xs text-muted-foreground">
          Tip: this is a manual automation — trigger it on demand from the customer’s conversation.
        </p>
      ) : null}
    </div>
  );
}