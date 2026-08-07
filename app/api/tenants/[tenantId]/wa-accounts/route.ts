import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok, created } from "@/lib/http";
import { createWaAccount, listWaAccounts } from "@/lib/services/wa-accounts";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ waAccounts: await listWaAccounts(tenantId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as {
      wa_phone_number_id?: string;
      display_phone_number?: string;
      wa_business_account_id?: string;
      status?: string;
      metadata?: Record<string, unknown>;
    };
    if (!body.wa_phone_number_id?.trim()) return handleError(new Error("wa_phone_number_id is required"));
    if (!body.display_phone_number?.trim()) return handleError(new Error("display_phone_number is required"));
    if (!body.wa_business_account_id?.trim()) return handleError(new Error("wa_business_account_id is required"));
    return created({
      waAccount: await createWaAccount({
        tenant_id: tenantId,
        wa_phone_number_id: body.wa_phone_number_id.trim(),
        display_phone_number: body.display_phone_number.trim(),
        wa_business_account_id: body.wa_business_account_id.trim(),
        status: body.status,
        metadata: body.metadata,
      }),
    });
  } catch (e) {
    return handleError(e);
  }
}
