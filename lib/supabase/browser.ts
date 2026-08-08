"use client";

import { createBrowserClient } from "@supabase/ssr";

let instance: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowser() {
  if (instance) return instance;
  instance = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  return instance;
}
