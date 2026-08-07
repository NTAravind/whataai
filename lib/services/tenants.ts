import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import { HttpError } from "@/lib/http";

export interface TenantRow {
  id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TenantMemberRow {
  id: string;
  tenant_id: string;
  user_id: string;
  role: string;
  created_at: string;
}

export interface SubscriptionRow {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TenantDetail extends TenantRow {
  members: TenantMemberRow[];
  subscription: SubscriptionRow | null;
}

export async function listTenants(): Promise<TenantRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("tenants")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TenantRow[];
}

export async function getTenant(id: string): Promise<TenantDetail> {
  const admin = supabaseAdmin();
  const tenant = unwrap<TenantRow>(
    await admin.from("tenants").select("*").eq("id", id).maybeSingle(),
  );

  const [members, subscription] = await Promise.all([
    admin.from("tenant_members").select("*").eq("tenant_id", id).order("created_at"),
    admin
      .from("subscriptions")
      .select("*")
      .eq("tenant_id", id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .maybeSingle(),
  ]);

  return {
    ...tenant,
    members: (members.data ?? []) as TenantMemberRow[],
    subscription: (subscription.data as SubscriptionRow | null) ?? null,
  };
}

export async function createTenant(input: { name: string; status?: string }): Promise<TenantRow> {
  const { data, error } = await supabaseAdmin()
    .from("tenants")
    .insert({ name: input.name, status: input.status ?? "active" })
    .select()
    .single();
  if (error) throw error;
  return data as TenantRow;
}

export async function updateTenant(
  id: string,
  input: { name?: string; status?: string },
): Promise<TenantRow> {
  const patch: Record<string, string> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.status !== undefined) patch.status = input.status;
  if (Object.keys(patch).length === 0) return getTenant(id);

  const { data, error } = await supabaseAdmin()
    .from("tenants")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as TenantRow;
}

const TENANT_DELETE_ORDER = [
  // leaf rows referencing the tenant or one of its children, deepest first
  "usage_events",
  "usage_counters",
  "tenant_members",
  "subscriptions",
  "webhook_events",
  "knowledge_base_chunks",
  "knowledge_base_documents",
  "service_schemas", // -> services
  "availability_exceptions", // -> businesses
  "availability_rules", // -> businesses
  "resources", // -> businesses
  "flow_sessions", // -> flows / bookings / conversations / businesses
  "bookings", // -> businesses / contacts / conversations
  "flows", // -> services / wa_accounts
  "services", // -> businesses
  "scheduled_messages", // -> conversations / contacts / agents
  "messages", // -> conversations
  "conversations", // -> contacts / agents
  "contacts",
  "agent_tools", // -> agents
  "agent_channels", // -> agents
  "agents",
  "campaign_schedules", // -> wa_accounts / whatsapp_templates
  "whatsapp_templates", // -> wa_accounts
  "wa_accounts",
  "mail_accounts",
];

/** Hard-delete a tenant and everything owned by it (admin-only). */
export async function deleteTenant(id: string): Promise<void> {
  const admin = supabaseAdmin();
  const failures: string[] = [];
  for (const table of TENANT_DELETE_ORDER) {
    const { error } = await admin.from(table).delete().eq("tenant_id", id);
    if (error) failures.push(`${table}: ${error.message}`);
  }
  const { error } = await admin.from("tenants").delete().eq("id", id);
  if (error) failures.push(`tenants: ${error.message}`);
  if (failures.length > 0) {
    throw new HttpError(500, `Tenant delete incomplete: ${failures.join("; ")}`);
  }
}
