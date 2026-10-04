"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { RefreshCcw, Save } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorState, EmptyState, LoadingState } from "@/components/data-state";

interface ModelRow {
  id: string;
  provider: "google" | "groq" | "openrouter";
  label: string;
  enabled: boolean;
  input_per_million: number | string;
  output_per_million: number | string;
  pricing_override_input: number | string | null;
  pricing_override_output: number | string | null;
  context_window: number | null;
  notes: string | null;
}

/** Local editable draft; only fields differing from the server are sent. */
interface Draft {
  enabled: boolean;
  label: string;
  inputPerMillion: string;
  outputPerMillion: string;
  notes: string;
}

const num = (v: unknown) => (v === null || v === undefined ? "" : String(v));

const PROVIDER_FILTERS = [
  { value: "all", label: "All" },
  { value: "google", label: "Google" },
  { value: "groq", label: "Groq" },
  { value: "openrouter", label: "OpenRouter" },
] as const;

type ProviderFilter = (typeof PROVIDER_FILTERS)[number]["value"];

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  groq: "Groq",
  openrouter: "OpenRouter",
};

const providerLabel = (provider: string) => PROVIDER_LABELS[provider] ?? provider;

function toDraft(row: ModelRow): Draft {
  return {
    enabled: row.enabled,
    label: row.label,
    inputPerMillion: num(row.input_per_million),
    outputPerMillion: num(row.output_per_million),
    notes: row.notes ?? "",
  };
}

