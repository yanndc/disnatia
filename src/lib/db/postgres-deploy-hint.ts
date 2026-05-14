/**
 * Sur Vercel (IPv4), la connexion Postgres « directe » Supabase (:5432 sur db.*.supabase.co)
 * échoue souvent : elle est en IPv6. Le runtime serverless doit utiliser le pooler
 * en mode Transaction (:6543 + pgbouncer), voir https://supabase.com/docs/guides/database/prisma
 */
export function getPostgresDeployHint(): string | null {
  if (process.env.VERCEL !== "1") return null;
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.hostname;
    const port = u.port || "5432";
    const isDirectCluster =
      host.startsWith("db.") && host.endsWith(".supabase.co") && port === "5432";
    if (isDirectCluster) {
      return "DATABASE_URL pointe vers la connexion directe (port 5432). Sur Vercel, remplace-la par l’URI « Transaction pooler » du dashboard (port 6543, suffixe ?pgbouncer=true). Garde DIRECT_URL en Session pooler ou directe pour les migrations.";
    }
  } catch {
    return null;
  }
  return null;
}
