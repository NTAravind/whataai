import { requireGodUser } from "@/lib/auth/guard";
import { handleError, ok, noContent } from "@/lib/http";
import { removeMember, updateMemberRole } from "@/lib/services/tenant-members";

type Ctx = { params: Promise<{ tenantId: string; memberId: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    await requireGodUser();
    const { memberId } = await params;
    const body = (await request.json()) as { role?: string };
    if (!body.role) return handleError(new Error("role is required"));
    return ok({ member: await updateMemberRole(memberId, body.role) });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    await requireGodUser();
    const { memberId } = await params;
    await removeMember(memberId);
    return noContent();
  } catch (e) {
    return handleError(e);
  }
}
