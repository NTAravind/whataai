import { requireUser } from "@/lib/auth/guard";
import { handleError, ok } from "@/lib/http";
import { supabaseAdmin } from "@/lib/clients/supabase";

export interface MeResponse {
  user: { id: string; email: string | null } | null;
  isGod: boolean;
  tenants: { id: string; name: string; status: string; currency: string }[];
  roles: Record<string, string>;
}

export async function GET() {
  try {
    const user = await requireUser();
    const admin = supabaseAdmin();

    const { data: god } = await admin
      .from("god_users")
      .select("id")
      .eq("email", user.email ?? "")
      .maybeSingle();

    const { data: members } = await admin
      .from("tenant_members")
      .select("tenant_id, role")
      .eq("user_id", user.id);

    const memberTenantIds = (members ?? []).map((m: { tenant_id: string }) => m.tenant_id);
    let tenants: { id: string; name: string; status: string; currency: string }[] = [];
    if (memberTenantIds.length > 0) {
      const { data } = await admin
        .from("tenants")
        .select("id, name, status, currency")
        .in("id", memberTenantIds)
        .order("name");
      tenants = (data ?? []) as { id: string; name: string; status: string; currency: string }[];
    }

    return ok<MeResponse>({
      user: { id: user.id, email: user.email },
      isGod: !!god,
      tenants,
      roles: Object.fromEntries(
        (members ?? []).map((m: { tenant_id: string; role: string }) => [m.tenant_id, m.role]),
      ),
    });
  } catch (e) {
    return handleError(e);
  }
}
