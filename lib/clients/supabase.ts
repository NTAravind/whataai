import { createClient, SupabaseClient } from "@supabase/supabase-js";
 

// Service-role client: used only in trusted server contexts (route handlers,
// server actions, Inngest functions). RLS is bypassed here by design — every
// query below MUST filter by tenant_id explicitly since `is_god_user()` /
// `auth_tenant_ids()` have no JWT to key off in this context.
let _admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

/** Throws if a Supabase response carries an error — keeps call sites terse. */
export function unwrap<T>(res: { data: T | null; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(`Supabase error: ${res.error.message}`);
  if (res.data === null) throw new Error("Supabase error: no data returned");
  return res.data as NonNullable<T>;
}