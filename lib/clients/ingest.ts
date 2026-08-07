import { Inngest } from "inngest";

/**
 * Inngest client — Inngest SDK v4.
 *
 * Dev/cloud mode:
 *   - Local dev: run with `INNGEST_DEV=1` (or set NODE_ENV !== "production")
 *     so the SDK talks to the Dev Server at http://localhost:8288.
 *   - Production: requires `INNGEST_SIGNING_KEY` (and `INNGEST_EVENT_KEY`
 *     for sending events). Both are set automatically by the Vercel
 *     integration.
 *
 * Checkpointing: v4 checkpointing is enabled by default. On serverless
 * platforms (Vercel) set `checkpointing.maxRuntime` slightly below your
 * function's max duration, and export `maxDuration` on /api/inngest.
 */
const isDev = process.env.INNGEST_DEV === "1" || process.env.NODE_ENV !== "production";

export const inngest = new Inngest({
  id: "whataai",
  isDev,
  checkpointing: {
    // Vercel free/hobby max is 60s; pro is 300s. Tune to your plan.
    maxRuntime: "50s",
  },
});

// Backwards-compatible alias for existing imports.
export const ingest = inngest;
