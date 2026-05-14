import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabasePublishableKey,
  getSupabaseUrl,
  isSupabaseJsConfigured,
} from "./env";

let cached: SupabaseClient | undefined;

/** Client Supabase navigateur (REST, Auth, Realtime…). Pas utilisé par Prisma. */
export function createSupabaseBrowserClient(): SupabaseClient {
  const url = getSupabaseUrl();
  const key = getSupabasePublishableKey();
  if (!url || !key) {
    throw new Error(
      "Définis NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  return createClient(url, key);
}

export function getSupabaseBrowserClient(): SupabaseClient | undefined {
  if (!isSupabaseJsConfigured()) return undefined;
  if (!cached) {
    cached = createSupabaseBrowserClient();
  }
  return cached;
}
