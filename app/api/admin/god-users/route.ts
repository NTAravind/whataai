import { requireGodUser } from "@/lib/auth/guard";
import { handleError, ok, created } from "@/lib/http";
import { addGodUser, listGodUsers } from "@/lib/services/god-users";

export async function GET() {
  try {
    await requireGodUser();
    return ok({ godUsers: await listGodUsers() });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request) {
  try {
    await requireGodUser();
    const body = (await request.json()) as { email?: string };
    if (!body.email) return handleError(new Error("email is required"));
    return created({ godUser: await addGodUser(body.email) });
  } catch (e) {
    return handleError(e);
  }
}
