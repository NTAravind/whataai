import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok, created } from "@/lib/http";
import { addMember, listMembers } from "@/lib/services/tenant-members";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ members: await listMembers(tenantId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as { user_id?: string; role?: string };
    if (!body.user_id) return handleError(new Error("user_id is required"));
    return created({ member: await addMember(tenantId, body.user_id, body.role) });
  } catch (e) {
    return handleError(e);
  }
}
