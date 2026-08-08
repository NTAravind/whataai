"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { formatDateTime } from "@/lib/format";

interface TenantRow {
  id: string;
  name: string;
  status: string;
  created_at: string;
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
interface TenantDetail extends TenantRow {
  members: TenantMember[];
  subscription: Subscription | null;
}

const STATUSES = ["active", "suspended", "archived"] as const;

function StatusBadge({ status }: { status: string }) {
  const variant = status === "active" ? "default" : status === "suspended" ? "destructive" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

export default function TenantsAdminPage() {
  const tenants = useApi<{ tenants: TenantRow[] }>("/api/admin/tenants");

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [status, setStatus] = useState("active");
  const [creating, setCreating] = useState(false);

  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState("active");
  const [saving, setSaving] = useState(false);

  async function create() {
    setCreating(true);
    try {
      await api("/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), status }),
      });
      toast.success("Tenant created");
      setCreateOpen(false);
      setName("");
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
      const res = await api<{ tenant: TenantDetail }>(`/api/admin/tenants/${detail.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: editName.trim(), status: editStatus }),
      });
      setDetail(res.tenant);
      setEditOpen(false);
      toast.success("Tenant updated");
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
      tenants.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete tenant");
    }
  }

  const list = tenants.data?.tenants ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Tenants" description="Every workspace on the platform">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          New tenant
        </Button>
      </PageHeader>

      {tenants.loading ? (
        <LoadingState rows={5} />
      ) : tenants.error ? (
        <ErrorState message={tenants.error} onRetry={tenants.reload} />
      ) : list.length === 0 ? (
        <EmptyState title="No tenants" description="Create the first tenant to get started." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((t) => (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => openDetail(t)}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell><StatusBadge status={t.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(t.created_at)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => {
                          setDetail({ ...t, members: [], subscription: null });
                          setEditName(t.name);
                          setEditStatus(t.status);
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
                              This permanently deletes “{t.name}” and all of its data — conversations,
                              agents, accounts, and more. This cannot be undone.
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

      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setDetail(null)}>
          <div
            className="h-full w-full max-w-md overflow-y-auto border-l bg-background p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="size-5" />
                <h2 className="text-lg font-semibold">{detail.name}</h2>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setDetail(null)}>Close</Button>
            </div>

            {detailLoading ? (
              <div className="space-y-3">
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Status</p>
                  <StatusBadge status={detail.status} />
                  <p className="pt-2 text-xs text-muted-foreground">Created {formatDateTime(detail.created_at)}</p>
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-muted-foreground">Subscription</p>
                  {detail.subscription ? (
                    <div className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{detail.subscription.plan_id.slice(0, 8)}</span>
                        <StatusBadge status={detail.subscription.status} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Since {formatDateTime(detail.subscription.starts_at)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No active subscription.</p>
                  )}
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-muted-foreground">Members ({detail.members.length})</p>
                  <div className="space-y-2">
                    {detail.members.map((m) => (
                      <div key={m.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                        <span className="font-mono text-xs">{m.user_id}</span>
                        <Badge variant="secondary">{m.role}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create tenant</DialogTitle>
            <DialogDescription>A tenant is a workspace with its own agents, accounts, and usage.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tenant-name">Name</Label>
              <Input id="tenant-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc." />
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={creating || !name.trim()}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit tenant</DialogTitle>
            <DialogDescription>Update the tenant name or status.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving || !editName.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
