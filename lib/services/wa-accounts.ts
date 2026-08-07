import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";

export interface WaAccountRow {
  id: string;
  tenant_id: string;
  wa_phone_number_id: string;
  display_phone_number: string;
  wa_business_account_id: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export async function listWaAccounts(tenantId: string): Promise<WaAccountRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("wa_accounts")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as WaAccountRow[];
}

export async function getWaAccount(tenantId: string, id: string): Promise<WaAccountRow> {
  return unwrap<WaAccountRow>(
    await supabaseAdmin().from("wa_accounts").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
  );
}

export async function createWaAccount(input: {
  tenant_id: string;
  wa_phone_number_id: string;
  display_phone_number: string;
  wa_business_account_id: string;
  status?: string;
  metadata?: Record<string, unknown>;
}): Promise<WaAccountRow> {
  const { data, error } = await supabaseAdmin()
    .from("wa_accounts")
    .insert({
      tenant_id: input.tenant_id,
      wa_phone_number_id: input.wa_phone_number_id,
      display_phone_number: input.display_phone_number,
      wa_business_account_id: input.wa_business_account_id,
      status: input.status ?? "active",
      metadata: input.metadata ?? {},
    })
    .select()
    .single();
  if (error) throw error;
  return data as WaAccountRow;
}

export async function updateWaAccount(
  tenantId: string,
  id: string,
  input: {
    wa_phone_number_id?: string;
    display_phone_number?: string;
    wa_business_account_id?: string;
    status?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<WaAccountRow> {
  const patch: Record<string, unknown> = {};
  if (input.wa_phone_number_id !== undefined) patch.wa_phone_number_id = input.wa_phone_number_id;
  if (input.display_phone_number !== undefined) patch.display_phone_number = input.display_phone_number;
  if (input.wa_business_account_id !== undefined) patch.wa_business_account_id = input.wa_business_account_id;
  if (input.status !== undefined) patch.status = input.status;
  if (input.metadata !== undefined) patch.metadata = input.metadata;
  if (Object.keys(patch).length === 0) return getWaAccount(tenantId, id);

  const { data, error } = await supabaseAdmin()
    .from("wa_accounts")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select()
    .single();
  if (error) throw error;
  return data as WaAccountRow;
}

export async function deleteWaAccount(tenantId: string, id: string): Promise<void> {
  const { error } = await supabaseAdmin().from("wa_accounts").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}
