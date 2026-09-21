"use client";

import Link from "next/link";
import { toast } from "sonner";
import {
  Copy,
  History,
  Pencil,
  Plug,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ErrorState, EmptyState, LoadingState } from "@/components/data-state";
import { formatDateTime } from "@/lib/format";
import type { AutomationRow } from "@/lib/api/types";

const TRIGGER_LABELS: Record<string, string> = {
  after_agent_reply: "After agent reply",
  on_tool_call: "On tool call",
  ai_capture: "AI field capture",
  manual: "Manual",
};

export default function AutomationsPage() {
  const { tenantId } = useTenant();
  const base = tenantId ? `/api/tenants/${tenantId}` : null;

  const automations = useApi<{ automations: AutomationRow[] }>(
    base ? `${base}/automations` : null,
  );

  const list = automations.data?.automations ?? [];

  async function toggle(automation: AutomationRow) {
    if (!tenantId) return;
    const wasActive = automation.is_active;
    try {
      await api(`${base}/automations/${automation.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !wasActive }),
      });
      toast.success(wasActive ? "Automation paused" : "Automation activated");
      automations.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update automation");
    }
  }

  async function duplicate(automation: AutomationRow) {
    if (!tenantId) return;
    try {
      const res = await api<{ automation: AutomationRow }>(
        `${base}/automations/${automation.id}/duplicate`,
        { method: "POST" },
      );
      toast.success(`Copied as “${res.automation.name}”`);
      automations.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to duplicate automation");
    }
  }

  async function remove(automation: AutomationRow) {
    if (!tenantId) return;
    try {
      await api(`${base}/automations/${automation.id}`, { method: "DELETE" });
      toast.success("Automation deleted");
      automations.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete automation");
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Automations"
        description="Chain steps that fire after an agent reply, a tool call, an AI field capture, or manually."
      >
        <Button asChild variant="outline" size="sm">
          <Link href={`/dashboard/automations/integrations`}>
            <Plug className="size-4" />
            Integrations
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href={`/dashboard/automations/new`}>
            <Plus className="size-4" />
            New automation
          </Link>
        </Button>
      </PageHeader>

      {automations.loading ? (
        <LoadingState rows={5} />
      ) : automations.error ? (
        <ErrorState message={automations.error} onRetry={automations.reload} />
      ) : list.length === 0 ? (
        <EmptyState
          title="No automations yet"
          description="Create your first automation — e.g. capture a customer’s email after the agent replies, then push it to your CRM."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-44" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((a) => {
                const triggerDetail =
                  a.trigger_type === "on_tool_call"
                    ? String((a.trigger_config as { tool_name?: string }).tool_name ?? "")
                    : a.trigger_type === "ai_capture"
                      ? `${((a.trigger_config as { fields?: unknown[] }).fields ?? []).length} field(s)`
                      : "";
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      <Link href={`/dashboard/automations/${a.id}`} className="hover:underline">
                        {a.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{TRIGGER_LABELS[a.trigger_type]}</Badge>
                      {triggerDetail ? (
                        <span className="ml-2 font-mono text-xs text-muted-foreground">{triggerDetail}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.steps.length}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={a.is_active}
                          onCheckedChange={() => toggle(a)}
                          aria-label={`Toggle ${a.name}`}
                        />
                        <span className="text-xs text-muted-foreground">
                          {a.is_active ? "Active" : "Paused"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(a.updated_at)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button asChild variant="ghost" size="icon" className="size-8">
                          <Link href={`/dashboard/automations/${a.id}`} aria-label="Edit">
                            <Pencil className="size-4" />
                          </Link>
                        </Button>
                        <Button asChild variant="ghost" size="icon" className="size-8">
                          <Link href={`/dashboard/automations/${a.id}/runs`} aria-label="Run history">
                            <History className="size-4" />
                          </Link>
                        </Button>
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => duplicate(a)}>
                          <Copy className="size-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8 text-destructive">
                              <Trash2 className="size-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete “{a.name}”?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {a.trigger_type === "manual" ? (
                                  <>
                                    <Zap className="mb-2 size-4 text-muted-foreground" />
                                    This does not run right now since manual automations trigger on demand.
                                    Run history is deleted with it.
                                  </>
                                ) : (
                                  "It will stop firing immediately and its run history will be deleted."
                                )}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => remove(a)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}