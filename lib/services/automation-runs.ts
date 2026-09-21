import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import { HttpError } from "@/lib/http";

export interface AutomationRunRow {
  id: string;
  tenant_id: string;
  automation_id: string;
  conversation_id: string | null;
  contact_id: string | null;
  status: "running" | "completed" | "failed";
  step_results: Array<{
    index: number;
    type: string;
    status: "running" | "completed" | "failed";
    output?: unknown;
    error?: string;
  }>;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface AutomationRunView extends AutomationRunRow {
  durationMs: number | null;
}

/** Summary row — what list endpoints return (NO step_results). */
export interface AutomationRunSummaryRow {
  id: string;
  tenant_id: string;
  automation_id: string;
  conversation_id: string | null;
  contact_id: string | null;
  status: "running" | "completed" | "failed";
  error: string | null;
  started_at: string;
  finished_at: string | null;
  /** jsonb_array_length(step_results) — computed by the migration's view. */
  steps_count: number;
}

export interface AutomationRunSummaryView extends AutomationRunSummaryRow {
  durationMs: number | null;
}

/** Append contact name for the run-history UI. */
export interface AutomationRunRowWithContact extends AutomationRunView {
  contact?: { full_name: string | null; phone_number: string | null };
}

export interface AutomationRunSummaryWithContact extends AutomationRunSummaryView {
  contact?: { full_name: string | null; phone_number: string | null };
}

function toView(row: AutomationRunRow): AutomationRunView {
  const started = new Date(row.started_at).getTime();
  const finished = row.finished_at ? new Date(row.finished_at).getTime() : null;
  return {
    ...row,
    durationMs: finished !== null && started ? Math.max(0, finished - started) : null,
  };
}

function toSummaryView(row: AutomationRunSummaryRow): AutomationRunSummaryView {
  const started = new Date(row.started_at).getTime();
  const finished = row.finished_at ? new Date(row.finished_at).getTime() : null;
  return {
    ...row,
    durationMs: finished !== null && started ? Math.max(0, finished - started) : null,
  };
}

/**
 * List runs WITHOUT step_results (see the migration's summary view). The run
 * history UI gets status + duration + a step count; per-step detail requires
 * getRun().
 */
export async function listRuns(
  tenantId: string,
  automationId: string,
): Promise<AutomationRunSummaryWithContact[]> {
  const data = unwrap(
    await supabaseAdmin()
      .from("automation_runs_summary")
      .select("*, contact:contacts(full_name, phone_number)")
      .eq("tenant_id", tenantId)
      .eq("automation_id", automationId)
      .order("started_at", { ascending: false })
      .limit(100),
  );
  return (data as (AutomationRunSummaryRow & { contact: { full_name: string | null; phone_number: string | null } | null })[]).map(
    (row) => ({ ...toSummaryView(row), contact: row.contact ?? undefined }) as AutomationRunSummaryWithContact,
  );
}

/** Full run incl. step_results — detail views only. */
export async function getRun(tenantId: string, runId: string): Promise<AutomationRunView> {
  const { data, error } = await supabaseAdmin()
    .from("automation_runs")
    .select("*, contact:contacts(full_name, phone_number)")
    .eq("id", runId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "run not found");
  return toView(data as AutomationRunRow);
}

/**
 * Insert a run row before the durable function executes so run history shows a
 * "running" entry immediately and a crash leaves an auditable trace.
 *
 * Idempotent: pass the triggering Inngest event id and a rebroadcast of the
 * same event reuses the existing run instead of creating a duplicate.
 */
export async function createRun(input: {
  tenantId: string;
  automationId: string;
  conversationId?: string | null;
  contactId?: string | null;
  eventId?: string | null;
}): Promise<AutomationRunRow> {
  // Rebroadcast of the same automation/event pair → reuse the existing run row.
  if (input.eventId) {
    const existing = await supabaseAdmin()
      .from("automation_runs")
      .select("*")
      .eq("automation_id", input.automationId)
      .eq("event_id", input.eventId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return existing.data as AutomationRunRow;
  }

  const value = {
    tenant_id: input.tenantId,
    automation_id: input.automationId,
    conversation_id: input.conversationId ?? null,
    contact_id: input.contactId ?? null,
    status: "running",
    step_results: [],
    event_id: input.eventId ?? null,
  };

  // Upsert by (automation_id, event_id) — on a race, Postgres itself returns
  // the winner row and we do the same re-read the insert would have masked.
  const { data, error } = await supabaseAdmin()
    .from("automation_runs")
    .upsert(value, { onConflict: "automation_id,event_id", ignoreDuplicates: true })
    .select()
    .single();
  if (error) throw error;
  return data as AutomationRunRow;
}

export async function updateRun(
  tenantId: string,
  runId: string,
  patch: {
    status: "running" | "completed" | "failed";
    stepResults?: Array<Record<string, unknown>>;
    error?: string | null;
  },
): Promise<void> {
  const update: Record<string, unknown> = {
    status: patch.status,
    finished_at: patch.status === "running" ? null : new Date().toISOString(),
  };
  if (patch.stepResults !== undefined) update.step_results = patch.stepResults;
  if (patch.error !== undefined) update.error = patch.error;
  const { error } = await supabaseAdmin()
    .from("automation_runs")
    .update(update)
    .eq("id", runId)
    .eq("tenant_id", tenantId);
  if (error) throw error;
}