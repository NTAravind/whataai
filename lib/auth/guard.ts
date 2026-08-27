import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/clients/supabase";
import { HttpError } from "@/lib/http";

export interface SessionUser {
  id: string;
  email: string | null;
}

async function sessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Route handlers can't write cookies; we only ever need to read the session JWT.
        },
      },
    },
  );
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/** Any authenticated Supabase Auth user (used to test tenant membership). */
export async function requireUser(): Promise<SessionUser> {
  const user = await sessionUser();
  if (!user) throw new HttpError(401, "Authentication required");
  return user;
}

/**
 * God-mode admin: a Supabase Auth user whose email is in `god_users`
 * (docs/guide.md §4 — a separate table, not a JWT claim).
 */
export async function requireGodUser(): Promise<SessionUser> {
  const user = await requireUser();
  const { data } = await supabaseAdmin()
    .from("god_users")
    .select("id")
    .eq("email", user.email ?? "")
    .maybeSingle();
  if (!data) throw new HttpError(403, "God-mode access required");
  return user;
}

/** Tenant-scoped access: the user must be a row in `tenant_members`. */
export async function requireTenantAccess(tenantId: string): Promise<SessionUser> {
  const user = await requireUser();
  const { data } = await supabaseAdmin()
    .from("tenant_members")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) throw new HttpError(403, "You are not a member of this tenant");
  return user;
}
