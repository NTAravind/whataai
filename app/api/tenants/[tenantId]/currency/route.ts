import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok, HttpError } from "@/lib/http";
import { supabaseAdmin } from "@/lib/clients/supabase";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);

    const body = await request.json();
    const { currency } = body as { currency?: string };

    if (currency !== "USD" && currency !== "INR") {
      return handleError(new HttpError(400, "Invalid currency. Must be USD or INR"));
    }

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("tenants")
      .update({ currency, updated_at: new Date().toISOString() })
      .eq("id", tenantId)
      .select("id, currency")
      .single();

    if (error) return handleError(error);

    return ok({ tenant: data });
  } catch (e) {
    return handleError(e);
  }
}