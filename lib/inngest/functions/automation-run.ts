import { inngest } from "@/lib/clients/ingest";
import { automationTriggered } from "@/lib/inngest/events";
import { getAutomation } from "@/lib/services/automations";
import { createRun, updateRun } from "@/lib/services/automation-runs";
import { executors } from "@/lib/automations/executors";
import type { ExecContext } from "@/lib/automations/executors";
import type { AutomationStep } from "@/lib/automations/types";
import { supabaseAdmin } from "@/lib/clients/supabase";

/**
 * Durable automation runner (docs/backend.md §9 — file-like background work).
 *
 * Loads the automation, creates an `automation_runs` row, then executes each
 * step inside its own `step.run()` (checkpointed on retry) — `wait` steps use
 * `step.sleep()` instead of a blocking delay so a long chain never holds a
 * worker. Each step's output is accumulated into `variables` under `step_{i}`
 * for later interpolation. The chain stops and the run is marked `failed` on
 * the first step error.
 */
export const automationRun = inngest.createFunction(
  {
    id: "automation-run",
    name: "Automation Run",
    triggers: [automationTriggered],
    retries: 3,
  },
  async ({ event, step, logger }) => {
    const d = event.data;

    const resolved = await step.run("resolve-context", async () => {
      const automation = await getAutomation(d.tenantId, d.automationId);
      if (!automation.is_active) return { skipped: true as const };

      const [contact, waAccount, lastInbound] = await Promise.all([
        d.contactId
          ? supabaseAdmin()
              .from("contacts")
              .select("id, full_name, phone_number")
              .eq("id", d.contactId)
              .eq("tenant_id", d.tenantId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabaseAdmin()
          .from("wa_accounts")
          .select("id, tenant_id, wa_phone_number_id, access_token")
          .eq("tenant_id", d.tenantId)
          .eq("status", "active")
          .limit(1)
          .maybeSingle(),
        d.conversationId
          ? supabaseAdmin()
              .from("messages")
              .select("content")
              .eq("conversation_id", d.conversationId)
              .eq("role", "user")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const inboundContent = lastInbound?.data?.content as { text?: string } | undefined;
      return {
        skipped: false as const,
        automation,
        contact: contact?.data ?? null,
        waAccount: waAccount?.data ?? null,
        lastMessage: inboundContent?.text ?? null,
      };
    });

    if (resolved.skipped) {
      return { skipped: true, reason: "automation_inactive" };
    }

    const { automation, contact, waAccount, lastMessage } = resolved;

    const run = await step.run("create-run", async () =>
      createRun({
        tenantId: d.tenantId,
        automationId: automation.id,
        conversationId: d.conversationId ?? null,
        contactId: d.contactId ?? null,
        eventId: event.id,
      }),
    );

    const variables: Record<string, unknown> = { ...d.variables };
    const stepResults: Array<Record<string, unknown>> = [];

    const baseCtx: ExecContext = {
      tenantId: d.tenantId,
      automationId: automation.id,
      conversationId: d.conversationId ?? null,
      contact,
      waAccount: waAccount
        ? {
            id: waAccount.id,
            tenant_id: waAccount.tenant_id,
            wa_phone_number_id: waAccount.wa_phone_number_id,
            access_token: waAccount.access_token,
          }
        : null,
      variables,
      // Only used as a fallback — `wait` steps run through `step.sleep()`
      // directly below; executors of other types never call it.
      sleep: async () => undefined,
    };
    variables.contact = contact
      ? { name: contact.full_name, phone: contact.phone_number }
      : undefined;
    variables.conversation = { lastMessage };

    for (let i = 0; i < automation.steps.length; i++) {
      const stepDef = automation.steps[i] as AutomationStep;
      const type = stepDef.type;

      if (type === "wait") {
        const output = await step.sleep(`step-wait-${i}`, `${stepDef.seconds}s`);
        variables[`step_${i}`] = output;
        stepResults.push({ index: i, type, status: "completed", output });
        continue;
      }

      try {
        const output = await step.run(`step-${i}`, async () => {
          return await executors[type](stepDef, { ...baseCtx, variables });
        });
        variables[`step_${i}`] = output;
        stepResults.push({ index: i, type, status: "completed", output });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        stepResults.push({ index: i, type, status: "failed", error: message });
        logger.error("automation step failed", {
          runId: run.id,
          stepIndex: i,
          stepType: type,
          automationId: automation.id,
        });
        await step.run("mark-failed", () =>
          updateRun(d.tenantId, run.id, { status: "failed", stepResults, error: message }),
        );
        throw err;
      }
    }

    await step.run("mark-completed", () => updateRun(d.tenantId, run.id, { status: "completed", stepResults }));
    return { runId: run.id, steps: stepResults.length };
  },
);