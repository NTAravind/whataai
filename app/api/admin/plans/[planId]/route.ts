import { requireGodUser } from "@/lib/auth/guard";
import { handleError, ok, noContent } from "@/lib/http";
import { deletePlan, getPlan, updatePlan, type PlanLimits } from "@/lib/services/plans";

type Ctx = { params: Promise<{ planId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    await requireGodUser();
    const { planId } = await params;
    return ok({ plan: await getPlan(planId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    await requireGodUser();
    const { planId } = await params;
    const body = (await request.json()) as {
      name?: string;
      limits?: PlanLimits;
      is_active?: boolean;
    };
    return ok({ plan: await updatePlan(planId, body) });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    await requireGodUser();
    const { planId } = await params;
    await deletePlan(planId);
    return noContent();
  } catch (e) {
    return handleError(e);
  }
}
