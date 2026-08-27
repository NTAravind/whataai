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
      wa_business_account_id?: string;
      access_token?: string;
      verify_token?: string;
      metadata?: Record<string, unknown>;
    };
    if (!body.wa_phone_number_id?.trim()) return handleError(new Error("wa_phone_number_id is required"));
    if (!body.wa_business_account_id?.trim()) return handleError(new Error("wa_business_account_id is required"));
    if (!body.access_token?.trim()) return handleError(new Error("Permanent access token is required"));
    if (!body.verify_token?.trim()) return handleError(new Error("Webhook verify token is required"));
    return created({
      waAccount: await createWaAccount({
        tenant_id: tenantId,
        wa_phone_number_id: body.wa_phone_number_id.trim(),
        wa_business_account_id: body.wa_business_account_id.trim(),
        access_token: body.access_token.trim(),
        verify_token: body.verify_token.trim(),
        metadata: body.metadata,
      }),
    });
  } catch (e) {
    return handleError(e);
  }
}
