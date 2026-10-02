"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Cog,
  GitBranch,
  Loader2,
  Play,
  Plus,
  Save,
  Send,
  Tag,
  Timer,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/data-state";
import type {
  AgentRow,
  AutomationRow,
  AutomationStep,
  AutomationTriggerType,
  CaptureField,
  EnabledToolsPayload,
  IntegrationRow,
  TemplateRow,
} from "@/lib/api/types";

type DraftStep = AutomationStep & { id: string };

const STEP_LABELS: Record<AutomationStep["type"], string> = {
  api_call: "API call",
  send_message: "Send message",
  send_template: "Send template",
  send_document: "Send document",
  tag_contact: "Tag contact",
  wait: "Wait",
};

const TRIGGER_TYPES: Array<{ value: AutomationTriggerType; label: string; hint: string }> = [
  { value: "after_agent_reply", label: "After agent reply", hint: "The agent finished a reply to the customer." },
  { value: "on_tool_call", label: "On tool call", hint: "The agent used a specific tool, e.g. appointment booking." },
  { value: "ai_capture", label: "AI field capture", hint: "The model extracts structured fields the agent is told to collect." },
  { value: "manual", label: "Manual", hint: "Fires on demand from the contact’s conversation screen." },
];

let stepSeq = 0;
function newStepId() {
  stepSeq += 1;
  return `s${stepSeq}-${Date.now()}`;
}

