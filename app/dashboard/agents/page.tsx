"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Plus, Pencil } from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MODELS, DEFAULT_MODEL } from "@/lib/agents/provider";
import type { AgentRow } from "@/lib/api/types";

export default function AgentsPage() {
  const { tenantId } = useTenant();
  const router = useRouter();
  const { data, loading, error, reload } = useApi<{ agents: AgentRow[] }>(
    tenantId ? `/api/tenants/${tenantId}/agents` : null,
  );

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("receptionist");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [creating, setCreating] = useState(false);

  async function create() {
    if (!tenantId) return;
    setCreating(true);
    try {
      const res = await api<{ agent: AgentRow }>(`/api/tenants/${tenantId}/agents`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), type, model_config: { model } }),
      });
      toast.success("Agent created");
      setOpen(false);
      setName("");
      router.push(`/dashboard/agents/${res.agent.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setCreating(false);
    }
  }

  async function toggleEnabled(agent: AgentRow, enabled: boolean) {
    if (!tenantId) return;
    try {
      await api(`/api/tenants/${tenantId}/agents/${agent.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update agent");
    }
  }

  const agents = data?.agents ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Agents" description="AI agents that handle conversations automatically">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" />
              New agent
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create agent</DialogTitle>
              <DialogDescription>
                Agents answer customer messages. You can edit instructions and tools next.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="agent-name">Name</Label>
                <Input
                  id="agent-name"
                  placeholder="e.g. Front desk"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-type">Type</Label>
                <Input
                  id="agent-type"
                  placeholder="receptionist"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The type is a label for your own organization — instructions are what shape behavior.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-model">Model</Label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger id="agent-model" className="w-full">
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from(new Set(MODELS.map((m) => m.group))).map((group) => (
                      <SelectGroup key={group}>
                        <SelectLabel>{group}</SelectLabel>
                        {MODELS.filter((m) => m.group === group).map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Can be changed later on the edit page.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={create} disabled={creating || !name.trim()}>
                {creating ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {loading ? (
        <LoadingState rows={3} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : agents.length === 0 ? (
        <EmptyState
          title="No agents yet"
          description="Create your first agent to start replying to customers automatically."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => (
            <Card key={a.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Bot className="size-4 text-muted-foreground" />
                    <p className="font-medium">{a.name}</p>
                  </div>
                  <Switch
                    checked={a.enabled}
                    onCheckedChange={(v) => toggleEnabled(a, v)}
                    aria-label={`Toggle ${a.name}`}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{a.type}</p>
                <div className="mt-3 flex items-center justify-between">
                  <Badge variant="secondary">{a.tools?.length ?? 0} tools</Badge>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/dashboard/agents/${a.id}`}>
                      <Pencil className="size-3.5" />
                      Edit
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
