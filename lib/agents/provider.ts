import { google } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAICompletions } from "@langchain/openai";
import { supabaseAdmin } from "@/lib/clients/supabase";
import { fetchOpenRouterModels } from "@/lib/openrouter-models";

// ============================================================================
// SINGLE SOURCE OF TRUTH FOR LLM PROVIDERS.
//
// Three layers, narrowest to widest:
//   1. models table (migration 021) — which models the platform exposes at all
//      and what they cost. Managed from /admin/models.
//   2. plans.limits.allowed_models  — which of those a tenant's plan grants.
//   3. the live provider catalog     — what Google/Groq/OpenRouter serve today.
//
// listEnabledModels()      = 1 ∩ 3   (every client dropdown)
// resolveTenantModelId()   = 1 ∩ 2   (lib/agents/model-access.ts)
//
// This file drives:
//   - AI SDK inference  (tenant-runtime.ts ToolLoopAgent)
//   - LangChain/LangGraph inference (graph/nodes.ts, graph/supervisor.ts)
//   - The UI model dropdowns (chat / agent editor pages)
//   - Cost calculation  (pricing.ts)
// ============================================================================

export type ProviderId = "google" | "groq" | "openrouter";

/** The provider to use for inference and as the UI default. */
export const ACTIVE_PROVIDER: ProviderId = "google";

export interface ModelOption {
  id: string;
  label: string;
  provider: ProviderId;
  group: string;
  description?: string;
  /** USD per 1M tokens, from the models table (or the provider when absent). */
  inputPerMillion?: number;
  outputPerMillion?: number;
  contextWindow?: number;
}

export interface ModelRegistryRow {
  id: string;
  provider: ProviderId;
  label: string;
  enabled: boolean;
  input_per_million: number | string;
  output_per_million: number | string;
  pricing_override_input: number | string | null;
  pricing_override_output: number | string | null;
  context_window: number | null;
  max_completion_tokens: number | null;
  notes: string | null;
  updated_at: string;
}

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

// ----------------------------------------------------------------------------
// Fallback catalog used only if a provider's model-list endpoint is unavailable.
// The live provider catalog below is authoritative during normal operation.
// ----------------------------------------------------------------------------
const FALLBACK_MODELS: ModelOption[] = [
  // Gemini (google) — stable / GA models first so DEFAULT_MODEL resolves to one that exists.
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google", group: "Gemini 2.x", description: "Default — fast, low cost" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google", group: "Gemini 2.x" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", provider: "google", group: "Gemini 2.x" },
  { id: "gemini-2.5-flash-lite-preview-06-17", label: "Gemini 2.5 Flash-Lite (preview)", provider: "google", group: "Gemini 2.x" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: "google", group: "Gemini 2.x" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", provider: "google", group: "Gemini 3.x", description: "Latest flash, fastest & most capable" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", provider: "google", group: "Gemini 3.x" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", provider: "google", group: "Gemini 3.x" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", provider: "google", group: "Gemini 3.x" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)", provider: "google", group: "Gemini 3.x" },
  { id: "gemini-3.1-flash-lite-preview-06-17", label: "Gemini 3.1 Flash-Lite (preview)", provider: "google", group: "Gemini 3.x" },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", provider: "google", group: "Gemini 3.x" },
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro (preview)", provider: "google", group: "Gemini 3.x" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview)", provider: "google", group: "Gemini 3.x" },
  // Groq — mirrors the text+text+tools subset of the live Groq catalog.
  { id: "openai/gpt-oss-120b", label: "GPT OSS 120B", provider: "groq", group: "Groq", description: "Default Groq — most capable open model, 131k context" },
  { id: "openai/gpt-oss-20b", label: "GPT OSS 20B", provider: "groq", group: "Groq", description: "Fast & cheapest, 131k context" },
  { id: "qwen/qwen3.8-27b", label: "Qwen3.8 27B", provider: "groq", group: "Groq", description: "Multimodal input (text+image), 131k context" },
];

