import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import { HttpError } from "@/lib/http";
import { encryptCredentials, decryptCredentials } from "@/lib/crypto/credentials";
export interface IntegrationRow {
  id: string;
  tenant_id: string;
  name: string;
  type: string;
  base_url: string | null;
  config: Record<string, unknown>;
  credentials_encrypted: Uint8Array;
  created_at: string;
  updated_at: string;
}

/** The public (masked) shape — credentials are never returned. */
export interface IntegrationView {
  id: string;
  tenant_id: string;
  name: string;
  type: string;
  base_url: string | null;
  config: Record<string, unknown>;
  hasCredentials: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationCredentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  apiKey?: string;
}

function toView(row: IntegrationRow): IntegrationView {
  const hasCredentials =
    row.credentials_encrypted.byteLength >= 28; // IV(12) + tag(16) + ciphertext
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    type: row.type,
    base_url: row.base_url,
    config: row.config,
    hasCredentials,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listIntegrations(tenantId: string): Promise<IntegrationView[]> {
  const data = unwrap(
    await supabaseAdmin()
      .from("integrations")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
  );
  return (data as IntegrationRow[]).map(toView);
}

export async function getIntegration(tenantId: string, id: string): Promise<IntegrationView> {
  const row = await getIntegrationRow(tenantId, id);
  return toView(row);
}

async function getIntegrationRow(tenantId: string, id: string): Promise<IntegrationRow> {
  const data = unwrap(
    await supabaseAdmin()
      .from("integrations")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  );
  return data as IntegrationRow;
}

export interface CreateIntegrationInput {
  name: string;
  type: string;
  baseUrl?: string | null;
  config?: Record<string, unknown>;
  /** Credential value for non-OAuth integrations (e.g. an API key). */
  credential?: string;
}

export async function createIntegration(tenantId: string, input: CreateIntegrationInput): Promise<IntegrationView> {
  if (!input.type) throw new HttpError(400, "type is required");
  const credentials_encrypted = input.credential
    ? encryptCredentials({ apiKey: input.credential })
    : new Uint8Array(0);
  const data = unwrap(
    await supabaseAdmin()
      .from("integrations")
      .insert({
        tenant_id: tenantId,
        name: input.name,
        type: input.type,
        base_url: input.baseUrl ?? null,
        config: input.config ?? {},
        credentials_encrypted,
      })
      .select()
      .single(),
  ) as IntegrationRow;
  return toView(data);
}

export interface UpdateIntegrationInput {
  name?: string;
  baseUrl?: string | null;
  config?: Record<string, unknown>;
  /** When provided, replaces the stored credential. */
  credential?: string;
}

export async function updateIntegration(
  tenantId: string,
  id: string,
  input: UpdateIntegrationInput,
): Promise<IntegrationView> {
  const row = await getIntegrationRow(tenantId, id);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.baseUrl !== undefined) patch.base_url = input.baseUrl;
  if (input.config !== undefined) patch.config = input.config;
  if (input.credential !== undefined && input.credential !== "") {
    const current =
      row.credentials_encrypted.byteLength >= 28
        ? decryptCredentials<IntegrationCredentials>(row.credentials_encrypted)
        : {};
    patch.credentials_encrypted = encryptCredentials({ ...current, apiKey: input.credential });
  }
  patch.updated_at = new Date().toISOString();

  const data = unwrap(
    await supabaseAdmin().from("integrations").update(patch).eq("id", id).eq("tenant_id", tenantId).select().single(),
  ) as IntegrationRow;
  return toView(data);
}

export async function deleteIntegration(tenantId: string, id: string): Promise<void> {
  const { error } = await supabaseAdmin().from("integrations").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw new HttpError(500, error.message);
}

// ---------------------------------------------------------------------------
// Internal — decrypted access for executors + token refresh. NEVER exposed via
// a route; callers must not log the result.
// ---------------------------------------------------------------------------

export async function getIntegrationWithCredentials(
  tenantId: string,
  id: string,
): Promise<IntegrationRow & { credentials: IntegrationCredentials }> {
  const row = await getIntegrationRow(tenantId, id);
  const credentials = decryptCredentials<IntegrationCredentials>(row.credentials_encrypted);
  return { ...row, credentials };
}

export async function updateIntegrationCredentials(
  integrationId: string,
  tenantId: string,
  creds: IntegrationCredentials,
): Promise<void> {
  await getIntegrationRow(tenantId, integrationId);
  const encrypted = encryptCredentials(creds);
  const { error } = await supabaseAdmin()
    .from("integrations")
    .update({ credentials_encrypted: encrypted, updated_at: new Date().toISOString() })
    .eq("id", integrationId)
    .eq("tenant_id", tenantId);
  if (error) throw new HttpError(500, error.message);
}