function compact(n: number | null) {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export default function ModelsAdminPage() {
  const catalog = useApi<{ models: ModelRow[]; inserted?: string[] }>("/api/admin/models");

  const [draftState, setDraftState] = useState<{ key: string; drafts: Record<string, Draft> }>({
    key: "",
    drafts: {},
  });
  const [provider, setProvider] = useState<ProviderFilter>("all");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const rows = useMemo(() => catalog.data?.models ?? [], [catalog.data]);

  // Drafts are derived from the server rows and reset whenever the server data
  // changes, so a reload discards local edits without an effect.
  const sourceKey = rows.map((r) => `${r.id}@${r.enabled}:${r.label}`).join("|");
  const drafts =
    draftState.key === sourceKey
      ? draftState.drafts
      : Object.fromEntries(rows.map((r) => [r.id, toDraft(r)]));

  function commit(next: Record<string, Draft>) {
    setDraftState({ key: sourceKey, drafts: next });
  }

  const dirty = useMemo(() => {
    return rows.filter((row) => {
      const draft = drafts[row.id];
      if (!draft) return false;
      const base = toDraft(row);
      return (
        draft.enabled !== base.enabled ||
        draft.label !== base.label ||
        draft.notes !== base.notes ||
        Number(draft.inputPerMillion) !== Number(base.inputPerMillion) ||
        Number(draft.outputPerMillion) !== Number(base.outputPerMillion)
      );
    });
  }, [rows, drafts]);

  function setField(id: string, patch: Partial<Draft>) {
    commit({ ...drafts, [id]: { ...drafts[id], ...patch } });
  }

  function toggleAll(enabled: boolean) {
    const next = { ...drafts };
    for (const row of rows) next[row.id] = { ...next[row.id], enabled };
    commit(next);
  }

  async function save() {
    if (dirty.length === 0) return;
    setSaving(true);
    try {
      await api("/api/admin/models", {
        method: "PATCH",
        body: JSON.stringify({
          updates: dirty.map((row) => {
            const draft = drafts[row.id];
            return {
              id: row.id,
              enabled: draft.enabled,
              label: draft.label,
              inputPerMillion: Number(draft.inputPerMillion) || 0,
              outputPerMillion: Number(draft.outputPerMillion) || 0,
              notes: draft.notes || null,
            };
          }),
        }),
      });
      toast.success(`Updated ${dirty.length} model${dirty.length === 1 ? "" : "s"}`);
      catalog.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save models");
    } finally {
      setSaving(false);
    }
  }

  async function sync() {
    setSyncing(true);
    try {
      const res = await api<{ inserted: string[] }>("/api/admin/models/sync", { method: "POST" });
      if (res.inserted.length > 0) {
        toast.success(`Imported ${res.inserted.length} new model(s) from providers — switched off by default`);
      } else {
        toast.success("Catalog is up to date — no new models from providers");
      }
      catalog.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const visible = rows.filter((r) => provider === "all" || r.provider === provider);
  const enabledCount = rows.filter((r) => r.enabled).length;
  const groups = [...new Set(visible.map((r) => r.provider))];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Models"
        description="Models are fetched live from each provider's API and refreshed automatically every day. Only enabled models appear in client dropdowns. Per-plan availability is set on the Plans page."
      >
        <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
          <RefreshCcw className="size-4" />
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
        <Button size="sm" onClick={save} disabled={saving || dirty.length === 0}>
          <Save className="size-4" />
          {saving ? "Saving…" : `Save${dirty.length ? ` (${dirty.length})` : ""}`}
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Provider</span>
          <div className="flex rounded-lg border p-0.5">
            {PROVIDER_FILTERS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setProvider(p.value)}
                className={`rounded-md px-3 py-1 text-sm transition-colors ${
                  provider === p.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">
            {enabledCount} of {rows.length} enabled
          </Badge>
          <Button variant="ghost" size="sm" onClick={() => toggleAll(true)} disabled={rows.length === 0}>
            Enable all
          </Button>
          <Button variant="ghost" size="sm" onClick={() => toggleAll(false)} disabled={rows.length === 0}>
            Disable all
          </Button>
        </div>
      </div>

      {catalog.loading ? (
        <LoadingState rows={6} />
      ) : catalog.error ? (
        <ErrorState message={catalog.error} onRetry={catalog.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No models registered"
          description="Apply migrations 021 and 024, then click “Sync now” to import live models from the Google, Groq and OpenRouter APIs. The catalog refreshes automatically every day."
        />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group} className="overflow-hidden rounded-xl border bg-card">
              <div className="flex items-center justify-between border-b px-4 py-2.5">
                <p className="text-sm font-semibold">{providerLabel(group)}</p>
                <p className="text-xs text-muted-foreground">
                  {visible.filter((r) => r.provider === group && r.enabled).length} enabled
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Enabled</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="w-56">Label</TableHead>
                    <TableHead className="w-36">Input / 1M</TableHead>
                    <TableHead className="w-36">Output / 1M</TableHead>
                    <TableHead className="w-24">Context</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible
                    .filter((r) => r.provider === group)
                    .map((row) => {
                      const draft = drafts[row.id];
                      if (!draft) return null;
                      return (
                        <TableRow key={row.id} className={row.enabled ? "" : "opacity-60"}>
                          <TableCell>
                            <Switch
                              checked={draft.enabled}
                              onCheckedChange={(checked) => setField(row.id, { enabled: checked })}
                              aria-label={`Toggle ${row.id}`}
                            />
                          </TableCell>
                          <TableCell>
                            <p className="font-mono text-xs">{row.id}</p>
                            {row.notes ? (
                              <Input
                                value={draft.notes}
                                onChange={(e) => setField(row.id, { notes: e.target.value })}
                                placeholder="Internal note"
                                className="mt-1 h-7 text-xs"
                              />
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Input
                              value={draft.label}
                              onChange={(e) => setField(row.id, { label: e.target.value })}
                              className="h-8 text-sm"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.001"
                              min="0"
                              value={draft.inputPerMillion}
                              onChange={(e) => setField(row.id, { inputPerMillion: e.target.value })}
                              className="h-8 text-sm tabular-nums"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.001"
                              min="0"
                              value={draft.outputPerMillion}
                              onChange={(e) => setField(row.id, { outputPerMillion: e.target.value })}
                              className="h-8 text-sm tabular-nums"
                            />
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground tabular-nums">
                            {compact(row.context_window)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          ))}

          <p className="text-xs text-muted-foreground">
            Prices are USD per 1M tokens and drive cost calculation.{" "}
            {overriddenCount(rows) > 0
              ? `${overriddenCount(rows)} model(s) currently override the provider's published rate.`
              : "Provider-reported prices refresh on every sync unless overridden."}
          </p>
        </div>
      )}
    </div>
  );
}

function overriddenCount(rows: ModelRow[]) {
  return rows.filter(
    (r) => r.pricing_override_input !== null || r.pricing_override_output !== null,
  ).length;
}