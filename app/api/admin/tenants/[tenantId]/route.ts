import { requireGodUser } from "@/lib/auth/guard";
import { handleError, ok, noContent } from "@/lib/http";
import { deleteTenant, getTenant, updateTenant } from "@/lib/services/tenants";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    await requireGodUser();
    const { tenantId } = await params;
    return ok({ tenant: await getTenant(tenantId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    await requireGodUser();
    const { tenantId } = await params;
    const body = (await request.json()) as { name?: string; status?: string };
    return ok({ tenant: await updateTenant(tenantId, body) });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    await requireGodUser();
    const { tenantId } = await params;
    await deleteTenant(tenantId);
    return noContent();
  } catch (e) {
    return handleError(e);
  }
}
