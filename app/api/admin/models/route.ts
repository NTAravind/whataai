import { requireGodUser } from "@/lib/auth/guard";
import { handleError, ok } from "@/lib/http";
import {
  listModelRegistry,
  updateModelRegistry,
  type ModelRegistryPatch,
} from "@/lib/agents/provider";

/** GET — read the registry only. Use POST /api/admin/models/sync to import. */
export async function GET() {
  try {
    await requireGodUser();
    return ok({ models: await listModelRegistry() });
  } catch (e) {
    return handleError(e);
  }
}

export interface ModelPatchBody extends ModelRegistryPatch {
  id: string;
}

/** PATCH — apply several registry edits at once (the page's bulk save). */
export async function PATCH(request: Request) {
  try {
    await requireGodUser();
    const body = (await request.json()) as { updates?: ModelPatchBody[] };

    for (const { id, ...patch } of body.updates ?? []) {
      if (!id) throw new Error("id is required");
      await updateModelRegistry(id, patch);
    }

    return ok({ models: await listModelRegistry() });
  } catch (e) {
    return handleError(e);
  }
}