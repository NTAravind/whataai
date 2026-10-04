import { requireGodUser } from "@/lib/auth/guard";
import { handleError, ok } from "@/lib/http";
import { listModelRegistry, syncModelCatalog } from "@/lib/agents/provider";

/**
 * POST — import models the providers report that the registry has not seen yet.
 *
 * Kept out of GET so read paths (the plans page listing available models) never
 * trigger writes. New models arrive switched OFF and must be enabled by hand.
 */
export async function POST() {
  try {
    await requireGodUser();
    const { inserted } = await syncModelCatalog();
    return ok({ models: await listModelRegistry(), inserted });
  } catch (e) {
    return handleError(e);
  }
}