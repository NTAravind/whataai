import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok, created } from "@/lib/http";
import { createMailAccount, listMailAccounts } from "@/lib/services/mail-accounts";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ mailAccounts: await listMailAccounts(tenantId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as {
      email_address?: string;
      provider?: string;
      credentials?: Record<string, unknown>;
      status?: string;
    };
    if (!body.email_address?.trim()) return handleError(new Error("email_address is required"));
    if (!body.provider?.trim()) return handleError(new Error("provider is required"));
    return created({
      mailAccount: await createMailAccount({
        tenant_id: tenantId,
        email_address: body.email_address.trim(),
        provider: body.provider.trim(),
        credentials: body.credentials,
        status: body.status,
      }),
    });
  } catch (e) {
    return handleError(e);
  }
}
