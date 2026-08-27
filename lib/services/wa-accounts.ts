import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import { getPhoneNumberInfo, MetaApiError } from "@/lib/meta/whatsapp";

export interface WaAccountRow {
  id: string;
  tenant_id: string;
  wa_phone_number_id: string;
  display_phone_number: string;
  wa_business_account_id: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  has_access_token: boolean;
  has_verify_token: boolean;
}

interface RawWaAccountRow extends Omit<WaAccountRow, "has_access_token" | "has_verify_token"> {
  access_token: string | null;
  verify_token: string | null;
}

function mapRow(raw: RawWaAccountRow): WaAccountRow {
  const { access_token, verify_token, ...rest } = raw;
  return { ...rest, has_access_token: Boolean(access_token), has_verify_token: Boolean(verify_token) };
}

/**
 * Ask Meta what this phone number's state is with the given token. Status is
 * always derived from the Meta response — never user-supplied.
 */
export async function checkConnectionStatus(
  phoneNumberId: string,
  accessToken: string | null | undefined,
): Promise<{ status: string; displayPhoneNumber?: string; verifiedName?: string }> {
  if (!accessToken) return { status: "unconfigured" };
  try {
    const info = await getPhoneNumberInfo(phoneNumberId, accessToken);
    return {
      status: "connected",
      displayPhoneNumber: info.display_phone_number,
      verifiedName: info.verified_name,
    };
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.code === 190) return { status: "invalid_token" };
      if (err.status === 404 || err.code === 803) return { status: "not_found" };
      return { status: "error" };
    }
    return { status: "error" };
  }
}

export async function listWaAccounts(tenantId: string): Promise<WaAccountRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("wa_accounts")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as RawWaAccountRow[]).map(mapRow);
}

export async function getWaAccount(tenantId: string, id: string): Promise<WaAccountRow> {
  const raw = unwrap<RawWaAccountRow>(
    await supabaseAdmin().from("wa_accounts").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
  );
  return mapRow(raw);
}

async function getRawWaAccount(tenantId: string, id: string): Promise<RawWaAccountRow> {
  return unwrap<RawWaAccountRow>(
    await supabaseAdmin().from("wa_accounts").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
  );
}

export async function createWaAccount(input: {
  tenant_id: string;
  wa_phone_number_id: string;
  wa_business_account_id: string;
  access_token: string;
  verify_token: string;
  metadata?: Record<string, unknown>;
}): Promise<WaAccountRow> {
  const check = await checkConnectionStatus(input.wa_phone_number_id, input.access_token);
  const { data, error } = await supabaseAdmin()
    .from("wa_accounts")
    .insert({
      tenant_id: input.tenant_id,
      wa_phone_number_id: input.wa_phone_number_id,
      display_phone_number: check.displayPhoneNumber ?? input.wa_phone_number_id,
      wa_business_account_id: input.wa_business_account_id,
      access_token: input.access_token,
      verify_token: input.verify_token,
      status: check.status,
      metadata: input.metadata ?? {},
    })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data as RawWaAccountRow);
}

export async function updateWaAccount(
  tenantId: string,
  id: string,
  input: {
    wa_phone_number_id?: string;
    wa_business_account_id?: string;
    access_token?: string;
    verify_token?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<WaAccountRow> {
  const current = await getRawWaAccount(tenantId, id);

  const patch: Record<string, unknown> = {};
  if (input.wa_phone_number_id !== undefined) patch.wa_phone_number_id = input.wa_phone_number_id;
  if (input.wa_business_account_id !== undefined) patch.wa_business_account_id = input.wa_business_account_id;
  if (input.metadata !== undefined) patch.metadata = input.metadata;

  // Empty string clears a secret, undefined keeps the current one.
  if (input.access_token !== undefined) {
    patch.access_token = input.access_token || null;
  }
  if (input.verify_token !== undefined) {
    patch.verify_token = input.verify_token || null;
  }

  const phoneNumberId = (input.wa_phone_number_id ?? current.wa_phone_number_id) || "";
  const accessToken = input.access_token !== undefined ? input.access_token || null : current.access_token;

  // Always re-run the Meta check: any PATCH may carry new credentials or a new
  // phone number, and an empty PATCH doubles as a "check connection" refresh.
  if (phoneNumberId) {
    const check = await checkConnectionStatus(phoneNumberId, accessToken);
    patch.status = check.status;
    if (check.displayPhoneNumber) patch.display_phone_number = check.displayPhoneNumber;
  }

  if (Object.keys(patch).length === 0) return getWaAccount(tenantId, id);

  const { data, error } = await supabaseAdmin()
    .from("wa_accounts")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select()
    .single();
  if (error) throw error;
  return mapRow(data as RawWaAccountRow);
}

export async function deleteWaAccount(tenantId: string, id: string): Promise<void> {
  const { error } = await supabaseAdmin().from("wa_accounts").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}

/** True if any wa_account's webhook verify token matches (per-tenant webhooks). */
export async function matchWaVerifyToken(token: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("wa_accounts")
    .select("id")
    .eq("verify_token", token)
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
