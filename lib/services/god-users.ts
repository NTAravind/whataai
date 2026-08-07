import { supabaseAdmin } from "@/lib/clients/supabase";
import { HttpError } from "@/lib/http";

export interface GodUserRow {
  id: string;
  email: string;
  created_at: string;
}

export async function listGodUsers(): Promise<GodUserRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("god_users")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as GodUserRow[];
}

export async function addGodUser(email: string): Promise<GodUserRow> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new HttpError(400, "Invalid email address");
  }
  const { data: existing } = await supabaseAdmin()
    .from("god_users")
    .select("id")
    .eq("email", normalized)
    .maybeSingle();
  if (existing) throw new HttpError(409, "User is already a god user");

  const { data, error } = await supabaseAdmin()
    .from("god_users")
    .insert({ email: normalized })
    .select()
    .single();
  if (error) throw error;
  return data as GodUserRow;
}

export async function removeGodUser(id: string): Promise<void> {
  const { error } = await supabaseAdmin().from("god_users").delete().eq("id", id);
  if (error) throw error;
}
