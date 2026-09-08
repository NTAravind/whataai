import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import { HttpError } from "@/lib/http";

export interface AppointmentServiceRow {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  booking_mode: string;
  default_duration_minutes: number | null;
  requires_resource_type: string | null;
  active_schema_id: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResourceRow {
  id: string;
  business_id: string;
  type: string;
  name: string;
  capacity: number | null;
  metadata: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AvailabilityRuleRow {
  id: string;
  business_id: string;
  resource_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  timezone: string;
  created_at: string;
  resource?: { id: string; name: string; type: string } | null;
}

async function assertBusinessForTenant(tenantId: string, businessId: string) {
  return unwrap<{ id: string; timezone: string }>(
    await supabaseAdmin()
      .from("businesses")
      .select("id, timezone")
      .eq("id", businessId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  );
}

export async function listAppointmentServices(tenantId: string) {
  return unwrap<AppointmentServiceRow[]>(
    await supabaseAdmin()
      .from("services")
      .select("*, business:businesses!inner(id, tenant_id)")
      .eq("business.tenant_id", tenantId)
      .order("created_at", { ascending: false }),
  );
}

export async function createAppointmentService(input: {
  tenantId: string;
  businessId: string;
  name: string;
  description?: string | null;
  bookingMode?: string;
  defaultDurationMinutes?: number | null;
  requiresResourceType?: string | null;
}) {
  await assertBusinessForTenant(input.tenantId, input.businessId);
  const admin = supabaseAdmin();

  const { data: service, error } = await admin
    .from("services")
    .insert({
      business_id: input.businessId,
      name: input.name,
      description: input.description ?? null,
      booking_mode: input.bookingMode ?? "duration",
      default_duration_minutes: input.defaultDurationMinutes ?? 30,
      requires_resource_type: input.requiresResourceType || null,
      enabled: true,
    })
    .select()
    .single();
  if (error) throw error;

  const { data: schema, error: schemaError } = await admin
    .from("service_schemas")
    .insert({
      service_id: service.id,
      version: 1,
      schema: { fields: [] },
      is_active: true,
    })
    .select("id")
    .single();
  if (schemaError) throw schemaError;

  const { data: updated, error: updateError } = await admin
    .from("services")
    .update({ active_schema_id: schema.id })
    .eq("id", service.id)
    .select()
    .single();
  if (updateError) throw updateError;
  return updated as AppointmentServiceRow;
}

export async function updateAppointmentService(
  tenantId: string,
  serviceId: string,
  input: {
    name?: string;
    description?: string | null;
    bookingMode?: string;
    defaultDurationMinutes?: number | null;
    requiresResourceType?: string | null;
    enabled?: boolean;
  },
) {
  const current = unwrap<{ business_id: string }>(
    await supabaseAdmin()
      .from("services")
      .select("business_id, business:businesses!inner(tenant_id)")
      .eq("id", serviceId)
      .eq("business.tenant_id", tenantId)
      .maybeSingle(),
  );

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.bookingMode !== undefined) patch.booking_mode = input.bookingMode;
  if (input.defaultDurationMinutes !== undefined) patch.default_duration_minutes = input.defaultDurationMinutes;
  if (input.requiresResourceType !== undefined) patch.requires_resource_type = input.requiresResourceType || null;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (Object.keys(patch).length === 0) return current;

  const { data, error } = await supabaseAdmin()
    .from("services")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", serviceId)
    .select()
    .single();
  if (error) throw error;
  return data as AppointmentServiceRow;
}

export async function listResources(tenantId: string) {
  return unwrap<ResourceRow[]>(
    await supabaseAdmin()
      .from("resources")
      .select("*, business:businesses!inner(id, tenant_id)")
      .eq("business.tenant_id", tenantId)
      .order("created_at", { ascending: false }),
  );
}

export async function createResource(input: {
  tenantId: string;
  businessId: string;
  name: string;
  type: string;
  capacity?: number | null;
}) {
  await assertBusinessForTenant(input.tenantId, input.businessId);
  const { data, error } = await supabaseAdmin()
    .from("resources")
    .insert({
      business_id: input.businessId,
      name: input.name,
      type: input.type,
      capacity: input.capacity ?? null,
      enabled: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ResourceRow;
}

export async function getResource(tenantId: string, resourceId: string) {
  return unwrap<ResourceRow>(
    await supabaseAdmin()
      .from("resources")
      .select("*, business:businesses!inner(id, tenant_id)")
      .eq("id", resourceId)
      .eq("business.tenant_id", tenantId)
      .maybeSingle(),
  );
}

export async function updateResource(
  tenantId: string,
  resourceId: string,
  input: {
    name?: string;
    type?: string;
    capacity?: number | null;
    metadata?: Record<string, unknown>;
    enabled?: boolean;
  },
) {
  const current = await getResource(tenantId, resourceId);

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.type !== undefined) patch.type = input.type;
  if (input.capacity !== undefined) patch.capacity = input.capacity;
  if (input.metadata !== undefined) patch.metadata = input.metadata;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (Object.keys(patch).length === 0) return current;

  const { data, error } = await supabaseAdmin()
    .from("resources")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", resourceId)
    .select()
    .single();
  if (error) throw error;
  return data as ResourceRow;
}

export async function deleteResource(tenantId: string, resourceId: string) {
  const admin = supabaseAdmin();
  await getResource(tenantId, resourceId); // 404 if not in this tenant

  // deepest children first (FK ordering: resource_id on all three)
  await admin.from("availability_exceptions").delete().eq("resource_id", resourceId);
  await admin.from("availability_rules").delete().eq("resource_id", resourceId);
  await admin.from("bookings").delete().eq("resource_id", resourceId);
  const { error } = await admin.from("resources").delete().eq("id", resourceId);
  if (error) throw error;
}

export async function listAvailabilityRules(tenantId: string) {
  return unwrap<AvailabilityRuleRow[]>(
    await supabaseAdmin()
      .from("availability_rules")
      .select("*, business:businesses!inner(id, tenant_id), resource:resources(id, name, type)")
      .eq("business.tenant_id", tenantId)
      .order("day_of_week", { ascending: true })
      .order("start_time", { ascending: true }),
  );
}

export async function createAvailabilityRule(input: {
  tenantId: string;
  businessId: string;
  resourceId?: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone?: string;
}) {
  const business = await assertBusinessForTenant(input.tenantId, input.businessId);
  if (input.dayOfWeek < 0 || input.dayOfWeek > 6) throw new HttpError(400, "dayOfWeek must be between 0 and 6");

  const { data, error } = await supabaseAdmin()
    .from("availability_rules")
    .insert({
      business_id: input.businessId,
      resource_id: input.resourceId || null,
      day_of_week: input.dayOfWeek,
      start_time: input.startTime,
      end_time: input.endTime,
      timezone: input.timezone ?? business.timezone ?? "UTC",
    })
    .select()
    .single();
  if (error) throw error;
  return data as AvailabilityRuleRow;
}

export async function deleteAvailabilityRule(tenantId: string, ruleId: string) {
  const { error } = await supabaseAdmin()
    .from("availability_rules")
    .delete()
    .eq("id", ruleId)
    .in(
      "business_id",
      unwrap<{ id: string }[]>(
        await supabaseAdmin().from("businesses").select("id").eq("tenant_id", tenantId),
      ).map((business) => business.id),
    );
  if (error) throw error;
}

export async function getServiceSchema(tenantId: string, serviceId: string) {
  const admin = supabaseAdmin();
  const service = unwrap<{ id: string; active_schema_id: string | null }>(
    await admin
      .from("services")
      .select("id, active_schema_id, business:businesses!inner(tenant_id)")
      .eq("id", serviceId)
      .eq("business.tenant_id", tenantId)
      .maybeSingle(),
  );

  if (!service.active_schema_id) {
    return { id: null, service_id: serviceId, version: 1, schema: { fields: [] } };
  }

  const schemaRow = unwrap(
    await admin
      .from("service_schemas")
      .select("*")
      .eq("id", service.active_schema_id)
      .maybeSingle(),
  );

  return schemaRow;
}

export async function updateServiceSchema(tenantId: string, serviceId: string, fields: unknown[]) {
  const admin = supabaseAdmin();
  const service = unwrap<{ id: string; active_schema_id: string | null }>(
    await admin
      .from("services")
      .select("id, active_schema_id, business:businesses!inner(tenant_id)")
      .eq("id", serviceId)
      .eq("business.tenant_id", tenantId)
      .maybeSingle(),
  );

  let currentVersion = 0;
  if (service.active_schema_id) {
    const active = await admin
      .from("service_schemas")
      .select("version")
      .eq("id", service.active_schema_id)
      .single();
    if (active.data) currentVersion = active.data.version;
  }

  const newVersion = currentVersion + 1;

  // Insert a new schema version snapshot
  const { data: newSchema, error: insertErr } = await admin
    .from("service_schemas")
    .insert({
      service_id: serviceId,
      version: newVersion,
      schema: { fields },
      is_active: true,
    })
    .select()
    .single();

  if (insertErr) throw insertErr;

  // Update active_schema_id on service
  const { error: updateErr } = await admin
    .from("services")
    .update({ active_schema_id: newSchema.id, updated_at: new Date().toISOString() })
    .eq("id", serviceId);

  if (updateErr) throw updateErr;

  return newSchema;
}

export async function deleteAppointmentService(tenantId: string, serviceId: string) {
  const admin = supabaseAdmin();
  const current = unwrap<{ id: string }>(
    await admin
      .from("services")
      .select("id, business:businesses!inner(tenant_id)")
      .eq("id", serviceId)
      .eq("business.tenant_id", tenantId)
      .maybeSingle(),
  );

  // Clear circular reference first
  await admin.from("services").update({ active_schema_id: null }).eq("id", current.id);
  await admin.from("service_schemas").delete().eq("service_id", current.id);
  await admin.from("bookings").delete().eq("service_id", current.id);
  const { error } = await admin.from("services").delete().eq("id", current.id);
  if (error) throw error;
}

