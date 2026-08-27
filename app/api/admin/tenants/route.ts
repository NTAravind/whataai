import { requireGodUser } from "@/lib/auth/guard";
import { handleError, ok, created } from "@/lib/http";
import { createTenant, listTenants } from "@/lib/services/tenants";
import { createSubscription } from "@/lib/services/subscriptions";
import { supabaseAdmin } from "@/lib/clients/supabase";

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
    const god = await requireGodUser();
    const body = (await request.json()) as {
      name?: string;
      owner_email?: string;
      plan_id?: string;
      status?: string;
    };

    if (!body.name?.trim()) return handleError(new Error("name is required"));
    if (!body.owner_email?.trim()) return handleError(new Error("owner_email is required"));
    if (!body.plan_id?.trim()) return handleError(new Error("plan_id is required (subscription is mandatory)"));

    // Create tenant + invite owner
    const { tenant, inviteLink } = await createTenant({
      name: body.name.trim(),
      ownerEmail: body.owner_email.trim(),
      status: body.status,
    });

    // Look up the god_users row id (different from the auth user id)
    const { data: godRow } = await supabaseAdmin()
      .from("god_users")
      .select("id")
      .eq("email", god.email ?? "")
      .maybeSingle();

    // Immediately create the subscription
    const subscription = await createSubscription({
      tenant_id: tenant.id,
      plan_id: body.plan_id.trim(),
      status: "active",
      created_by: godRow?.id ?? null,
    });

    return created({ tenant, subscription, inviteLink });
  } catch (e) {
    return handleError(e);
  }
}
