"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  const [paramLabels, setParamLabels] = useState<string[]>([]);
  const [waAccountId, setWaAccountId] = useState("");
  const [creating, setCreating] = useState(false);

  /** Detect {{N}} placeholders in the body text and sync the labels array length. */
  function handleBodyChange(text: string) {
    setBody(text);
    const matches = [...text.matchAll(/\{\{(\d+)\}\}/g)];
    const indices = matches.map((m) => parseInt(m[1], 10));
    const maxIdx = indices.length ? Math.max(...indices) : 0;
    setParamLabels((prev) => {
      const next = Array.from({ length: maxIdx }, (_, i) => prev[i] ?? "");
      return next;
    });
  }

  async function create() {
    if (!tenantId) return;
    setCreating(true);
    try {
      // Build the BODY component, attaching example values if variables exist
      const bodyComponent: Record<string, unknown> = { type: "BODY", text: body };
      if (paramLabels.length > 0) {
        // example.body_text is a 2-D array: outer = messages (just 1), inner = param values
        bodyComponent.example = { body_text: [paramLabels.map((l) => l.trim() || `{{${paramLabels.indexOf(l) + 1}}}`)] };
      }
      await api("/api/whatsapp/templates/create", {
        method: "POST",
        body: JSON.stringify({
          tenantId,
          waAccountId,
          name: name.trim(),
          language,
          category,
          components: [bodyComponent],
        }),
      });
      toast.success("Template submitted for review");
      setOpen(false);
      setName("");
      setBody("");
      setParamLabels([]);
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

  async function removeTemplate(template: TemplateRow) {
    if (!tenantId) return;
    try {
      await api("/api/whatsapp/templates/delete", {
        method: "DELETE",
        body: JSON.stringify({ tenantId, templateId: template.id }),
      });
      toast.success("Template deleted");
      templates.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete template");
    }
  }

  const list = templates.data?.templates ?? [];
  const waAccounts = wa.data?.waAccounts ?? [];
  const bodyHasEdgeVars = /^\s*\{\{\d+\}\}/.test(body) || /\{\{\d+\}\}\s*$/.test(body);
  const selectedWaAccount = waAccounts.find((a) => a.id === waAccountId) ?? waAccounts[0];

  // Auto-select the first WA account when the list loads
  if (waAccounts.length > 0 && !waAccountId) {
    setWaAccountId(waAccounts[0].id);
  }

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
                <Textarea
                  id="template-body"
                  className="min-h-24"
                  placeholder="Hi {{1}}, your order is on the way!"
                  value={body}
                  onChange={(e) => handleBodyChange(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Use <code className="font-mono">{'{{1}}'}</code>, <code className="font-mono">{'{{2}}'}</code>… for dynamic values.
                </p>
                {bodyHasEdgeVars && (
                  <p className="text-xs text-destructive">
                    Variables can&apos;t be at the start or end of the body — Meta will reject it.
                  </p>
                )}
              </div>

              {paramLabels.length > 0 && (
                <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Describe each variable — the agent will use these descriptions to know what value to fill in.
                  </p>
                  {paramLabels.map((label, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="shrink-0 font-mono text-xs text-muted-foreground w-8">{`{{${i + 1}}}`}</span>
                      <Input
                        id={`param-label-${i}`}
                        placeholder={`e.g. customer first name`}
                        value={label}
                        onChange={(e) => {
                          const next = [...paramLabels];
                          next[i] = e.target.value;
                          setParamLabels(next);
                        }}
                        className="h-8 text-sm"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={create} disabled={creating || !name.trim() || !body.trim() || !waAccountId || bodyHasEdgeVars || !waAccounts.length}>
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
                <TableHead className="w-12" />
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
                  <TableCell>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8 text-destructive">
                          <Trash2 className="size-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete template?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This deletes “{t.name}” locally and makes a best-effort delete request to Meta.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => removeTemplate(t)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
