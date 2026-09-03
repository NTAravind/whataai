import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import { HttpError } from "@/lib/http";

export interface TenantRow {
  id: string;
  name: string;
  status: string;
  owner_email: string | null;
  created_at: string;
  updated_at: string;
  max_businesses: number | null;
  token_budget_topup: number;
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

export interface TenantUsage {
  tokens_used: number;
  cost_usd: number;
}

export interface TenantDetail extends TenantRow {
  members: TenantMemberRow[];
  subscription: SubscriptionRow | null;
  usage: TenantUsage | null;
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

  const today = new Date().toISOString().slice(0, 10);
  const [members, subscription, usageData] = await Promise.all([
    admin.from("tenant_members").select("*").eq("tenant_id", id).order("created_at"),
    admin
      .from("subscriptions")
      .select("*")
      .eq("tenant_id", id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .maybeSingle(),
    admin
      .from("usage_counters")
      .select("tokens_used, cost_usd")
      .eq("tenant_id", id)
      .lte("period_start", today)
      .gte("period_end", today)
      .maybeSingle(),
  ]);

  return {
    ...tenant,
    members: (members.data ?? []) as TenantMemberRow[],
    subscription: (subscription.data as SubscriptionRow | null) ?? null,
    usage: (usageData.data as TenantUsage | null) ?? null,
  };
}

export async function createTenant(input: {
  name: string;
  status?: string;
  ownerEmail: string;
}): Promise<{ tenant: TenantRow; inviteLink?: string }> {
  const email = input.ownerEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Invalid owner email address");
  }

  // Guard: god-users cannot be tenant owners
  const { data: godUser } = await supabaseAdmin()
    .from("god_users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (godUser) {
    throw new HttpError(400, "A god-user cannot be a tenant owner");
  }

  // Create the tenant row
  const { data, error } = await supabaseAdmin()
    .from("tenants")
    .insert({ name: input.name, status: input.status ?? "active", owner_email: email })
    .select()
    .single();
  if (error) throw error;
  const tenant = data as TenantRow;

  // Invite / upsert the Supabase Auth user and add them as owner
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  let userId: string;
  let inviteLink: string | undefined;

  const { data: inviteData, error: inviteError } = await supabaseAdmin()
    .auth.admin.inviteUserByEmail(email, {
      data: { tenant_id: tenant.id },
      redirectTo: `${baseUrl}/auth/callback?next=/update-password`,
    });

  if (inviteError) {
    if (inviteError.status === 429) {
      // Rate limit exceeded: fallback to generating the link without sending an email
      const { data: linkData, error: linkError } = await supabaseAdmin()
        .auth.admin.generateLink({
          type: "invite",
          email,
          options: {
            data: { tenant_id: tenant.id },
            redirectTo: `${baseUrl}/auth/callback?next=/update-password`,
          },
        });
      if (linkError) {
        await supabaseAdmin().from("tenants").delete().eq("id", tenant.id);
        throw new HttpError(500, `Failed to generate invite link: ${linkError.message}`);
      }
      userId = linkData.user.id;
      inviteLink = linkData.properties.action_link;
    } else {
      // Roll back the tenant row so we don't leave orphans
      await supabaseAdmin().from("tenants").delete().eq("id", tenant.id);
      throw new HttpError(500, `Failed to invite owner: ${inviteError.message}`);
    }
  } else {
    userId = inviteData.user.id;
  }

  const { error: memberError } = await supabaseAdmin()
    .from("tenant_members")
    .insert({ tenant_id: tenant.id, user_id: userId, role: "owner" });
  if (memberError) {
    // Non-fatal: tenant exists but member insert failed — log and continue
    console.error("tenant_members insert failed:", memberError.message);
  }

