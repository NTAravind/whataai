import { inngest } from "@/lib/clients/ingest";
import { cron } from "inngest";
import { supabaseAdmin } from "@/lib/clients/supabase";

/**
 * Monthly token/cost counter reconciliation (docs/guide.md §7 —
 * `usage.reconcile`). usage_events is the audit trail; usage_counters is the
 * fast-path budget read. Both write paths are eventually consistent by design;
 * this cron recomputes counters from events so drift never sticks.
 */
export const usageReconcile = inngest.createFunction(
  {
    id: "usage-reconcile",
    name: "Usage Counter Reconciliation",
    triggers: [cron("TZ=Etc/UTC 0 0 1 * *")],
    retries: 2,
  },
  async ({ step, logger }) => {
    const perTenant = await step.run("list-tenants-with-usage", async () => {
      const { data, error } = await supabaseAdmin()
        .from("usage_events")
        .select("tenant_id");
      if (error) throw error;
      return Array.from(new Set((data ?? []).map((r) => r.tenant_id)));
    });

    let reconciled = 0;
    for (const tenantId of perTenant) {
      const ok = await step.run(`reconcile-${tenantId}`, async () => {
        const { error } = await supabaseAdmin().rpc("recompute_usage_counters", {
          tenant_id: tenantId,
        });
        return !error;
      });
      if (ok) reconciled++;
    }

    logger.info("usage counters reconciled", { tenants: perTenant.length, reconciled });
    return { tenants: perTenant.length, reconciled };
  },
);
