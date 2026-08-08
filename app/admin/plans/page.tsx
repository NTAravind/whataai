"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Boxes, Pencil, Plus, Trash2 } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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

interface PlanRow {
  id: string;
  name: string;
  is_active: boolean;
  limits: Record<string, unknown>;
  created_at: string;
}

const num = (v: unknown) => (typeof v === "number" ? String(v) : "");

export default function PlansAdminPage() {
  const plans = useApi<{ plans: PlanRow[] }>("/api/admin/plans");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [maxAgents, setMaxAgents] = useState("");
  const [maxWa, setMaxWa] = useState("");
  const [budget, setBudget] = useState("");
  const [modelTier, setModelTier] = useState("standard");
  const [enforcement, setEnforcement] = useState("hard");
  const [agentTypes, setAgentTypes] = useState("support");
  const [channels, setChannels] = useState("whatsapp");
  const [busy, setBusy] = useState(false);

  function startEdit(p: PlanRow) {
    setEditing(p);
    setName(p.name);
    setIsActive(p.is_active);
    setMaxAgents(num(p.limits.max_agents));
    setMaxWa(num(p.limits.max_wa_accounts));
    setBudget(num(p.limits.token_budget_monthly));
    setModelTier(String(p.limits.model_tier ?? "standard"));
    setEnforcement(String(p.limits.enforcement ?? "hard"));
    setAgentTypes((p.limits.allowed_agent_types as string[])?.join(",") ?? "support");
    setChannels((p.limits.allowed_channels as string[])?.join(",") ?? "whatsapp");
    setOpen(true);
  }

  function startCreate() {
    setEditing(null);
    setName("");
    setIsActive(true);
    setMaxAgents("");
    setMaxWa("");
    setBudget("");
    setModelTier("standard");
    setEnforcement("hard");
    setAgentTypes("support");
    setChannels("whatsapp");
    setOpen(true);
  }

  function buildLimits() {
    return {
      max_agents: maxAgents ? Number(maxAgents) : undefined,
      max_wa_accounts: maxWa ? Number(maxWa) : undefined,
      token_budget_monthly: budget ? Number(budget) : undefined,
      model_tier: modelTier,
      enforcement: enforcement as "hard" | "soft",
      allowed_agent_types: agentTypes.split(",").map((s) => s.trim()).filter(Boolean),
      allowed_channels: channels.split(",").map((s) => s.trim()).filter(Boolean),
    };
  }

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const body = { name: name.trim(), limits: buildLimits(), is_active: isActive };
      if (editing) {
        await api(`/api/admin/plans/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await api("/api/admin/plans", { method: "POST", body: JSON.stringify(body) });
      }
      toast.success(editing ? "Plan updated" : "Plan created");
      setOpen(false);
      plans.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save plan");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: PlanRow) {
    try {
      await api(`/api/admin/plans/${p.id}`, { method: "DELETE" });
      toast.success("Plan deleted");
      plans.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete plan");
    }
  }

  const list = plans.data?.plans ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Plans" description="Limits that entitlements are resolved from">
        <Button size="sm" onClick={startCreate}>
          <Plus className="size-4" />
          New plan
        </Button>
      </PageHeader>

      {plans.loading ? (
        <LoadingState rows={4} />
      ) : plans.error ? (
        <ErrorState message={plans.error} onRetry={plans.reload} />
      ) : list.length === 0 ? (
        <EmptyState title="No plans" description="Create a plan before assigning subscriptions." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Monthly tokens</TableHead>
                <TableHead>Agents</TableHead>
                <TableHead>Channels</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>
                    <Badge variant={p.is_active ? "default" : "secondary"}>{p.is_active ? "active" : "inactive"}</Badge>
                  </TableCell>
                  <TableCell>{num(p.limits.token_budget_monthly) || "—"}</TableCell>
                  <TableCell>{num(p.limits.max_agents) || "∞"}</TableCell>
                  <TableCell>{(p.limits.allowed_channels as string[])?.join(", ") ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(p.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => startEdit(p)}>
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
                            <AlertDialogTitle>Delete plan?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Subscriptions referencing “{p.name}” may be affected.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => remove(p)}>Delete</AlertDialogAction>
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit plan" : "New plan"}</DialogTitle>
            <DialogDescription>These limits drive entitlement resolution per subscription.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-end justify-between gap-4">
              <div className="flex-1 space-y-2">
                <Label htmlFor="plan-name">Name</Label>
                <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Starter" />
              </div>
              <div className="flex items-center gap-2 pb-1">
                <Switch id="plan-active" checked={isActive} onCheckedChange={setIsActive} />
                <Label htmlFor="plan-active" className="text-sm">Active</Label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="plan-agents">Max agents</Label>
                <Input id="plan-agents" type="number" value={maxAgents} onChange={(e) => setMaxAgents(e.target.value)} placeholder="∞" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-wa">Max WhatsApp accounts</Label>
                <Input id="plan-wa" type="number" value={maxWa} onChange={(e) => setMaxWa(e.target.value)} placeholder="∞" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="plan-budget">Monthly token budget</Label>
              <Input id="plan-budget" type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0 = unlimited" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Model tier</Label>
                <Select value={modelTier} onValueChange={setModelTier}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="economy">economy</SelectItem>
                    <SelectItem value="standard">standard</SelectItem>
                    <SelectItem value="premium">premium</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Enforcement</Label>
                <Select value={enforcement} onValueChange={setEnforcement}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hard">hard</SelectItem>
                    <SelectItem value="soft">soft</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="plan-types">Allowed agent types (comma separated)</Label>
              <Input id="plan-types" value={agentTypes} onChange={(e) => setAgentTypes(e.target.value)} placeholder="support, sales" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan-channels">Allowed channels (comma separated)</Label>
              <Input id="plan-channels" value={channels} onChange={(e) => setChannels(e.target.value)} placeholder="whatsapp, mail" />
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
    </div>
  );
}
