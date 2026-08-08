"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, RefreshCw } from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ErrorState, EmptyState, LoadingState } from "@/components/data-state";
import { formatDateTime } from "@/lib/format";
import type { TemplateRow, WaAccountRow } from "@/lib/api/types";

const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const variant =
    s === "approved" ? "default" : s === "rejected" || s === "failed" ? "destructive" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

export default function TemplatesPage() {
  const { tenantId } = useTenant();
  const base = tenantId ? `/api/tenants/${tenantId}` : null;

  const templates = useApi<{ templates: TemplateRow[] }>(base ? `${base}/templates` : null);
  const wa = useApi<{ waAccounts: WaAccountRow[] }>(base ? `${base}/wa-accounts` : null);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("UTILITY");
  const [language, setLanguage] = useState("en_US");
  const [body, setBody] = useState("");
  const [waAccountId, setWaAccountId] = useState("");
  const [creating, setCreating] = useState(false);

  async function create() {
    if (!tenantId) return;
    setCreating(true);
    try {
      await api("/api/whatsapp/templates/create", {
        method: "POST",
        body: JSON.stringify({
          tenantId,
          waAccountId,
          name: name.trim(),
          language,
          category,
          components: [{ type: "BODY", text: body }],
        }),
      });
      toast.success("Template submitted for review");
      setOpen(false);
      setName("");
      setBody("");
      templates.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create template");
    } finally {
      setCreating(false);
    }
  }

  async function pullFromMeta() {
    if (!tenantId || !waAccountId) return;
    try {
      await api(`/api/tenants/${tenantId}/templates/pull`, {
        method: "POST",
        body: JSON.stringify({ waAccountId }),
      });
      toast.success("Templates synced from Meta");
      templates.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sync templates");
    }
  }

  const list = templates.data?.templates ?? [];
  const waAccounts = wa.data?.waAccounts ?? [];
  const selectedWaAccount = waAccounts.find((a) => a.id === waAccountId) ?? waAccounts[0];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Templates" description="WhatsApp message templates and their approval status">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" />
              New template
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create template</DialogTitle>
              <DialogDescription>
                Submitted to Meta for approval. You can use variables like {"{{1}}"} in the body.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>WhatsApp account</Label>
                <Select value={selectedWaAccount?.id ?? ""} onValueChange={setWaAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an account" />
                  </SelectTrigger>
                  <SelectContent>
                    {waAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.display_phone_number}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-name">Name</Label>
                <Input id="template-name" placeholder="order_confirmation" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="template-language">Language</Label>
                  <Input id="template-language" value={language} onChange={(e) => setLanguage(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-body">Body</Label>
                <textarea
                  id="template-body"
                  className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Hi {{1}}, your order is on the way!"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={create} disabled={creating || !name.trim() || !body.trim() || !waAccounts.length}>
                {creating ? "Submitting…" : "Submit for review"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button variant="outline" size="sm" onClick={pullFromMeta} disabled={!waAccounts.length}>
          <RefreshCw className="size-3.5" />
          Sync from Meta
        </Button>
      </PageHeader>

      {templates.loading ? (
        <LoadingState rows={5} />
      ) : templates.error ? (
        <ErrorState message={templates.error} onRetry={templates.reload} />
      ) : list.length === 0 ? (
        <EmptyState
          title="No templates yet"
          description="Create a template above, or sync the ones already registered on Meta."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{t.category}</TableCell>
                  <TableCell>{t.language}</TableCell>
                  <TableCell><StatusBadge status={t.status} /></TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(t.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