// ----------------------------------------------------------------------------
// Pricing (per model id, additive per provider)
// ----------------------------------------------------------------------------
const PRICING: Record<string, ModelPricing> = {
  // google
  "gemini-3.8-flash":          { inputPerMillion: 0.75,  outputPerMillion: 3.75 },
  "gemini-3.6-flash":          { inputPerMillion: 1.50,  outputPerMillion: 7.50 },
  "gemini-3.5-flash":          { inputPerMillion: 1.50,  outputPerMillion: 9.00 },
  "gemini-3.5-flash-lite":     { inputPerMillion: 0.30,  outputPerMillion: 2.50 },
  "gemini-3.1-pro-preview":    { inputPerMillion: 2.00,  outputPerMillion: 12.00 },
  "gemini-3.1-flash-lite":     { inputPerMillion: 0.25,  outputPerMillion: 1.50 },
  "gemini-3-pro-preview":      { inputPerMillion: 2.00,  outputPerMillion: 12.00 },
  "gemini-3-flash-preview":    { inputPerMillion: 0.50,  outputPerMillion: 3.00 },
  "gemini-2.5-pro":            { inputPerMillion: 1.25,  outputPerMillion: 10.00 },
  "gemini-2.5-flash":          { inputPerMillion: 0.30,  outputPerMillion: 2.50 },
  "gemini-2.5-flash-lite":     { inputPerMillion: 0.10,  outputPerMillion: 0.40 },
  "gemini-2.0-flash":          { inputPerMillion: 0.10,  outputPerMillion: 0.40 },
  "gemini-2.0-flash-lite":     { inputPerMillion: 0.075, outputPerMillion: 0.30 },
  // groq (USD per 1M tokens, from api.groq.com/openai/v1/models)
  "openai/gpt-oss-120b":       { inputPerMillion: 0.15,  outputPerMillion: 0.60 },
  "openai/gpt-oss-20b":        { inputPerMillion: 0.075, outputPerMillion: 0.30 },
  "qwen/qwen3.8-27b":          { inputPerMillion: 0.80,  outputPerMillion: 4.00 },
};

const FALLBACK_PRICING: ModelPricing = { inputPerMillion: 0.30, outputPerMillion: 2.50 };

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
export const DEFAULT_MODEL = "gemini-2.5-flash";

type GoogleModel = {
  name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
};

type GroqModel = {
  id?: string;
  active?: boolean;
  name?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  supported_features?: string[];
  pricing?: { prompt?: string; completion?: string };
};

/**
 * Groq serves more than chat models (Whisper transcription, Prompt Guard and
 * Safeguard classifiers, Orpheus speech). None of them can run the agent loop,
 * so require text in, text out, and tool calling before offering a model.
 */
const GROQ_NON_AGENT_MODELS = new Set(["openai/gpt-oss-safeguard-20b"]);

function isGroqAgentModel(model: GroqModel): boolean {
  const id = model.id ?? "";
  if (!id || model.active === false || GROQ_NON_AGENT_MODELS.has(id)) return false;
  const textIn = model.input_modalities?.includes("text");
  const textOut = model.output_modalities?.includes("text");
  const tools = model.supported_features?.includes("tools");
  return Boolean(textIn && textOut && tools);
}

let cachedModels = FALLBACK_MODELS;
let cacheExpiresAt = 0;

/** Prices reported by the provider, merged over PRICING so new models bill correctly. */
const livePricing = new Map<string, ModelPricing>();

/**
 * Prices from the models table (admin override first). Populated as a side
 * effect of listModelRegistry() so the synchronous resolvePricing() used by
 * cost calculation still sees admin edits.
 */
const registryPricing = new Map<string, ModelPricing>();

function groupForModel(id: string, provider: ProviderId) {
  if (provider === "groq") return "Groq";
  if (provider === "openrouter") return "OpenRouter";
  const generation = id.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1];
  return generation ? `Gemini ${generation}.x` : "Gemini";
}

function modelLabelFromId(id: string) {
  const trimmed = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
  return trimmed
    .split("-")
    .map((segment) => segment.length ? `${segment[0].toUpperCase()}${segment.slice(1)}` : segment)
    .join(" ");
}

async function fetchGoogleModels(): Promise<ModelOption[]> {
  if (!GOOGLE_API_KEY) return [];

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: { "x-goog-api-key": GOOGLE_API_KEY },
    next: { revalidate: 86400 }, // cache for 1 day; Inngest cron syncs daily
  });
  if (!response.ok) throw new Error(`Google model discovery failed (${response.status})`);

  const data = await response.json() as { models?: GoogleModel[] };
  return (data.models ?? [])
    .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
    .map((model) => {
      const id = model.name?.replace(/^models\//, "") ?? "";
      return {
        id,
        label: model.displayName ?? modelLabelFromId(id),
        provider: "google" as const,
        group: groupForModel(id, "google"),
      };
    })
    .filter((model) => model.id.startsWith("gemini-"));
}