export function AutomationBuilder({
  tenantId,
  editAutomation,
}: {
  tenantId: string;
  editAutomation?: AutomationRow | null;
}) {
  const router = useRouter();
  const base = `/api/tenants/${tenantId}`;
  const isEdit = Boolean(editAutomation);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [enabledTools, setEnabledTools] = useState<EnabledToolsPayload | null>(null);

  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState<string>("");
  const [isActive, setIsActive] = useState(true);
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>("after_agent_reply");
  const [toolName, setToolName] = useState("");
  const [captureFields, setCaptureFields] = useState<CaptureField[]>([]);
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadError(null);
      try {
        const [agentsRes, integrationsRes, templatesRes, toolsRes] = await Promise.all([
          api<{ agents: AgentRow[] }>(`${base}/agents`),
          api<{ integrations: IntegrationRow[] }>(`${base}/integrations`),
          api<{ templates: TemplateRow[] }>(`${base}/templates`),
          api<EnabledToolsPayload>(`${base}/automations/enabled-tools`),
        ]);
        if (cancelled) return;
        setAgents(agentsRes.agents);
        setIntegrations(integrationsRes.integrations);
        setTemplates(templatesRes.templates);
        setEnabledTools(toolsRes);

        const a = editAutomation;
        if (a) {
          setName(a.name);
          setAgentId(a.agent_id ?? "");
          setIsActive(a.is_active);
          setTriggerType(a.trigger_type);
          const cfg = a.trigger_config as { tool_name?: string; fields?: CaptureField[] };
          setToolName(cfg.tool_name ?? "");
          setCaptureFields(cfg.fields ?? []);
          setSteps((a.steps as AutomationStep[]).map((s) => ({ ...s, id: newStepId() })));
        } else {
          setSteps([{ id: newStepId(), type: "send_message", text: "" }]);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const markDirty = () => setDirty(true);
  const maybeLeave = () => !dirty || window.confirm("Discard unsaved changes?");

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const toolOptions = useMemo(() => {
    const t = enabledTools?.tools ?? [];
    return [...t.sort((x, y) => x.name.localeCompare(y.name))];
  }, [enabledTools]);

  const captureToolForAgent = (agent: string): { toolName: string; name: string } | null => {
    for (const c of enabledTools?.captureAutomations ?? []) {
      if (!c.agentId || c.agentId === agent) return { toolName: c.toolName, name: c.name };
    }
    return null;
  };

  function updateStep(id: string, patch: Partial<AutomationStep>) {
    setSteps((prev) => prev.map((s) => (s.id === id ? ({ ...s, ...patch } as DraftStep) : s)));
    markDirty();
  }

  /** Default shapes for each step type — ensures required fields are always present. */
  const stepDefaults: Record<AutomationStep["type"], Partial<AutomationStep>> = {
    send_message: { type: "send_message", text: "" },
    send_template: { type: "send_template", templateId: "" },
    send_document: { type: "send_document", url: "" },
    api_call: { type: "api_call", method: "POST", url: "", body: "" },
    tag_contact: { type: "tag_contact", tag: "" },
    wait: { type: "wait", seconds: 5 },
  };

  function changeStepType(id: string, newType: AutomationStep["type"]) {
    setSteps((prev) =>
      prev.map((s) =>
        s.id === id ? ({ id: s.id, ...stepDefaults[newType] } as DraftStep) : s,
      ),
    );
    markDirty();
  }

  function removeStep(id: string) {
    setSteps((prev) => prev.filter((s) => s.id !== id));
    markDirty();
  }

  function addStep() {
    setSteps((prev) => [...prev, { id: newStepId(), type: "send_message", text: "" }]);
    markDirty();
  }

  function moveStep(index: number, dir: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    markDirty();
  }

  function updateCaptureField(index: number, patch: Partial<CaptureField>) {
    setCaptureFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
    markDirty();
  }

  function triggerConfig(): Record<string, unknown> {
    if (triggerType === "on_tool_call") return { tool_name: toolName };
    if (triggerType === "ai_capture") return { fields: captureFields };
    return {};
  }

  async function save() {
    if (!name.trim()) {
      toast.error("Give the automation a name");
      return;
    }
    if (steps.length === 0) {
      toast.error("Add at least one step");
      return;
    }
    if (triggerType === "on_tool_call" && !toolName) {
      toast.error("Pick a tool for the trigger");
      return;
    }
    if (triggerType === "ai_capture" && captureFields.length === 0) {
      toast.error("Add at least one capture field");
      return;
    }
    const cleanSteps = steps.map(({ id: _id, ...rest }) => {
      void _id;
      return rest;
    });
    const body = {
      name: name.trim(),
      agentId: agentId || null,
      isActive,
      triggerType,
      triggerConfig: triggerConfig(),
      steps: cleanSteps,
    };
    setSaving(true);
    try {
      if (isEdit && editAutomation) {
        await api(`${base}/automations/${editAutomation.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await api(`${base}/automations`, { method: "POST", body: JSON.stringify(body) });
      }
      setDirty(false);
      toast.success(isEdit ? "Automation saved" : "Automation created");
      router.push(`/dashboard/automations`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save automation");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState rows={6} />;
  if (loadError) return <ErrorState message={loadError} onRetry={() => setLoading(true)} />;

  const stepIcon: Record<AutomationStep["type"], typeof Cog> = {
    api_call: Cog,
    send_message: Send,
    send_template: Send,
    send_document: Send,
    tag_contact: Tag,
    wait: Timer,
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (maybeLeave()) router.back();
          }}
        >
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant={isActive ? "default" : "secondary"}>{isActive ? "Active" : "Paused"}</Badge>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {isEdit ? "Save changes" : "Create automation"}
          </Button>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {editAutomation ? editAutomation.name : "New automation"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A pipeline of steps that runs when its trigger fires in a conversation.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
          <CardDescription>Who it runs for and when it activates.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="auto-name">Name</Label>
            <Input
              id="auto-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                markDirty();
              }}
              placeholder="e.g. Send booking confirmation"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auto-agent">Agent</Label>
            <Select
              value={agentId}
              onValueChange={(v) => {
                setAgentId(v);
                markDirty();
              }}
            >
              <SelectTrigger id="auto-agent">
                <SelectValue placeholder="All agents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All agents</SelectItem>
                {agents.map((ag) => (
                  <SelectItem key={ag.id} value={ag.id}>
                    {ag.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Enabled</p>
              <p className="text-xs text-muted-foreground">Paused automations never fire.</p>
            </div>
            <Switch
              checked={isActive}
              onCheckedChange={(v) => {
                setIsActive(v);
                markDirty();
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trigger</CardTitle>
          <CardDescription>What starts the automation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Trigger type</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {TRIGGER_TYPES.map((t) => (
                <label
                  key={t.value}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${
                    triggerType === t.value ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <input
                    type="radio"
                    className="mt-0.5"
                    checked={triggerType === t.value}
                    onChange={() => {
                      setTriggerType(t.value);
                      markDirty();
                    }}
                  />
                  <span>
                    <span className="block text-sm font-medium">{t.label}</span>
                    <span className="block text-xs text-muted-foreground">{t.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {triggerType === "on_tool_call" ? (
            <div className="space-y-1.5">
              <Label htmlFor="auto-tool">Tool</Label>
              <Select
                value={toolName}
                onValueChange={(v) => {
                  setToolName(v);
                  markDirty();
                }}
              >
                <SelectTrigger id="auto-tool">
                  <SelectValue placeholder="Select a tool" />
                </SelectTrigger>
                <SelectContent>
                  {toolOptions.map((t) => (
                    <SelectItem key={t.name} value={t.name}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Fires only if the agent’s tool set includes this tool.
              </p>
            </div>
          ) : null}

          {triggerType === "ai_capture" ? (
            <div className="space-y-3">
              {captureToolForAgent(agentId) || toolOptions.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  The agent will be asked to capture each field and the automation runs when the
                  conversation has them all. Add the capture tool to the agent’s tool set for best
                  results.
                </p>
              ) : null}
              <div className="space-y-2">
                {captureFields.map((f, i) => (
                  <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_auto_1fr_1fr]">
                    <Input
                      value={f.name}
                      placeholder="field name"
                      onChange={(e) => updateCaptureField(i, { name: e.target.value })}
                    />
                    <Select
                      value={f.type}
                      onValueChange={(v) => updateCaptureField(i, { type: v as CaptureField["type"] })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="string">string</SelectItem>
                        <SelectItem value="number">number</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={f.description}
                      placeholder="what to collect"
                      onChange={(e) => updateCaptureField(i, { description: e.target.value })}
                    />
                    <div className="flex items-center gap-3 px-1">
                      <label className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={f.required}
                          onChange={(e) => updateCaptureField(i, { required: e.target.checked })}
                        />
                        required
                      </label>
                      <label className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={f.saveToContact}
                          onChange={(e) => updateCaptureField(i, { saveToContact: e.target.checked })}
                        />
                        save to contact
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive"
                        onClick={() => {
                          setCaptureFields((prev) => prev.filter((_, j) => j !== i));
                          markDirty();
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCaptureFields((prev) => [
                    ...prev,
                    { name: "", type: "string", description: "", required: true, saveToContact: false },
                  ]);
                  markDirty();
                }}
              >
                <Plus className="size-4" />
                Add field
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Steps</CardTitle>
          <CardDescription>
            Run top-to-bottom. Earlier steps can feed the next via{" "}
            <code className="font-mono text-xs">{"{{variables.step_N[...]}}"}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {steps.map((s, i) => {
            const Icon = stepIcon[s.type];
            return (
              <div key={s.id} className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {i + 1}
                  </span>
                  <Icon className="size-4 text-muted-foreground" />
                  <Select
                    value={s.type}
                    onValueChange={(v) => changeStepType(s.id, v as AutomationStep["type"])}
                  >
                    <SelectTrigger className="h-8 w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(STEP_LABELS).map(([k, label]) => (
                        <SelectItem key={k} value={k}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={i === 0}
                      onClick={() => moveStep(i, -1)}
                    >
                      <ArrowLeft className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={i === steps.length - 1}
                      onClick={() => moveStep(i, 1)}
                    >
                      <ArrowRight className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive"
                      onClick={() => removeStep(s.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="mt-3 space-y-3">
                  {s.type === "send_message" ? (
                    <div className="space-y-1.5">
                      <Label>Message text</Label>
                      <Textarea
                        rows={2}
                        value={s.text ?? ""}
                        placeholder="Hi {{contact.name}}, your receipt — {{variables.step_0.output.tracking}}"
                        onChange={(e) => updateStep(s.id, { text: e.target.value })}
                      />
                    </div>
                  ) : null}

                  {s.type === "send_template" ? (
                    <div className="space-y-1.5">
                      <Label>Template</Label>
                      <Select
                        value={s.templateId ?? ""}
                        onValueChange={(v) => updateStep(s.id, { templateId: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a template" />
                        </SelectTrigger>
                        <SelectContent>
                          {templates.map((tpl) => (
                            <SelectItem key={tpl.id} value={tpl.id}>
                              {tpl.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}

                  {s.type === "send_document" ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label>Media ID (WhatsApp)</Label>
                        <Input
                          value={s.mediaId ?? ""}
                          onChange={(e) => updateStep(s.id, { mediaId: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>URL</Label>
                        <Input
                          value={s.url ?? ""}
                          onChange={(e) => updateStep(s.id, { url: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Filename</Label>
                        <Input
                          value={s.filename ?? ""}
                          onChange={(e) => updateStep(s.id, { filename: e.target.value })}
                        />
                      </div>
                    </div>
                  ) : null}

                  {s.type === "tag_contact" ? (
                    <div className="space-y-1.5">
                      <Label>Tag</Label>
                      <Input
                        value={s.tag ?? ""}
                        placeholder="e.g. interested"
                        onChange={(e) => updateStep(s.id, { tag: e.target.value })}
                      />
                    </div>
                  ) : null}

                  {s.type === "wait" ? (
                    <div className="space-y-1.5">
                      <Label>Seconds</Label>
                      <Input
                        type="number"
                        min={1}
                        max={3600}
                        value={s.seconds ?? 1}
                        onChange={(e) =>
                          updateStep(s.id, { seconds: Number.isNaN(Number(e.target.value)) ? 1 : Number(e.target.value) })
                        }
                      />
                    </div>
                  ) : null}

                  {s.type === "api_call" ? (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                        <div className="space-y-1.5">
                          <Label>Integration</Label>
                          <Select
                            value={s.integrationId ?? "__url__"}
                            onValueChange={(v) =>
                              updateStep(s.id, { integrationId: v === "__url__" ? undefined : v })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Use raw URL" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__url__">Use raw URL</SelectItem>
                              {integrations.map((intg) => (
                                <SelectItem key={intg.id} value={intg.id}>
                                  {intg.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Method</Label>
                          <Select
                            value={s.method ?? "POST"}
                            onValueChange={(v) => updateStep(s.id, { method: v as NonNullable<AutomationStep["method"]> })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(["GET", "POST", "PUT", "PATCH"] as const).map((m) => (
                                <SelectItem key={m} value={m}>
                                  {m}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {s.integrationId ? null : (
                        <div className="space-y-1.5">
                          <Label>URL</Label>
                          <Input
                            value={s.url ?? ""}
                            onChange={(e) => updateStep(s.id, { url: e.target.value })}
                            placeholder={`https://api.example.com/leads ${
                              agentId !== "" &&
                              (enabledTools?.captureAutomations.some((c) => !c.agentId || c.agentId === agentId) ??
                                false)
                                ? "— e.g. {{variables.field.email}}"
                                : ""
                            }`.trim()}
                          />
                        </div>
                      )}
                      <HeaderEditor headers={s.headers ?? {}} onChange={(h) => updateStep(s.id, { headers: h })} />
                      <div className="space-y-1.5">
                        <Label>Body (JSON)</Label>
                        <Textarea
                          rows={3}
                          value={s.body ?? ""}
                          onChange={(e) => updateStep(s.id, { body: e.target.value })}
                          placeholder='{"email": "{{variables.field.email}}"}'
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Response</Label>
                        <Select
                          value={s.responseType ?? "json"}
                          onValueChange={(v) =>
                            updateStep(s.id, { responseType: v as NonNullable<AutomationStep["responseType"]> })
                          }
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="json">JSON</SelectItem>
                            <SelectItem value="binary">Binary (send document)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : null}

                  {s.type === "api_call" ? (
                    <IntegrationHint
                      integration={integrations.find((intg) => intg.id === s.integrationId) ?? null}
                      hasIntegration={Boolean(s.integrationId)}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}

          <Button variant="outline" size="sm" onClick={addStep}>
            <Plus className="size-4" />
            Add step
          </Button>

          <div className="flex items-center justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => (maybeLeave() ? router.back() : null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              {isEdit ? "Save changes" : "Create automation"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        <GitBranch className="size-4" />
        <span>
          Steps that post to an integration auto-inject <code className="font-mono">Authorization: Bearer</code>{" "}
          for OAuth connections. Everything else references credentials explicitly and is never logged.
        </span>
      </div>
    </div>
  );
}

function HeaderEditor({
  headers,
  onChange,
}: {
  headers: Record<string, string>;
  onChange: (headers: Record<string, string>) => void;
}) {
  const rows = Object.entries(headers);
  return (
    <div className="space-y-1.5">
      <Label>Headers</Label>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No headers. Add e.g. <code className="font-mono">X-Api-Key={"{{integration.credential}}"}</code>.</p>
      ) : (
        rows.map(([k, v]) => (
          <div key={k} className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
            <Input
              defaultValue={k}
              onBlur={(e) => {
                const key = e.target.value.trim();
                if (!key || key === k) return;
                const next = { ...headers };
                delete next[k];
                next[key] = v;
                onChange(next);
              }}
              placeholder="Header name"
            />
            <Input
              defaultValue={v}
              onBlur={(e) => {
                const val = e.target.value;
                if (val === v) return;
                const next = { ...headers };
                next[k] = val;
                onChange(next);
              }}
              placeholder="Value"
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-destructive"
              onClick={() => {
                const next = { ...headers };
                delete next[k];
                onChange(next);
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange({ ...headers, "": "" })}
        disabled={rows.some(([k]) => k === "")}
      >
        <Plus className="size-4" />
        Add header
      </Button>
    </div>
  );
}

function IntegrationHint({
  integration,
  hasIntegration,
}: {
  integration: IntegrationRow | null;
  hasIntegration: boolean;
}) {
  if (!hasIntegration) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {integration?.hasCredentials
        ? "OAuth connections attach Authorization automatically."
        : "No credential set yet — add one on the Integrations page or the call will fail."}
    </p>
  );
}