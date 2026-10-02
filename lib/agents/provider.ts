import { google } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";

// ============================================================================
// SINGLE SOURCE OF TRUTH FOR LLM PROVIDERS.
//
// Edit ONLY this file to switch the AI provider and/or models. It drives:
//   - AI SDK inference  (tenant-runtime.ts ToolLoopAgent)
//   - LangChain/LangGraph inference (graph/nodes.ts, graph/supervisor.ts)
//   - The UI model dropdowns (chat / agent editor pages)
//   - Cost calculation  (pricing.ts)
// ============================================================================

export type ProviderId = "google" | "groq";

/** The provider to use for inference and as the UI default. */
export const ACTIVE_PROVIDER: ProviderId = "google";

export interface ModelOption {
  id: string;
  label: string;
  provider: ProviderId;
  group: string;
  description?: string;
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
  // Groq
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile", provider: "groq", group: "Groq", description: "Default Groq — fast, strong reasoning" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant", provider: "groq", group: "Groq", description: "Fast & low cost" },
  { id: "llama-3.3-70b-specdec", label: "Llama 3.3 70B SpecDec", provider: "groq", group: "Groq" },
  { id: "llama-3.1-70b-versatile", label: "Llama 3.1 70B Versatile", provider: "groq", group: "Groq" },
  { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B", provider: "groq", group: "Groq" },
  { id: "gemma2-9b-it", label: "Gemma 2 9B", provider: "groq", group: "Groq" },
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
  // groq (USD per 1M tokens, public pricing)
  "llama-3.3-70b-versatile":   { inputPerMillion: 0.59,  outputPerMillion: 0.79 },
  "llama-3.1-8b-instant":      { inputPerMillion: 0.05,  outputPerMillion: 0.08 },
  "llama-3.3-70b-specdec":     { inputPerMillion: 0.59,  outputPerMillion: 0.99 },
  "llama-3.1-70b-versatile":   { inputPerMillion: 0.59,  outputPerMillion: 0.79 },
  "mixtral-8x7b-32768":        { inputPerMillion: 0.24,  outputPerMillion: 0.24 },
  "gemma2-9b-it":              { inputPerMillion: 0.20,  outputPerMillion: 0.20 },
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
};

let cachedModels = FALLBACK_MODELS;
let cacheExpiresAt = 0;

function groupForModel(id: string, provider: ProviderId) {
  if (provider === "groq") return "Groq";
  const generation = id.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1];
  return generation ? `Gemini ${generation}.x` : "Gemini";
}

function modelLabelFromId(id: string) {
  return id
    .split("-")
    .map((segment) => segment.length ? `${segment[0].toUpperCase()}${segment.slice(1)}` : segment)
    .join(" ");
}

async function fetchGoogleModels(): Promise<ModelOption[]> {
  if (!GOOGLE_API_KEY) return [];

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: { "x-goog-api-key": GOOGLE_API_KEY },
    next: { revalidate: 300 },
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
    next: { revalidate: 300 },
  });
  if (!response.ok) throw new Error(`Groq model discovery failed (${response.status})`);

  const data = await response.json() as { data?: GroqModel[] };
  return (data.data ?? [])
    .filter((model) => model.active !== false && typeof model.id === "string")
    .map((model) => ({
      id: model.id!,
      label: modelLabelFromId(model.id!),
      provider: "groq" as const,
      group: "Groq",
    }));
}

/** Returns the provider-reported catalog shared by the UI and every runtime. */
export async function listAvailableModels() {
  if (Date.now() < cacheExpiresAt) return cachedModels;

  const settled = await Promise.allSettled([fetchGoogleModels(), fetchGroqModels()]);
  const models = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);

  if (models.length > 0) {
    cachedModels = models;
  } else {
    console.warn("[provider] Model discovery failed for every configured provider; using cached catalog");
  }
  cacheExpiresAt = Date.now() + 5 * 60 * 1000;
  return cachedModels;
}

/**
 * Resolve a user or agent model selection to a supported model.
 *
 * Missing values use the application default. Explicit values must be listed
 * in MODELS so the UI and every runtime execute the same model ID.
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

/** Get the active AI SDK model (used by ToolLoopAgent in tenant-runtime). */
export function getAISDKModel(modelId?: string | null) {
  const id = modelId ?? DEFAULT_MODEL;
  if (!modelOption(id)) throw new Error(`Unsupported model: ${id}`);
  switch (providerOfModel(id)) {
    case "groq":
      return createGroq({ apiKey: GROQ_API_KEY })(id);
    case "google":
    default:
      return google(id);
  }
}

/** Get the active LangChain model (used by the LangGraph nodes/supervisor). */
export function getLangChainModel(modelId?: string | null, temperature = 0.7) {
  const id = modelId ?? DEFAULT_MODEL;
  if (!modelOption(id)) throw new Error(`Unsupported model: ${id}`);
  switch (providerOfModel(id)) {
    case "groq":
      return new ChatGroq({ model: id, temperature, apiKey: GROQ_API_KEY });
    case "google":
    default:
      return new ChatGoogleGenerativeAI({
        model: id,
        temperature,
        apiKey: GOOGLE_API_KEY,
      });
  }
}
