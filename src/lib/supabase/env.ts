/** URL du projet (https://xxx.supabase.co), Dashboard → Settings → API. */
export function getSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
}

/** Clé publishable (ex-anon). Alias legacy : NEXT_PUBLIC_SUPABASE_ANON_KEY. */
export function getSupabasePublishableKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    ""
  );
}

export function isSupabaseJsConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabasePublishableKey());
}