async function fetchGroqModels(): Promise<ModelOption[]> {
  if (!GROQ_API_KEY) return [];

  const response = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    next: { revalidate: 86400 }, // cache for 1 day; Inngest cron syncs daily
  });
  if (!response.ok) throw new Error(`Groq model discovery failed (${response.status})`);

  const data = await response.json() as { data?: GroqModel[] };
  return (data.data ?? [])
    .filter(isGroqAgentModel)
    .map((model) => {
      const id = model.id!;
      const prompt = Number(model.pricing?.prompt);
      const completion = Number(model.pricing?.completion);
      if (Number.isFinite(prompt) && Number.isFinite(completion)) {
        livePricing.set(id, {
          inputPerMillion: prompt * 1_000_000,
          outputPerMillion: completion * 1_000_000,
        });
      }
      return {
        id,
        label: model.name ?? modelLabelFromId(id),
        provider: "groq" as const,
        group: "Groq",
      };
    });
}

/**
 * OpenRouter is an aggregator: every model is `vendor/model`, so its ids can
 * collide with Groq's (e.g. `openai/gpt-oss-120b`). Collisions are resolved by
 * listAvailableModels(), which keeps the first provider to report an id — so
 * Google/Groq win and OpenRouter only contributes models they do not serve.
 *
 * Every tool-capable model is returned (not just the free ones); they all land
 * in the registry switched OFF until a god user enables them.
 */
async function fetchOpenRouterCatalog(): Promise<ModelOption[]> {
  if (!OPENROUTER_API_KEY) return [];

  const models = await fetchOpenRouterModels({ freeOnly: false, toolsOnly: true });
  return models.map((model) => ({
    id: model.id,
    label: model.name || modelLabelFromId(model.id),
    provider: "openrouter" as const,
    group: groupForModel(model.id, "openrouter"),
    contextWindow: model.contextLength,
    // Carried into livePricing by listAvailableModels() after de-duplication.
    inputPerMillion: model.inputPerMillion,
    outputPerMillion: model.outputPerMillion,
  }));
}

/** Returns the provider-reported catalog shared by the UI and every runtime. */
export async function listAvailableModels() {
  if (Date.now() < cacheExpiresAt) return cachedModels;

  const settled = await Promise.allSettled([
    fetchGoogleModels(),
    fetchGroqModels(),
    fetchOpenRouterCatalog(),
  ]);
  const discovered = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  // One row per model id: the first provider to report an id owns it, so an
  // id served by both Groq and OpenRouter never shows up twice in a dropdown
  // or routes to the wrong SDK.
  const seen = new Set<string>();
  const models = discovered.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });

  for (const model of models) {
    if (model.inputPerMillion === undefined || model.outputPerMillion === undefined) continue;
    livePricing.set(model.id, {
      inputPerMillion: model.inputPerMillion,
      outputPerMillion: model.outputPerMillion,
    });
  }

  if (models.length > 0) {
    cachedModels = models;
  } else {
    console.warn("[provider] Model discovery failed for every configured provider; using cached catalog");
  }
  // Keep in sync with the Inngest daily cron — refresh at most once per day.
  cacheExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
  return cachedModels;
}

/**
 * The platform's own model records. Empty if migration 021 has not been applied
 * yet — callers fall back to the full catalog so a missing table degrades to
 * today's behaviour rather than hiding every model.
 */
export async function listModelRegistry(): Promise<ModelRegistryRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("models")
    .select("*")
    .order("provider", { ascending: true })
    .order("label", { ascending: true });

  if (error) {
    console.warn(`[provider] Model registry unavailable (${error.message}); treating every discovered model as enabled`);
    return [];
  }

  const rows = (data ?? []) as ModelRegistryRow[];
  for (const row of rows) registryPricing.set(row.id, registryPrice(row));
  return rows;
}

function registryPrice(row: ModelRegistryRow): ModelPricing {
  const overrideIn = row.pricing_override_input === null ? NaN : Number(row.pricing_override_input);
  const overrideOut = row.pricing_override_output === null ? NaN : Number(row.pricing_override_output);
  if (Number.isFinite(overrideIn) && Number.isFinite(overrideOut)) {
    return { inputPerMillion: overrideIn, outputPerMillion: overrideOut };
  }
  return { inputPerMillion: Number(row.input_per_million), outputPerMillion: Number(row.output_per_million) };
}

/**
 * The catalog clients may pick from: models that are live on the provider AND
 * switched on in the models table. Prices come from the registry so the admin
 * page's pricing edits are what billing uses.
 *
 * When the registry is unreadable (table missing) this returns the full live
 * catalog rather than nothing, so a failed lookup can't take the product down.
 */
