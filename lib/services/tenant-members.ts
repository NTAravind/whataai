import { supabaseAdmin } from "@/lib/clients/supabase";
import { HttpError } from "@/lib/http";
import type { TenantMemberRow } from "@/lib/services/tenants";

export const MEMBER_ROLES = ["owner", "admin", "member"] as const;

export async function listMembers(tenantId: string): Promise<TenantMemberRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("tenant_members")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as TenantMemberRow[];
}

/**
 * Add a user (by their Supabase Auth user id) to a tenant.
 * Throws 409 if the user is already a member of the tenant.
 */
export async function addMember(tenantId: string, userId: string, role = "member"): Promise<TenantMemberRow> {
  if (!MEMBER_ROLES.includes(role as (typeof MEMBER_ROLES)[number])) {
    throw new HttpError(400, `Invalid role; expected one of ${MEMBER_ROLES.join(", ")}`);
  }
  const { data: existing } = await supabaseAdmin()
    .from("tenant_members")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) throw new HttpError(409, "User is already a member of this tenant");

  const { data, error } = await supabaseAdmin()
    .from("tenant_members")
    .insert({ tenant_id: tenantId, user_id: userId, role })
    .select()
    .single();
  if (error) throw error;
  return data as TenantMemberRow;
}

export async function updateMemberRole(
  memberId: string,
  role: string,
): Promise<TenantMemberRow> {
  if (!MEMBER_ROLES.includes(role as (typeof MEMBER_ROLES)[number])) {
    throw new HttpError(400, `Invalid role; expected one of ${MEMBER_ROLES.join(", ")}`);
  }
  const { data, error } = await supabaseAdmin()
    .from("tenant_members")
    .update({ role })
    .eq("id", memberId)
    .select()
    .single();
  if (error) throw error;
  return data as TenantMemberRow;
}

export async function removeMember(memberId: string): Promise<void> {
  const { error } = await supabaseAdmin().from("tenant_members").delete().eq("id", memberId);
  if (error) throw error;
}
