import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";

export interface BusinessRow {
  id: string;
  tenant_id: string;
  name: string;
  industry: string | null;
  timezone: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function listBusinesses(tenantId: string): Promise<BusinessRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("businesses")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as BusinessRow[];
}

export async function getBusiness(tenantId: string, id: string): Promise<BusinessRow> {
  return unwrap<BusinessRow>(
    await supabaseAdmin().from("businesses").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
  );
}

export async function createBusiness(input: {
  tenant_id: string;
  name: string;
  industry?: string | null;
  timezone?: string;
  metadata?: Record<string, unknown>;
}): Promise<BusinessRow> {
  const { data, error } = await supabaseAdmin()
    .from("businesses")
    .insert({
      tenant_id: input.tenant_id,
      name: input.name,
      industry: input.industry ?? null,
      timezone: input.timezone ?? "UTC",
      metadata: input.metadata ?? {},
    })
    .select()
    .single();
  if (error) throw error;
  return data as BusinessRow;
}

export async function updateBusiness(
  tenantId: string,
  id: string,
  input: {
    name?: string;
    industry?: string | null;
    timezone?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<BusinessRow> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.industry !== undefined) patch.industry = input.industry;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.metadata !== undefined) patch.metadata = input.metadata;
  if (Object.keys(patch).length === 0) return getBusiness(tenantId, id);

  const { data, error } = await supabaseAdmin()
    .from("businesses")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select()
    .single();
  if (error) throw error;
  return data as BusinessRow;
}

export async function deleteBusiness(tenantId: string, id: string): Promise<void> {
  const admin = supabaseAdmin();
  // deepest children first (FK ordering)
  const { data: services } = await admin.from("services").select("id").eq("business_id", id);
  const serviceIds = (services ?? []).map((s) => s.id);
  if (serviceIds.length > 0) {
    await admin.from("service_schemas").delete().in("service_id", serviceIds);
    await admin.from("services").delete().in("id", serviceIds);
  }
  await admin.from("availability_exceptions").delete().eq("business_id", id);
  await admin.from("availability_rules").delete().eq("business_id", id);
  await admin.from("resources").delete().eq("business_id", id);
  await admin.from("bookings").delete().eq("business_id", id);
  const { error } = await admin.from("businesses").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}
