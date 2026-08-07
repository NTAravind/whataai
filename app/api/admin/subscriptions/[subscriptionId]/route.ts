import { requireGodUser } from "@/lib/auth/guard";
import { handleError, ok, noContent } from "@/lib/http";
import { cancelSubscription, deleteSubscription, getSubscription, updateSubscription } from "@/lib/services/subscriptions";

type Ctx = { params: Promise<{ subscriptionId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    await requireGodUser();
    const { subscriptionId } = await params;
    return ok({ subscription: await getSubscription(subscriptionId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    await requireGodUser();
    const { subscriptionId } = await params;
    const body = (await request.json()) as {
      plan_id?: string;
      status?: string;
      starts_at?: string;
      ends_at?: string | null;
      metadata?: Record<string, unknown>;
    };
    return ok({ subscription: await updateSubscription(subscriptionId, body) });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  try {
    await requireGodUser();
    const { searchParams } = new URL(request.url);
    const { subscriptionId } = await params;
    if (searchParams.get("cancel") === "true") {
      return ok({ subscription: await cancelSubscription(subscriptionId) });
    }
    await deleteSubscription(subscriptionId);
    return noContent();
  } catch (e) {
    return handleError(e);
  }
}
