import { HttpError } from "@/lib/http";
import { resolveEntitlements } from "@/lib/entitlements/resolve";
import {
  DEFAULT_MODEL,
  listAvailableModels,
  listEnabledModels,
  type ModelOption,
} from "@/lib/agents/provider";

// ============================================================================
// PER-TENANT MODEL ACCESS.
//
// The platform-wide gate lives in provider.ts (the models table). This module
// layers the tenant's PLAN grant on top of it:
//
//   enabled catalog  ∩  plans.limits.allowed_models   =  what a tenant may pick
//
// A plan with no allowed_models entry grants the whole enabled catalog, so an
// existing plan keeps working untouched. Call sites:
//   - tenantModelOptions()    client dropdowns (/api/tenants/:id/models)
//   - resolveTenantModelId()  save-time validation (lib/services/agents.ts,
//                             /api/tenants/:id/chat)
// ============================================================================

/** Models a tenant may select: enabled in /admin/models and granted by its plan. */
export async function tenantModelOptions(tenantId: string): Promise<ModelOption[]> {
  const [enabled, entitlements] = await Promise.all([
    listEnabledModels(),
    resolveEntitlements(tenantId),
  ]);

  if (entitlements.allowedModels.length === 0) return enabled;

  const granted = new Set(entitlements.allowedModels);
  return enabled.filter((model) => granted.has(model.id));
}

/** The model this tenant falls back to, guaranteed to be selectable. */
async function tenantFallbackModel(tenantId: string): Promise<string> {
  const entitlements = await resolveEntitlements(tenantId);
  return entitlements.defaultModel || DEFAULT_MODEL;
}

/**
 * Validate a model selection at save time.
 *
 * - missing/blank        -> the platform default
 * - a real, model that is no longer live on the provider -> throw (genuinely broken)
 * - a model that is live but disabled or out-of-plan -> the tenant's fallback,
 *   so an admin toggle or plan edit never silently breaks a live agent.
 */
export async function resolveTenantModelId(
  tenantId: string,
  modelId?: unknown,
): Promise<{ model: string; fellBack: boolean; reason?: string }> {
  if (modelId == null || modelId === "") {
    return { model: DEFAULT_MODEL, fellBack: false };
  }
  if (typeof modelId !== "string") throw new HttpError(400, "model must be a string");

  const requested = modelId.trim();

  const [available, fallback] = await Promise.all([
    tenantModelOptions(tenantId),
    tenantFallbackModel(tenantId),
  ]);

  if (available.some((model) => model.id === requested)) {
    return { model: requested, fellBack: false };
  }

  // Not selectable. If the provider still serves it this is a
  // disabled/out-of-plan model -> downgrade rather than fail.
  const live = await listAvailableModels();
  if (!live.some((model) => model.id === requested)) {
    throw new HttpError(400, `Unknown model: ${requested}`);
  }

  const safeFallback = available.some((model) => model.id === fallback)
    ? fallback
    : available[0]?.id ?? DEFAULT_MODEL;

  return {
    model: safeFallback,
    fellBack: true,
    reason: `"${requested}" is no longer available on this plan; using ${safeFallback}`,
  };
}