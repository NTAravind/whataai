import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok, noContent } from "@/lib/http";
import { deleteWaAccount, getWaAccount, updateWaAccount } from "@/lib/services/wa-accounts";

type Ctx = { params: Promise<{ tenantId: string; waAccountId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, waAccountId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ waAccount: await getWaAccount(tenantId, waAccountId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { tenantId, waAccountId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as {
      wa_phone_number_id?: string;
      display_phone_number?: string;
      wa_business_account_id?: string;
      status?: string;
      metadata?: Record<string, unknown>;
    };
    return ok({ waAccount: await updateWaAccount(tenantId, waAccountId, body) });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, waAccountId } = await params;
    await requireTenantAccess(tenantId);
    await deleteWaAccount(tenantId, waAccountId);
    return noContent();
  } catch (e) {
    return handleError(e);
  }
}
