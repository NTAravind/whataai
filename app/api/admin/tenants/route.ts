import { requireGodUser } from "@/lib/auth/guard";
import { handleError, ok, created } from "@/lib/http";
import { createTenant, listTenants } from "@/lib/services/tenants";

export async function GET() {
  try {
    await requireGodUser();
    return ok({ tenants: await listTenants() });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request) {
  try {
    await requireGodUser();
    const body = (await request.json()) as { name?: string; status?: string };
    if (!body.name?.trim()) return handleError(new Error("name is required"));
    return created({ tenant: await createTenant({ name: body.name.trim(), status: body.status }) });
  } catch (e) {
    return handleError(e);
  }
}
