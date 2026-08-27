"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Save, Trash2, Bot } from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import { ErrorState, LoadingState } from "@/components/data-state";
import type { AgentRow } from "@/lib/api/types";

const TOOL_LABELS: Record<string, string> = {
  search_knowledge_base: "Search knowledge base",
  check_availability: "Check availability",
  create_booking: "Create booking",
  cancel_booking: "Cancel booking",
  list_resources: "List resources",
  schedule_reminder: "Schedule reminder",
  escalate_to_human: "Escalate to human",
  list_templates: "List templates",
  send_template: "Send template",
  create_template: "Create template",
  list_flows: "List flows",
  trigger_flow: "Trigger flow",
  get_current_datetime: "Get current date/time",
};

const AGENT_TOOL_NAMES = Object.keys(TOOL_LABELS);

export default function AgentEditorPage() {
  const params = useParams<{ agentId: string }>();
  const router = useRouter();
  const { tenantId } = useTenant();
  const agentId = params.agentId;

  const { data, loading, error, reload } = useApi<{ agent: AgentRow }>(
    tenantId && agentId ? `/api/tenants/${tenantId}/agents/${agentId}` : null,
  );

  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [instructions, setInstructions] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [tools, setTools] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [syncedAgent, setSyncedAgent] = useState<AgentRow | null>(null);

  if (data?.agent && data.agent !== syncedAgent) {
    setSyncedAgent(data.agent);
    setName(data.agent.name);
    setType(data.agent.type);
    setInstructions(data.agent.instructions ?? "");
    setEnabled(data.agent.enabled);
    setTools(data.agent.tools ?? []);
    setDirty(false);
  }

  if (loading) return <LoadingState rows={6} />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  function toggleTool(tool: string) {
    setTools((prev) => {
      const next = prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool];
      setDirty(true);
      return next;
    });
  }

  async function save() {
    if (!tenantId || !agentId) return;
    setSaving(true);
    try {
      await api(`/api/tenants/${tenantId}/agents/${agentId}`, {
        method: "PATCH",
        body: JSON.stringify({ name, type, instructions, enabled, tools }),
      });
      toast.success("Agent saved");
      setDirty(false);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save agent");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!tenantId || !agentId) return;
    try {
      await api(`/api/tenants/${tenantId}/agents/${agentId}`, { method: "DELETE" });
      toast.success("Agent deleted");
      router.push("/dashboard/agents");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete agent");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Edit agent"
        description="Instructions and tools define how this agent behaves"
      >
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/agents">
            <ArrowLeft className="size-4" />
            Back
          </Link>
        </Button>
        <Button size="sm" onClick={save} disabled={saving || !dirty}>
          <Save className="size-4" />
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="size-4 text-muted-foreground" />
            Basics
          </CardTitle>
          <CardDescription>Name, type and whether the agent is live.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Input id="type" value={type} onChange={(e) => { setType(e.target.value); setDirty(true); }} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Agent enabled</p>
              <p className="text-xs text-muted-foreground">Disabled agents stop receiving new conversations.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={(v) => { setEnabled(v); setDirty(true); }} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Instructions</CardTitle>
          <CardDescription>
            System prompt for the model. Write the persona, guardrails and escalation rules here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={instructions}
            onChange={(e) => { setInstructions(e.target.value); setDirty(true); }}
            rows={12}
            placeholder="You are the front-desk agent for…"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tools</CardTitle>
          <CardDescription>Which capabilities this agent can call during a conversation.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            {AGENT_TOOL_NAMES.map((tool) => {
              const on = tools.includes(tool);
              return (
                <button
                  key={tool}
                  type="button"
                  onClick={() => toggleTool(tool)}
                  className="flex items-center justify-between gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-accent"
                >
                  <div>
                    <p className="text-sm font-medium">{TOOL_LABELS[tool] ?? tool}</p>
                    <p className="font-mono text-xs text-muted-foreground">{tool}</p>
                  </div>
                  <Badge variant={on ? "default" : "secondary"}>{on ? "On" : "Off"}</Badge>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-between">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash2 className="size-4" />
              Delete agent
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this agent?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the agent and its tool bindings. Existing conversations keep their history.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
