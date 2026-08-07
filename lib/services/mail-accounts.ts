import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";

export interface MailAccountRow {
  id: string;
  tenant_id: string;
  email_address: string;
  provider: string;
  credentials: Record<string, unknown>;
  status: string;
  created_at: string;
}

export async function listMailAccounts(tenantId: string): Promise<MailAccountRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("mail_accounts")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as MailAccountRow[];
}

export async function getMailAccount(tenantId: string, id: string): Promise<MailAccountRow> {
  return unwrap<MailAccountRow>(
    await supabaseAdmin().from("mail_accounts").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
  );
}

export async function createMailAccount(input: {
  tenant_id: string;
  email_address: string;
  provider: string;
  credentials?: Record<string, unknown>;
  status?: string;
}): Promise<MailAccountRow> {
  const { data, error } = await supabaseAdmin()
    .from("mail_accounts")
    .insert({
      tenant_id: input.tenant_id,
      email_address: input.email_address,
      provider: input.provider,
      credentials: input.credentials ?? {},
      status: input.status ?? "active",
    })
    .select()
    .single();
  if (error) throw error;
  return data as MailAccountRow;
}

export async function updateMailAccount(
  tenantId: string,
  id: string,
  input: {
    email_address?: string;
    provider?: string;
    credentials?: Record<string, unknown>;
    status?: string;
  },
): Promise<MailAccountRow> {
  const patch: Record<string, unknown> = {};
  if (input.email_address !== undefined) patch.email_address = input.email_address;
  if (input.provider !== undefined) patch.provider = input.provider;
  if (input.credentials !== undefined) patch.credentials = input.credentials;
  if (input.status !== undefined) patch.status = input.status;
  if (Object.keys(patch).length === 0) return getMailAccount(tenantId, id);

  const { data, error } = await supabaseAdmin()
    .from("mail_accounts")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select()
    .single();
  if (error) throw error;
  return data as MailAccountRow;
}

export async function deleteMailAccount(tenantId: string, id: string): Promise<void> {
  const { error } = await supabaseAdmin().from("mail_accounts").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}
