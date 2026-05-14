/** Fusionne les paramètres d’URL Postgres sans casser l’URI existante. */
export function normalizeRuntimePostgresUrl(connectionString: string): string {
  let u: URL;
  try {
    u = new URL(connectionString);
  } catch {
    return connectionString;
  }

  const host = u.hostname;
  const isSupabase =
    host.endsWith(".supabase.co") || host.includes("pooler.supabase.com");
  if (!isSupabase) {
    return connectionString;
  }

  const params = new URLSearchParams(u.search);
  if (!params.has("sslmode") && !params.has("ssl")) {
    params.set("sslmode", "require");
  }
  const port = u.port;
  if (port === "6543" && !params.has("pgbouncer")) {
    params.set("pgbouncer", "true");
  }

  const qs = params.toString();
  u.search = qs ? `?${qs}` : "";
  return u.toString();
}
