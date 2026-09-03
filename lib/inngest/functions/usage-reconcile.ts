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
    const reconciled = await step.run("recompute-all-counters", async () => {
      // recompute_usage_counters() rebuilds this month's counters from
      // usage_events for every tenant in a single atomic pass.
      const { data, error } = await supabaseAdmin().rpc("recompute_usage_counters");
      if (error) throw error;
      return data as number; // returns the number of tenant rows inserted
    });

    logger.info("usage counters reconciled", { reconciledRows: reconciled });
    return { reconciledRows: reconciled };
  },
);
