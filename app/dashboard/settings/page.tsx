"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Building2, Mail, Plus, Phone, Pencil, RotateCw, Trash2, Users } from "lucide-react";
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
import type { BusinessRow, MailAccountRow, MemberRow, WaAccountRow } from "@/lib/api/types";

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
  const mail = useCrud<MailAccountRow>(base, "mail-accounts");
  const members = useCrud<MemberRow>(base, "members");

  const myRole = tenantId ? roles[tenantId] : undefined;
  const canManage = myRole === "owner" || myRole === "admin";

  const loading = businesses.loading || wa.loading || mail.loading || members.loading;
  const error = businesses.error ?? wa.error ?? mail.error ?? members.error;

  const businessList = businesses.data?.businesses ?? [];
  const waList = wa.data?.waAccounts ?? [];
  const mailList = mail.data?.mailAccounts ?? [];
  const memberList = members.data?.members ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Settings" description="Businesses, channel accounts, and team members" />

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
            <TabsTrigger value="mail-accounts">
              <Mail className="size-3.5" />
              Mail accounts
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

          <TabsContent value="mail-accounts" className="space-y-4">
            <MailAccountsTab
              items={mailList}
              tenantId={tenantId}
              canManage={canManage}
              onChanged={mail.reload}
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
  const [baId, setBaId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  function startEdit(a: WaAccountRow) {
    setEditing(a);
    setPhoneNumberId(a.wa_phone_number_id);
    setBaId(a.wa_business_account_id);
    setAccessToken("");
    setVerifyToken("");
    setOpen(true);
  }

  function startCreate() {
    setEditing(null);
    setPhoneNumberId("");
    setBaId("");
    setAccessToken("");
    setVerifyToken("");
    setOpen(true);
  }

  async function save() {
    if (!tenantId || !phoneNumberId.trim() || !baId.trim()) return;
    if (!editing && (!accessToken.trim() || !verifyToken.trim())) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        wa_phone_number_id: phoneNumberId.trim(),
        wa_business_account_id: baId.trim(),
      };
      if (accessToken.trim()) body.access_token = accessToken.trim();
      if (verifyToken.trim()) body.verify_token = verifyToken.trim();
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

  async function refresh(a: WaAccountRow) {
    if (!tenantId) return;
    setRefreshingId(a.id);
    try {
      await api(`/api/tenants/${tenantId}/wa-accounts/${a.id}`, { method: "PATCH", body: JSON.stringify({}) });
      toast.success("Connection checked with Meta");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to check connection");
    } finally {
      setRefreshingId(null);
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
                <TableHead>Credentials</TableHead>
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
                    <Badge variant={statusVariant(a.status)}>{a.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Badge variant={a.has_access_token ? "default" : "outline"}>
                        {a.has_access_token ? "API token" : "no token"}
                      </Badge>
                      <Badge variant={a.has_verify_token ? "default" : "outline"}>
                        {a.has_verify_token ? "Webhook" : "no webhook"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(a.created_at)}</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={refreshingId === a.id}
                          onClick={() => refresh(a)}
                          title="Check connection with Meta"
                        >
                          <RotateCw className={`size-4 ${refreshingId === a.id ? "animate-spin" : ""}`} />
                        </Button>
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
            <DialogDescription>
              Status is checked live with Meta. Phone number and connection state are fetched automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wa-phone-id">Phone number ID</Label>
              <Input id="wa-phone-id" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} className="font-mono" placeholder="e.g. 118425956478099" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wa-ba-id">WABA ID</Label>
              <Input id="wa-ba-id" value={baId} onChange={(e) => setBaId(e.target.value)} className="font-mono" placeholder="e.g. 114779258883489" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wa-token">Permanent access token</Label>
              <Input
                id="wa-token"
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={editing ? "Leave blank to keep current token" : "EAAG…"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wa-verify">Webhook verify token</Label>
              <Input
                id="wa-verify"
                type="password"
                value={verifyToken}
                onChange={(e) => setVerifyToken(e.target.value)}
                placeholder={editing ? "Leave blank to keep current token" : "Your chosen webhook token"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={save}
              disabled={
                busy ||
                !phoneNumberId.trim() ||
                !baId.trim() ||
                (!editing && (!accessToken.trim() || !verifyToken.trim()))
              }
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "connected") return "default";
  if (status === "active") return "default";
  if (status === "invalid_token" || status === "not_found" || status === "disabled") return "destructive";
  return "secondary";
}

function MailAccountsTab({
  items,
  tenantId,
  canManage,
  onChanged,
}: {
  items: MailAccountRow[];
  tenantId: string | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MailAccountRow | null>(null);
  const [emailAddress, setEmailAddress] = useState("");
  const [provider, setProvider] = useState("resend");
  const [status, setStatus] = useState("active");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [busy, setBusy] = useState(false);

  function startCreate() {
    setEditing(null);
    setEmailAddress("");
    setProvider("resend");
    setStatus("active");
    setWebhookSecret("");
    setOpen(true);
  }

  function startEdit(account: MailAccountRow) {
    setEditing(account);
    setEmailAddress(account.email_address);
    setProvider(account.provider);
    setStatus(account.status);
    setWebhookSecret("");
    setOpen(true);
  }

  async function save() {
    if (!tenantId || !emailAddress.trim() || !provider.trim()) return;
    setBusy(true);
    try {
      const credentials = webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : undefined;
      const body = {
        email_address: emailAddress.trim().toLowerCase(),
        provider: provider.trim().toLowerCase(),
        status,
        ...(credentials ? { credentials } : {}),
      };
      if (editing) {
        await api(`/api/tenants/${tenantId}/mail-accounts/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await api(`/api/tenants/${tenantId}/mail-accounts`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      toast.success(editing ? "Mail account updated" : "Mail account added");
      setOpen(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save mail account");
    } finally {
      setBusy(false);
    }
  }

  async function remove(account: MailAccountRow) {
    if (!tenantId) return;
    try {
      await api(`/api/tenants/${tenantId}/mail-accounts/${account.id}`, { method: "DELETE" });
      toast.success("Mail account removed");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove mail account");
    }
  }

  return (
    <>
      {canManage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={startCreate}>
            <Plus className="size-4" />
            Add mail account
          </Button>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState title="No mail accounts" description="Connect an inbound email address for mail conversations." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email address</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Credentials</TableHead>
                <TableHead>Created</TableHead>
                {canManage && <TableHead className="w-24" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-medium">{account.email_address}</TableCell>
                  <TableCell className="capitalize">{account.provider}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(account.status)}>{account.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={Object.keys(account.credentials ?? {}).length ? "default" : "outline"}>
                      {Object.keys(account.credentials ?? {}).length ? "configured" : "none"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(account.created_at)}</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => startEdit(account)}>
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
                              <AlertDialogTitle>Remove mail account?</AlertDialogTitle>
                              <AlertDialogDescription>
                                “{account.email_address}” will stop receiving inbound mail conversations.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => remove(account)}>Remove</AlertDialogAction>
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
            <DialogTitle>{editing ? "Edit mail account" : "Add mail account"}</DialogTitle>
            <DialogDescription>Configure an inbound email channel used by the mail webhook pipeline.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mail-email">Email address</Label>
              <Input
                id="mail-email"
                type="email"
                value={emailAddress}
                onChange={(e) => setEmailAddress(e.target.value)}
                placeholder="support@example.com"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="mail-provider">Provider</Label>
                <Input
                  id="mail-provider"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder="resend"
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">active</SelectItem>
                    <SelectItem value="disabled">disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mail-secret">Webhook secret</Label>
              <Input
                id="mail-secret"
                type="password"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder={editing ? "Leave blank to keep current credentials" : "Optional provider secret"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy || !emailAddress.trim() || !provider.trim()}>
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