export async function listEnabledModels(): Promise<ModelOption[]> {
  const [catalog, registry] = await Promise.all([listAvailableModels(), listModelRegistry()]);
  if (registry.length === 0) return catalog;

  const byId = new Map(registry.map((row) => [row.id, row]));
  return catalog.flatMap((model) => {
    const row = byId.get(model.id);
    if (!row || !row.enabled) return [];
    const price = registryPrice(row);
    return [{
      ...model,
      label: row.label || model.label,
      inputPerMillion: price.inputPerMillion,
      outputPerMillion: price.outputPerMillion,
      contextWindow: row.context_window ?? model.contextWindow,
    }];
  });
}

/**
 * Insert provider models the registry has never seen, switched OFF.
 *
 * A newly released model must be deliberately enabled by a god user rather than
 * silently appearing in every tenant's dropdown. Existing rows are never
 * touched, so admin pricing edits survive re-sync. Provider-reported prices
 * only refresh for models with no override set.
 */
/** Rows per bulk write — the first OpenRouter sync registers ~400 models. */
const SYNC_CHUNK = 50;

function chunkRows<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += SYNC_CHUNK) out.push(rows.slice(i, i + SYNC_CHUNK));
  return out;
}

export async function syncModelCatalog(): Promise<{ inserted: string[] }> {
  const [catalog, registry] = await Promise.all([listAvailableModels(), listModelRegistry()]);
  if (registry.length === 0) return { inserted: [] };

  const known = new Set(registry.map((row) => row.id));
  const fresh = catalog.filter((model) => !known.has(model.id));
  const inserted: string[] = [];

  const freshRows = fresh.map((model) => {
    const price = livePricing.get(model.id) ?? PRICING[model.id] ?? { inputPerMillion: 0, outputPerMillion: 0 };
    return {
      id: model.id,
      provider: model.provider,
      label: model.label,
      enabled: false,
      input_per_million: price.inputPerMillion,
      output_per_million: price.outputPerMillion,
      context_window: model.contextWindow ?? null,
    };
  });

  for (const rows of chunkRows(freshRows)) {
    // DO NOTHING on an id that appeared since the registry read, so a
    // concurrent sync can never overwrite an admin edit.
    const { error } = await supabaseAdmin()
      .from("models")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) {
      console.warn(`[provider] Model insert failed (${error.message}); ${rows.length} model(s) skipped`);
      continue;
    }
    inserted.push(...rows.map((row) => row.id));
  }

  // Refresh provider-reported prices, but never stomp on an admin override —
  // and only write rows whose stored rate actually differs, so the daily sync
  // stays cheap now that the catalog is in the hundreds.
  const stale: { id: string; inputPerMillion: number; outputPerMillion: number }[] = [];
  for (const model of catalog) {
    const reported = livePricing.get(model.id);
    if (!reported) continue;
    const row = registry.find((r) => r.id === model.id);
    if (!row || row.pricing_override_input !== null || row.pricing_override_output !== null) continue;

    const current = registryPrice(row);
    if (
      current.inputPerMillion === reported.inputPerMillion &&
      current.outputPerMillion === reported.outputPerMillion
    ) {
      livePricing.delete(model.id);
      continue;
    }
    stale.push({ id: model.id, ...reported });
  }

  for (const row of stale) {
    const { error } = await supabaseAdmin()
      .from("models")
      .update({
        input_per_million: row.inputPerMillion,
        output_per_million: row.outputPerMillion,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) {
      console.warn(`[provider] Price refresh failed for ${row.id} (${error.message}); it keeps its old rate`);
      continue;
    }
    livePricing.delete(row.id);
  }

  return { inserted };
}

export interface ModelRegistryPatch {
  enabled?: boolean;
  label?: string;
  inputPerMillion?: number;
  outputPerMillion?: number;
  contextWindow?: number | null;
  notes?: string | null;
  /** True clears the pricing override so provider rates apply again. */
  clearPricingOverride?: boolean;
}

/** Apply a god-mode edit to one registry row. */
export async function updateModelRegistry(id: string, patch: ModelRegistryPatch): Promise<ModelRegistryRow> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.label !== undefined) update.label = patch.label.trim() || id;
  if (patch.inputPerMillion !== undefined) update.input_per_million = patch.inputPerMillion;
  if (patch.outputPerMillion !== undefined) update.output_per_million = patch.outputPerMillion;
  if (patch.contextWindow !== undefined) update.context_window = patch.contextWindow;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.clearPricingOverride) {
    update.pricing_override_input = null;
    update.pricing_override_output = null;
  }

  const { data, error } = await supabaseAdmin()
    .from("models")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;

  livePricing.delete(id);
  registryPricing.set(id, registryPrice(data as ModelRegistryRow));
  return data as ModelRegistryRow;
}

