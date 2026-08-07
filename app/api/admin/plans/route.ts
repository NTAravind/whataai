import { requireGodUser } from "@/lib/auth/guard";
import { handleError, ok, created } from "@/lib/http";
import { createPlan, listPlans, type PlanLimits } from "@/lib/services/plans";

export async function GET(request: Request) {
  try {
    await requireGodUser();
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active") === "true";
    return ok({ plans: await listPlans(activeOnly) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request) {
  try {
    await requireGodUser();
    const body = (await request.json()) as {
      name?: string;
      limits?: PlanLimits;
      is_active?: boolean;
    };
    if (!body.name?.trim()) return handleError(new Error("name is required"));
    return created({ plan: await createPlan({ name: body.name.trim(), limits: body.limits, is_active: body.is_active }) });
  } catch (e) {
    return handleError(e);
  }
}
