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

export async function getBusinessContextPrompt(tenantId: string): Promise<{ prompt: string; timezone: string }> {
  const admin = supabaseAdmin();
  const { data: business } = await admin
    .from("businesses")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!business) return { prompt: "", timezone: "UTC" };

  const biz = business as BusinessRow;
  const location = biz.metadata?.location ? String(biz.metadata.location) : null;
  const description = biz.metadata?.description ? String(biz.metadata.description) : null;

  const [servicesRes, resourcesRes] = await Promise.all([
    admin.from("services").select("name, description, default_duration_minutes").eq("business_id", biz.id).eq("enabled", true),
    admin.from("resources").select("name, type").eq("business_id", biz.id).eq("enabled", true),
  ]);

  const services = (servicesRes.data ?? []) as { name: string; description: string | null; default_duration_minutes: number | null }[];
  const resources = (resourcesRes.data ?? []) as { name: string; type: string }[];

  let context = `\n\n## BUSINESS CONTEXT (${biz.name}):\n`;
  context += `- Business Name: ${biz.name}\n`;
  if (biz.industry) context += `- Industry / Business Type: ${biz.industry}\n`;
  if (location) context += `- Location: ${location}\n`;
  if (biz.timezone) context += `- Timezone: ${biz.timezone}\n`;
  if (description) context += `- Description: ${description}\n`;

  if (services.length > 0) {
    context += `\n### Offered Services:\n`;
    services.forEach((s) => {
      context += `- ${s.name}${s.default_duration_minutes ? ` (${s.default_duration_minutes}m)` : ""}${s.description ? `: ${s.description}` : ""}\n`;
    });
  }

  if (resources.length > 0) {
    context += `\n### Staff / Bookable Resources:\n`;
    resources.forEach((r) => {
      context += `- ${r.name} (${r.type})\n`;
    });
  }

  context += `\n### MANDATORY RESPONSE & GROUNDING RULES:
1. You represent ONLY ${biz.name}. Never answer generic questions off the top of your head or pretend to be an unbranded AI assistant.
2. For any factual questions about business hours, pricing, policies, location, procedures, or services, ALWAYS call \`search_knowledge_base\` first.
3. Do NOT invent business facts, policies, or prices. If information is not found in the knowledge base or tools, state clearly that you don't have that specific detail for ${biz.name} and offer to escalate to a human (\`escalate_to_human\`).
4. For bookings: Ask for date, time, and specific staff/resource. Always check availability using \`check_availability\` before offering times or confirming.
`;

  return { prompt: context, timezone: biz.timezone ?? "UTC" };
}