/**
 * Resolve a user or agent model selection to a supported model.
 *
 * Validates against the FULL provider catalog, not the enabled subset, so an
 * agent already pointing at a model that was later switched off in
 * /admin/models keeps running instead of failing mid-conversation. New
 * selections are gated by resolveTenantModelId() at save time.
 */
export async function resolveModelId(modelId?: unknown): Promise<string> {
  if (modelId == null || modelId === "") return DEFAULT_MODEL;
  if (typeof modelId !== "string") throw new Error("model must be a string");

  const id = modelId.trim();
  const models = await listAvailableModels();
  if (!models.some((model) => model.id === id)) {
    throw new Error(`Unsupported model: ${modelId}`);
  }
  return id;
}

export function modelOption(id: string | undefined | null): ModelOption | undefined {
  if (!id) return undefined;
  return cachedModels.find((model) => model.id === id);
}

export function modelLabel(id: string | undefined | null): string {
  return modelOption(id)?.label ?? id ?? DEFAULT_MODEL;
}

/** Which provider handles a known model id. Missing values use ACTIVE_PROVIDER. */
export function providerOfModel(id: string | undefined | null): ProviderId {
  return modelOption(id)?.provider ?? ACTIVE_PROVIDER;
}

export function resolvePricing(modelName: string): ModelPricing {
  const normalized = modelName.toLowerCase();
  if (registryPricing.has(normalized)) return registryPricing.get(normalized)!;
  if (livePricing.has(normalized)) return livePricing.get(normalized)!;
  if (PRICING[normalized]) return PRICING[normalized];
  for (const [key, val] of Object.entries(PRICING)) {
    if (normalized.startsWith(key)) return val;
  }
  return FALLBACK_PRICING;
}

export function calculateCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = resolvePricing(modelName);
  const inputCost = (inputTokens / 1_000_000) * p.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * p.outputPerMillion;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

// ----------------------------------------------------------------------------
// SDK factories — the ONLY place that touches provider SDK classes.
// Call these everywhere instead of constructing Google/Groq models directly.
// ----------------------------------------------------------------------------

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Get the active AI SDK model (used by ToolLoopAgent in tenant-runtime). */
export function getAISDKModel(modelId?: string | null) {
  const id = modelId ?? DEFAULT_MODEL;
  if (!modelOption(id)) throw new Error(`Unsupported model: ${id}`);
  switch (providerOfModel(id)) {
    case "groq":
      return createGroq({ apiKey: GROQ_API_KEY })(id);
    case "openrouter":
      return createOpenRouter({
        apiKey: OPENROUTER_API_KEY,
        baseURL: OPENROUTER_BASE_URL,
        appName: "WhataAI",
      })(id);
    case "google":
    default:
      return google(id);
  }
}

/**
 * Get the active LangChain model (used by the LangGraph nodes/supervisor).
 *
 * OpenRouter speaks the OpenAI Chat Completions protocol, so it goes through
 * `ChatOpenAICompletions` (never the Responses API) pointed at OpenRouter's
 * base URL — tool calling is the one thing the inbound pipeline depends on.
 */
export function getLangChainModel(modelId?: string | null, temperature = 0.7, modelConfig?: Record<string, unknown>) {
  const id = modelId ?? DEFAULT_MODEL;
  if (!modelOption(id)) throw new Error(`Unsupported model: ${id}`);
  switch (providerOfModel(id)) {
    case "groq":
      return new ChatGroq({ model: id, temperature, apiKey: GROQ_API_KEY });
    case "openrouter":
      return new ChatOpenAICompletions({
        model: id,
        temperature,
        apiKey: OPENROUTER_API_KEY,
        configuration: {
          baseURL: OPENROUTER_BASE_URL,
          defaultHeaders: { "X-Title": "WhataAI" },
        },
      });
    case "google":
    default:
      const mcfg = (modelConfig as any) || ({} as any);
      const thinking = (mcfg?.thinking as any) || (mcfg?.thinkingConfig as any) || {};
      const thinkingParams: any = {};
      if (thinking.budget !== undefined && thinking.budget >= 0) {
        thinkingParams.thinkingBudget = thinking.budget;
      }
      if (thinking.level) {
        thinkingParams.thinkingLevel = thinking.level;
      }
      return new ChatGoogleGenerativeAI({
        model: id,
        temperature,
        apiKey: GOOGLE_API_KEY,
        maxOutputTokens: mcfg?.maxTokens ?? mcfg?.max_output_tokens,
        thinkingConfig: Object.keys(thinkingParams).length ? thinkingParams : undefined,
      });
  }
}
