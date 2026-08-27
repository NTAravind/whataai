"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Ban, Plus, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

interface TenantRow {
  id: string;
  name: string;
  status: string;
}
interface PlanRow {
  id: string;
  name: string;
  is_active: boolean;
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

const STATUSES = ["active", "trialing", "past_due", "canceled", "expired"] as const;

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  active: "default",
  trialing: "secondary",
  canceled: "secondary",
  expired: "secondary",
  past_due: "destructive",
};

export default function SubscriptionsAdminPage() {
  const subs = useApi<{ subscriptions: SubscriptionRow[] }>("/api/admin/subscriptions");
  const tenants = useApi<{ tenants: TenantRow[] }>("/api/admin/tenants");
  const plans = useApi<{ plans: PlanRow[] }>("/api/admin/plans");

  const [open, setOpen] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [planId, setPlanId] = useState("");
  const [status, setStatus] = useState("active");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);

  const tenantName = (id: string) => tenants.data?.tenants.find((t) => t.id === id)?.name ?? id.slice(0, 8);
  const planName = (id: string) => plans.data?.plans.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  async function create() {
    if (!tenantId || !planId) return;
    setBusy(true);
    try {
      await api("/api/admin/subscriptions", {
        method: "POST",
        body: JSON.stringify({ tenant_id: tenantId, plan_id: planId, status, ends_at: endsAt || null }),
      });
      toast.success("Subscription created");
      setOpen(false);
      setTenantId("");
      setPlanId("");
      subs.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create subscription");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(s: SubscriptionRow) {
    try {
      await api(`/api/admin/subscriptions/${s.id}?cancel=true`, { method: "DELETE" });
      toast.success("Subscription canceled");
      subs.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel subscription");
    }
  }

  async function remove(s: SubscriptionRow) {
    try {
      await api(`/api/admin/subscriptions/${s.id}`, { method: "DELETE" });
      toast.success("Subscription deleted");
      subs.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete subscription");
    }
  }

  const loading = subs.loading || tenants.loading || plans.loading;
  const error = subs.error ?? tenants.error ?? plans.error;
  const list = subs.data?.subscriptions ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Subscriptions" description="Which tenant is on which plan">
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Assign plan
        </Button>
      </PageHeader>

      {loading ? (
        <LoadingState rows={4} />
      ) : error ? (
        <ErrorState message={error} />
      ) : list.length === 0 ? (
        <EmptyState title="No subscriptions" description="Assign a plan to a tenant to get started." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Ends</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{tenantName(s.tenant_id)}</TableCell>
                  <TableCell>{planName(s.plan_id)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[s.status] ?? "secondary"}>{s.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(s.starts_at)}</TableCell>
                  <TableCell className="text-muted-foreground">{s.ends_at ? formatDateTime(s.ends_at) : "—"}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {s.status === "active" || s.status === "trialing" ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8">
                              <Ban className="size-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
                              <AlertDialogDescription>
                                The tenant keeps access until the current period ends.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Keep active</AlertDialogCancel>
                              <AlertDialogAction onClick={() => cancel(s)}>Cancel</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8 text-destructive">
                            <Trash2 className="size-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete subscription?</AlertDialogTitle>
                            <AlertDialogDescription>This removes the record entirely.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => remove(s)}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign a plan</DialogTitle>
            <DialogDescription>Creates a subscription for a tenant.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tenant</Label>
              <Select value={tenantId} onValueChange={setTenantId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select tenant" />
                </SelectTrigger>
                <SelectContent>
                  {(tenants.data?.tenants ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Plan</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select plan" />
                </SelectTrigger>
                <SelectContent>
                  {(plans.data?.plans ?? []).filter((p) => p.is_active).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sub-ends">Ends at (optional)</Label>
              <input
                id="sub-ends"
                type="datetime-local"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={busy || !tenantId || !planId}>
              {busy ? "Creating…" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
