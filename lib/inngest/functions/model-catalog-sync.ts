import { inngest } from "@/lib/clients/ingest";
import { cron } from "inngest";
import { syncModelCatalog } from "@/lib/agents/provider";

/**
 * Daily model catalog sync.
 *
 * Fetches the live model list from every configured provider (Google Gemini,
 * Groq, OpenRouter) and upserts new models into the `models` table, switched OFF. This
 * mirrors what the "Sync providers" button in /admin/models does, but runs
 * automatically once a day at 02:00 UTC so the catalog never drifts silently.
 *
 * Existing rows are never overwritten — admin pricing edits and enabled flags
 * survive re-sync. Provider-reported prices only refresh for rows without an
 * admin override.
 */
export const modelCatalogSync = inngest.createFunction(
  {
    id: "model-catalog-sync",
    name: "Daily Model Catalog Sync",
    triggers: [cron("TZ=Etc/UTC 0 2 * * *")],
    retries: 3,
  },
  async ({ step, logger }) => {
    const result = await step.run("fetch-and-sync-provider-models", async () => {
      return syncModelCatalog();
    });

    if (result.inserted.length > 0) {
      logger.info("model-catalog-sync: new models discovered", {
        count: result.inserted.length,
        models: result.inserted,
      });
    } else {
      logger.info("model-catalog-sync: catalog up to date");
    }

    return { inserted: result.inserted, syncedAt: new Date().toISOString() };
  },
);
