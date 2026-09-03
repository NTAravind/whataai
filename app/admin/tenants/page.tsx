"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Building2, Mail, Pencil, Plus, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Progress } from "@/components/ui/progress";
import { formatDateTime, formatCurrency } from "@/lib/format";
interface TenantRow {
  id: string;
  name: string;
  status: string;
  owner_email: string | null;
  created_at: string;
  max_businesses: number | null;
  token_budget_topup: number;
}
interface PlanRow {
  id: string;
  name: string;
  is_active: boolean;
  limits: Record<string, unknown>;
}
interface TenantMember {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
}
interface Subscription {
  id: string;
  plan_id: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
}
interface TenantUsage {
  tokens_used: number;
  cost_usd: number;
}
interface TenantDetail extends TenantRow {
  members: TenantMember[];
  subscription: Subscription | null;
  usage: TenantUsage | null;
}

const EDIT_STATUSES = ["active", "suspended", "archived"] as const;

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  active: "default",
  suspended: "destructive",
  archived: "secondary",
};

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>{status}</Badge>;
}

export default function TenantsAdminPage() {
  const tenants = useApi<{ tenants: TenantRow[] }>("/api/admin/tenants");
  const plans = useApi<{ plans: PlanRow[] }>("/api/admin/plans?active=true");

  // ── Create dialog state ──────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPlanId, setNewPlanId] = useState("");
  const [creating, setCreating] = useState(false);

  // ── Detail side panel state ──────────────────────────────────────────────
  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // ── Edit dialog state ────────────────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState("active");
  const [editMaxBusinesses, setEditMaxBusinesses] = useState("");
  const [editTopup, setEditTopup] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Active plans list ────────────────────────────────────────────────────
  const activePlans = (plans.data?.plans ?? []).filter((p) => p.is_active);
  const planName = (id: string) => activePlans.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  // ── Handlers ─────────────────────────────────────────────────────────────
  async function create() {
    if (!newName.trim() || !newEmail.trim() || !newPlanId) return;
    setCreating(true);
    try {
      const res = await api<{ tenant: TenantDetail, inviteLink?: string }>("/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim(),
          owner_email: newEmail.trim(),
          plan_id: newPlanId,
        }),
      });
      if (res.inviteLink) {
        toast.warning(
          "Tenant created, but email rate limits were hit. Send this link to the owner:",
          { description: res.inviteLink, duration: 15000 }
        );
      } else {
        toast.success("Tenant created — invite email sent to owner");
      }
      setCreateOpen(false);
      setNewName("");
      setNewEmail("");
      setNewPlanId("");
      tenants.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create tenant");
    } finally {
      setCreating(false);
    }
  }

  async function openDetail(t: TenantRow) {
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await api<{ tenant: TenantDetail }>(`/api/admin/tenants/${t.id}`);
      setDetail(res.tenant);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load tenant");
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveEdit() {
    if (!detail) return;
    setSaving(true);
    try {
      const parsedLimit = editMaxBusinesses.trim() === "" ? null : parseInt(editMaxBusinesses, 10);
      const parsedTopup = editTopup.trim() === "" ? 0 : parseInt(editTopup, 10);
      await api(`/api/admin/tenants/${detail.id}`, {
        method: "PATCH",
        body: JSON.stringify({ 
          name: editName.trim(), 
          status: editStatus,
          max_businesses: parsedLimit,
          token_budget_topup: parsedTopup,
        }),
      });
      setEditOpen(false);
      toast.success("Tenant updated");
      await openDetail(detail);
      tenants.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update tenant");
    } finally {
      setSaving(false);
    }
  }

  async function remove(t: TenantRow) {
    try {
      await api(`/api/admin/tenants/${t.id}`, { method: "DELETE" });
      toast.success("Tenant deleted");
      if (detail?.id === t.id) setDetail(null);
      tenants.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete tenant");
    }
  }

  const list = tenants.data?.tenants ?? [];
  const canCreate = !!newName.trim() && !!newEmail.trim() && !!newPlanId;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Tenants" description="Every customer workspace on the platform">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          New tenant
        </Button>
      </PageHeader>

      {/* ── Tenant table ─────────────────────────────────────────────────── */}
      {tenants.loading ? (
        <LoadingState rows={5} />
      ) : tenants.error ? (
        <ErrorState message={tenants.error} onRetry={tenants.reload} />
      ) : list.length === 0 ? (
        <EmptyState
          title="No tenants yet"
          description="Create the first tenant — they'll receive a magic-link invite to set up their account."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((t) => (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => openDetail(t)}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {t.owner_email ?? <span className="italic opacity-50">none</span>}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={t.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(t.created_at)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => {
                          setDetail({ ...t, members: [], subscription: null, usage: null });
                          setEditName(t.name);
                          setEditStatus(t.status);
                          setEditMaxBusinesses(t.max_businesses === null ? "" : String(t.max_businesses));
                          setEditTopup(t.token_budget_topup === 0 ? "" : String(t.token_budget_topup));
                          setEditOpen(true);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8 text-destructive">
                            <Trash2 className="size-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete tenant?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently deletes &quot;{t.name}&quot; and all of its data —
                              conversations, agents, accounts, and more. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => remove(t)}>Delete</AlertDialogAction>
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

      {/* ── Detail side panel ────────────────────────────────────────────── */}
      {(detail || detailLoading) && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40"
          onClick={() => { setDetail(null); setDetailLoading(false); }}
        >
          <div
            className="h-full w-full max-w-md overflow-y-auto border-l bg-background p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="size-5" />
                <h2 className="text-lg font-semibold">{detail?.name ?? "Loading…"}</h2>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setDetail(null); setDetailLoading(false); }}>
                Close
              </Button>
            </div>

            {detailLoading ? (
              <div className="space-y-3">
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              </div>
            ) : detail ? (
              <div className="space-y-6">
                {/* Status + dates */}
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Status</p>
                  <StatusBadge status={detail.status} />
                  <p className="pt-1 text-xs text-muted-foreground">
                    Created {formatDateTime(detail.created_at)}
                  </p>
                </div>

                {/* Owner */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Owner</p>
                  {detail.owner_email ? (
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="size-3.5 text-muted-foreground" />
                      <span>{detail.owner_email}</span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No owner set</p>
                  )}
                </div>

                {/* Limits */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Limits</p>
                  <p className="text-sm">
                    {detail.max_businesses === null ? "Unlimited businesses" : `Max ${detail.max_businesses} business${detail.max_businesses === 1 ? "" : "es"}`}
                  </p>
                </div>

                {/* Subscription */}
                <div>
                  <p className="mb-2 text-sm font-medium text-muted-foreground">Subscription</p>
                  {detail.subscription ? (
                    <div className="rounded-lg border p-3 text-sm space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{planName(detail.subscription.plan_id)}</span>
                        <StatusBadge status={detail.subscription.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Since {formatDateTime(detail.subscription.starts_at)}
                        {detail.subscription.ends_at
                          ? ` · Ends ${formatDateTime(detail.subscription.ends_at)}`
                          : ""}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No active subscription.</p>
                  )}
                </div>

                {/* Usage */}
                {(() => {
                  let baseLimit = 100000;
                  if (detail.subscription) {
                    const p = activePlans.find((x) => x.id === detail.subscription?.plan_id);
                    if (p && p.limits && typeof p.limits.token_budget_monthly === "number") {
                      baseLimit = p.limits.token_budget_monthly;
                    }
                  }
                  const effectiveLimit = baseLimit + detail.token_budget_topup;
                  const tokensUsed = detail.usage?.tokens_used ?? 0;
                  const costUsd = detail.usage?.cost_usd ?? 0;
                  const pct = effectiveLimit > 0 ? Math.min(100, Math.round((tokensUsed / effectiveLimit) * 100)) : 0;

                  return (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-muted-foreground">Usage this period</p>
                      <div className="rounded-lg border p-3 space-y-3 text-sm">
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Tokens</span>
                          <span className="font-medium">
                            {tokensUsed.toLocaleString()} / {effectiveLimit.toLocaleString()}
                          </span>
                        </div>
                        <Progress value={pct} className="h-2" />
                        <div className="flex justify-between items-center text-xs text-muted-foreground">
                          <span>Base: {baseLimit.toLocaleString()}</span>
                          {detail.token_budget_topup > 0 && (
                            <span className="text-primary font-medium">+{detail.token_budget_topup.toLocaleString()} top-up</span>
                          )}
                        </div>
                        <div className="pt-2 border-t flex justify-between items-center">
                          <span className="text-muted-foreground">Total cost</span>
                          <span className="font-medium">{formatCurrency(costUsd, "USD", 4)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Members */}
                <div>
                  <p className="mb-2 text-sm font-medium text-muted-foreground">
                    Members ({detail.members?.length ?? 0})
                  </p>
                  {(detail.members?.length ?? 0) === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No members yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {detail.members?.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                        >
                          <span className="font-mono text-xs">{m.user_id}</span>
                          <Badge variant="secondary">{m.role}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Edit button */}
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => {
                    setEditName(detail.name);
                    setEditStatus(detail.status);
                    setEditMaxBusinesses(detail.max_businesses === null ? "" : String(detail.max_businesses));
                    setEditTopup(detail.token_budget_topup === 0 ? "" : String(detail.token_budget_topup));
                    setEditOpen(true);
                  }}
                >
                  <Pencil className="size-4" />
                  Edit tenant
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Create Tenant dialog ──────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New tenant</DialogTitle>
            <DialogDescription>
              The owner will receive a magic-link invite email to activate their account. A
              subscription is required to complete setup.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tenant-name">Tenant name</Label>
              <Input
                id="tenant-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Acme Inc."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner-email">Owner email</Label>
              <Input
                id="owner-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="owner@acme.com"
              />
              <p className="text-xs text-muted-foreground">
                They&apos;ll get a magic-link invite. God-user emails are blocked.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Plan</Label>
              {plans.loading ? (
                <div className="h-9 animate-pulse rounded-md bg-muted" />
              ) : (
                <Select value={newPlanId} onValueChange={setNewPlanId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {activePlans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs text-muted-foreground">
                A subscription will be created automatically.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={creating || !canCreate}>
              {creating ? "Creating…" : "Create & invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Tenant dialog ────────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit tenant</DialogTitle>
            <DialogDescription>Update the tenant name or status.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDIT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-max-businesses">Max businesses</Label>
              <Input
                id="edit-max-businesses"
                type="number"
                placeholder="Unlimited"
                value={editMaxBusinesses}
                onChange={(e) => setEditMaxBusinesses(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty for unlimited.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-topup">Extra token top-up</Label>
              <Input
                id="edit-topup"
                type="number"
                placeholder="0"
                value={editTopup}
                onChange={(e) => setEditTopup(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Tokens added on top of the plan&apos;s base limit.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving || !editName.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