  return { tenant, inviteLink };
}


export async function updateTenant(
  id: string,
  input: { name?: string; status?: string; max_businesses?: number | null; token_budget_topup?: number },
): Promise<TenantRow> {
  const patch: Record<string, string | number | null> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.status !== undefined) patch.status = input.status;
  if (input.max_businesses !== undefined) patch.max_businesses = input.max_businesses;
  if (input.token_budget_topup !== undefined) patch.token_budget_topup = input.token_budget_topup;
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


interface DeleteStep {
  table: string;
  /** Delete rows whose `parentColumn` matches tenant-owned ids in `parentTable`. */
  parentColumn?: string;
  parentTable?: string;
  /** For parents that lack `tenant_id`: resolve them via `grandparentColumn` in `grandparentTable` (which has tenant_id). */
  grandparentColumn?: string;
  grandparentTable?: string;
}

const TENANT_DELETE_ORDER: DeleteStep[] = [
  // Leaf rows referencing the tenant or one of its children, deepest first.
  { table: "usage_events" },
  { table: "usage_counters" },
  { table: "tenant_members" },
  { table: "subscriptions" },
  { table: "webhook_events" },
  { table: "knowledge_base_chunks" },
  { table: "knowledge_base_documents" },
  // flow_sessions -> flows / bookings / conversations / businesses
  { table: "flow_sessions" },
  // bookings -> businesses / resources / services / service_schemas / contacts / conversations;
  // must go before service_schemas / resources / services
  { table: "bookings" },
  // service_schemas -> services -> businesses (services has no tenant_id);
  // also referenced by bookings.service_schema_id and services.active_schema_id
  {
    table: "service_schemas",
    parentColumn: "service_id",
    parentTable: "services",
    grandparentColumn: "business_id",
    grandparentTable: "businesses",
  },
  // availability_* -> businesses / resources
  { table: "availability_exceptions", parentColumn: "business_id", parentTable: "businesses" },
  { table: "availability_rules", parentColumn: "business_id", parentTable: "businesses" },
  // resources -> businesses
  { table: "resources", parentColumn: "business_id", parentTable: "businesses" },
  // flows -> services / wa_accounts
  { table: "flows" },
  // services -> businesses
  { table: "services", parentColumn: "business_id", parentTable: "businesses" },
  // scheduled_messages -> conversations / contacts / agents
  { table: "scheduled_messages" },
  // messages -> conversations
  { table: "messages", parentColumn: "conversation_id", parentTable: "conversations" },
  // conversations -> contacts / agents
  { table: "conversations" },
  { table: "contacts" },
  // agent_tools / agent_channels -> agents
  { table: "agent_tools", parentColumn: "agent_id", parentTable: "agents" },
  { table: "agent_channels", parentColumn: "agent_id", parentTable: "agents" },
  { table: "agents" },
  // campaign_schedules -> wa_accounts / whatsapp_templates
  { table: "campaign_schedules" },
  { table: "whatsapp_templates" },
  { table: "wa_accounts" },
  { table: "mail_accounts" },
  // businesses -> parent of resources / services / availability_* (delete last)
  { table: "businesses" },
];

/** Hard-delete a tenant and everything owned by it (admin-only). */
export async function deleteTenant(id: string): Promise<void> {
  const admin = supabaseAdmin();
  const failures: string[] = [];
  for (const step of TENANT_DELETE_ORDER) {
    let error: { message: string } | null = null;
    let ids: string[] = [];
    if (step.grandparentTable && step.grandparentColumn) {
      const { data: grandRows } = await admin
        .from(step.grandparentTable)
        .select("id")
        .eq("tenant_id", id);
      const grandIds = (grandRows ?? []).map((r: { id: string }) => r.id);
      if (grandIds.length > 0) {
        const { data: parentRows } = await admin
          .from(step.parentTable!)
          .select("id")
          .in(step.grandparentColumn, grandIds);
        ids = (parentRows ?? []).map((r: { id: string }) => r.id);
      }
    } else if (step.parentTable && step.parentColumn) {
      const { data: parentRows } = await admin
        .from(step.parentTable)
        .select("id")
        .eq("tenant_id", id);
      ids = (parentRows ?? []).map((r: { id: string }) => r.id);
    }

    if (ids.length > 0) {
      ({ error } = await admin.from(step.table).delete().in(step.parentColumn!, ids));
    } else if (!step.parentTable) {
      ({ error } = await admin.from(step.table).delete().eq("tenant_id", id));
    }
    if (error) failures.push(`${step.table}: ${error.message}`);
  }
  const { error } = await admin.from("tenants").delete().eq("id", id);
  if (error) failures.push(`tenants: ${error.message}`);
  if (failures.length > 0) {
    throw new HttpError(500, `Tenant delete incomplete: ${failures.join("; ")}`);
  }
}
