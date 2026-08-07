import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok, noContent } from "@/lib/http";
import { deleteMailAccount, getMailAccount, updateMailAccount } from "@/lib/services/mail-accounts";

type Ctx = { params: Promise<{ tenantId: string; mailAccountId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, mailAccountId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ mailAccount: await getMailAccount(tenantId, mailAccountId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { tenantId, mailAccountId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as {
      email_address?: string;
      provider?: string;
      credentials?: Record<string, unknown>;
      status?: string;
    };
    return ok({ mailAccount: await updateMailAccount(tenantId, mailAccountId, body) });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, mailAccountId } = await params;
    await requireTenantAccess(tenantId);
    await deleteMailAccount(tenantId, mailAccountId);
    return noContent();
  } catch (e) {
    return handleError(e);
  }
}
