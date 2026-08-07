import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";

export interface Contact {
  id: string;
  tenant_id: string;
  full_name: string | null;
  phone_number: string | null;
  email: string | null;
  opt_out: boolean;
  metadata: Record<string, unknown>;
}

/**
 * Idempotent contact resolution for a WhatsApp phone number:
 * `INSERT ... ON CONFLICT` on the partial unique index
 * (tenant_id, phone_number) where phone_number is not null.
 */
export async function getOrCreateContact(tenantId: string, phoneNumber: string, fullName?: string | null): Promise<Contact> {
  const admin = supabaseAdmin();

  const { data, error } = await admin
    .from("contacts")
    .upsert(
      {
        tenant_id: tenantId,
        phone_number: phoneNumber,
        full_name: fullName ?? null,
        metadata: {},
      },
      { onConflict: "tenant_id,phone_number", ignoreDuplicates: false },
    )
    .select()
    .single();

  if (error) {
    // Upsert may race; fall back to a select.
    const existing = await admin
      .from("contacts")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("phone_number", phoneNumber)
      .maybeSingle();
    if (existing.data) return existing.data as Contact;
    throw error;
  }
  return data as Contact;
}

export async function listContacts(tenantId: string) {
  const data = unwrap(
    await supabaseAdmin()
      .from("contacts")
      .select("id, full_name, phone_number, email, opt_out, metadata, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200),
  );
  return data;
}

export async function setOptOut(tenantId: string, phoneNumber: string, optOut: boolean) {
  return supabaseAdmin()
    .from("contacts")
    .update({ opt_out: optOut })
    .eq("tenant_id", tenantId)
    .eq("phone_number", phoneNumber);
}
