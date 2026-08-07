import { requireGodUser } from "@/lib/auth/guard";
import { handleError, noContent } from "@/lib/http";
import { removeGodUser } from "@/lib/services/god-users";

type Ctx = { params: Promise<{ userId: string }> };

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    await requireGodUser();
    const { userId } = await params;
    await removeGodUser(userId);
    return noContent();
  } catch (e) {
    return handleError(e);
  }
}
