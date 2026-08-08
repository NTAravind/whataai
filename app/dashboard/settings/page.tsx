"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Building2, Plus, Phone, Pencil, Trash2, Users } from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useAuth } from "@/components/providers/auth-provider";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import type { BusinessRow, MemberRow, WaAccountRow } from "@/lib/api/types";

const MEMBER_ROLES = ["owner", "admin", "member"] as const;

function useCrud<T>(base: string | null, key: string) {
  return useApi<{ [k: string]: T[] }>(base ? `${base}/${key}` : null);
}

export default function SettingsPage() {
  const { tenantId } = useTenant();
  const { user, roles } = useAuth();
  const base = tenantId ? `/api/tenants/${tenantId}` : null;

  const businesses = useCrud<BusinessRow>(base, "businesses");
  const wa = useCrud<WaAccountRow>(base, "wa-accounts");
  const members = useCrud<MemberRow>(base, "members");

  const myRole = tenantId ? roles[tenantId] : undefined;
  const canManage = myRole === "owner" || myRole === "admin";

  const loading = businesses.loading || wa.loading || members.loading;
  const error = businesses.error ?? wa.error ?? members.error;

  const businessList = businesses.data?.businesses ?? [];
  const waList = wa.data?.waAccounts ?? [];
  const memberList = members.data?.members ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Settings" description="Businesses, WhatsApp accounts, and team members" />

      {loading ? (
        <LoadingState rows={3} />
      ) : error ? (
        <ErrorState message={error} />
      ) : (
        <Tabs defaultValue="businesses">
          <TabsList>
            <TabsTrigger value="businesses">
              <Building2 className="size-3.5" />
              Businesses
            </TabsTrigger>
            <TabsTrigger value="wa-accounts">
              <Phone className="size-3.5" />
              WhatsApp accounts
            </TabsTrigger>
            <TabsTrigger value="members">
              <Users className="size-3.5" />
              Members
            </TabsTrigger>
          </TabsList>

          <TabsContent value="businesses" className="space-y-4">
            <BusinessesTab
              items={businessList}
              tenantId={tenantId}
              canManage={canManage}
              onChanged={businesses.reload}
            />
          </TabsContent>

          <TabsContent value="wa-accounts" className="space-y-4">
            <WaAccountsTab
              items={waList}
              tenantId={tenantId}
              canManage={canManage}
              onChanged={wa.reload}
            />
          </TabsContent>

          <TabsContent value="members" className="space-y-4">
            <MembersTab
              items={memberList}
              tenantId={tenantId}
              currentUserId={user?.id}
              canManage={canManage}
              onChanged={members.reload}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function BusinessesTab({
  items,
  tenantId,
  canManage,
  onChanged,
}: {
  items: BusinessRow[];
  tenantId: string | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BusinessRow | null>(null);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [busy, setBusy] = useState(false);

  function startEdit(b: BusinessRow) {
    setEditing(b);
    setName(b.name);
    setIndustry(b.industry ?? "");
    setTimezone(b.timezone);
    setOpen(true);
  }

  function startCreate() {
    setEditing(null);
    setName("");
    setIndustry("");
    setTimezone("America/Los_Angeles");
    setOpen(true);
  }

  async function save() {
    if (!tenantId || !name.trim()) return;
    setBusy(true);
    try {
      if (editing) {
        await api(`/api/tenants/${tenantId}/businesses/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: name.trim(), industry: industry || null, timezone }),
        });
      } else {
        await api(`/api/tenants/${tenantId}/businesses`, {
          method: "POST",
          body: JSON.stringify({ name: name.trim(), industry: industry || null, timezone }),
        });
      }
      toast.success(editing ? "Business updated" : "Business created");
      setOpen(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save business");
    } finally {
      setBusy(false);
    }
  }

  async function remove(b: BusinessRow) {
    if (!tenantId) return;
    try {
      await api(`/api/tenants/${tenantId}/businesses/${b.id}`, { method: "DELETE" });
      toast.success("Business deleted");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete business");
    }
  }

  return (
    <>
      {canManage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={startCreate}>
            <Plus className="size-4" />
            Add business
          </Button>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState title="No businesses" description="Add a business to represent this tenant." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Timezone</TableHead>
                <TableHead>Created</TableHead>
                {canManage && <TableHead className="w-24" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell>{b.industry ?? "—"}</TableCell>
                  <TableCell>{b.timezone}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(b.created_at)}</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => startEdit(b)}>
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
                              <AlertDialogTitle>Delete business?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes “{b.name}” and its data. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => remove(b)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit business" : "Add business"}</DialogTitle>
            <DialogDescription>Set the details used across WhatsApp and Mail channels.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="biz-name">Name</Label>
              <Input id="biz-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="biz-industry">Industry</Label>
              <Input id="biz-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. E-commerce" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="biz-tz">Timezone</Label>
              <Input id="biz-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy || !name.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function WaAccountsTab({
  items,
  tenantId,
  canManage,
  onChanged,
}: {
  items: WaAccountRow[];
  tenantId: string | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WaAccountRow | null>(null);
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [displayPhone, setDisplayPhone] = useState("");
  const [baId, setBaId] = useState("");
  const [status, setStatus] = useState("connected");
  const [busy, setBusy] = useState(false);

  function startEdit(a: WaAccountRow) {
    setEditing(a);
    setPhoneNumberId(a.wa_phone_number_id);
    setDisplayPhone(a.display_phone_number);
    setBaId(a.wa_business_account_id);
    setStatus(a.status);
    setOpen(true);
  }

  function startCreate() {
    setEditing(null);
    setPhoneNumberId("");
    setDisplayPhone("");
    setBaId("");
    setStatus("connected");
    setOpen(true);
  }

  async function save() {
    if (!tenantId || !phoneNumberId.trim() || !displayPhone.trim() || !baId.trim()) return;
    setBusy(true);
    try {
      const body = { wa_phone_number_id: phoneNumberId.trim(), display_phone_number: displayPhone.trim(), wa_business_account_id: baId.trim(), status };
      if (editing) {
        await api(`/api/tenants/${tenantId}/wa-accounts/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await api(`/api/tenants/${tenantId}/wa-accounts`, { method: "POST", body: JSON.stringify(body) });
      }
      toast.success(editing ? "WhatsApp account updated" : "WhatsApp account added");
      setOpen(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save WhatsApp account");
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: WaAccountRow) {
    if (!tenantId) return;
    try {
      await api(`/api/tenants/${tenantId}/wa-accounts/${a.id}`, { method: "DELETE" });
      toast.success("WhatsApp account removed");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove WhatsApp account");
    }
  }

  return (
    <>
      {canManage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={startCreate}>
            <Plus className="size-4" />
            Add account
          </Button>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState title="No WhatsApp accounts" description="Connect a Meta WhatsApp Business phone number." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phone number</TableHead>
                <TableHead>Phone number ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                {canManage && <TableHead className="w-24" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.display_phone_number}</TableCell>
                  <TableCell className="font-mono text-xs">{a.wa_phone_number_id}</TableCell>
                  <TableCell>
                    <Badge variant={a.status === "connected" ? "default" : "secondary"}>{a.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(a.created_at)}</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => startEdit(a)}>
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
                              <AlertDialogTitle>Remove account?</AlertDialogTitle>
                              <AlertDialogDescription>
                                “{a.display_phone_number}” will stop receiving messages through Whataai.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => remove(a)}>Remove</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit WhatsApp account" : "Add WhatsApp account"}</DialogTitle>
            <DialogDescription>Enter the IDs from your Meta WhatsApp Business Manager.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wa-phone">Display phone number</Label>
              <Input id="wa-phone" value={displayPhone} onChange={(e) => setDisplayPhone(e.target.value)} placeholder="+1 555 000 1234" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wa-phone-id">Phone number ID</Label>
              <Input id="wa-phone-id" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wa-ba-id">WABA ID</Label>
              <Input id="wa-ba-id" value={baId} onChange={(e) => setBaId(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="connected">connected</SelectItem>
                  <SelectItem value="disconnected">disconnected</SelectItem>
                  <SelectItem value="pending">pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy || !phoneNumberId.trim() || !displayPhone.trim() || !baId.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MembersTab({
  items,
  tenantId,
  currentUserId,
  canManage,
  onChanged,
}: {
  items: MemberRow[];
  tenantId: string | null;
  currentUserId: string | undefined;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!tenantId || !userId.trim()) return;
    setBusy(true);
    try {
      await api(`/api/tenants/${tenantId}/members`, {
        method: "POST",
        body: JSON.stringify({ user_id: userId.trim(), role }),
      });
      toast.success("Member added");
      setOpen(false);
      setUserId("");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(m: MemberRow, next: string) {
    if (!tenantId) return;
    try {
      await api(`/api/tenants/${tenantId}/members/${m.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: next }),
      });
      toast.success("Role updated");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update role");
    }
  }

  async function remove(m: MemberRow) {
    if (!tenantId) return;
    try {
      await api(`/api/tenants/${tenantId}/members/${m.id}`, { method: "DELETE" });
      toast.success("Member removed");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove member");
    }
  }

  return (
    <>
      {canManage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            Add member
          </Button>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState title="No members" description="Add team members so they can manage this tenant." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Added</TableHead>
                {canManage && <TableHead className="w-24" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs">{m.user_id}</TableCell>
                  <TableCell>
                    {canManage && m.user_id !== currentUserId ? (
                      <Select value={m.role} onValueChange={(v) => changeRole(m, v)}>
                        <SelectTrigger className="h-8 w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MEMBER_ROLES.map((r) => (
                            <SelectItem key={r} value={r}>{r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary">{m.role}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(m.created_at)}</TableCell>
                  {canManage && m.user_id !== currentUserId && (
                    <TableCell>
                      <div className="flex justify-end">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8 text-destructive">
                              <Trash2 className="size-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove member?</AlertDialogTitle>
                              <AlertDialogDescription>They will lose access to this tenant.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => remove(m)}>Remove</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
            <DialogDescription>Members share access to this tenant’s conversations and settings.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="member-user">User ID</Label>
              <Input
                id="member-user"
                className="font-mono"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMBER_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={add} disabled={busy || !userId.trim()}>
              {busy ? "Adding…" : "Add member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
