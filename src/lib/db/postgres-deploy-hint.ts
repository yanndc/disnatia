import { coerceValidPostgresUrl } from "./coerce-postgres-url";
import { firstEnvValue, RUNTIME_POSTGRES_URL_KEYS } from "./postgres-env";

/**
 * Indices pour erreurs Postgres en prod (Vercel + Supabase surtout).
 * @see https://supabase.com/docs/guides/database/prisma
 */
export function getPostgresDeployHint(): string | null {
  if (process.env.VERCEL !== "1") return null;

  const raw = firstEnvValue(RUNTIME_POSTGRES_URL_KEYS);
  if (!raw) {
    return "Aucune URL Postgres trouvée (DATABASE_URL, POSTGRES_URL, SUPABASE_DATABASE_URL, etc.). Vercel → Environment Variables.";
  }

  let u: URL;
  try {
    u = new URL(coerceValidPostgresUrl(raw));
  } catch {
    try {
      u = new URL(raw);
    } catch {
      return "DATABASE_URL n’est pas une URI Postgres lisible. Retire les guillemets autour de la valeur dans Vercel, ou regénère le mot de passe Supabase et recolle l’URI du dashboard.";
    }
  }

  const host = u.hostname;
  const port = u.port || "5432";

  if (host === "localhost" || host === "127.0.0.1") {
    return "DATABASE_URL pointe vers localhost : remplace par l’URL Supabase (Transaction pooler :6543 + ?pgbouncer=true).";
  }

  if (host.startsWith("db.") && host.endsWith(".supabase.co") && port === "5432") {
    return "db.*.supabase.co:5432 = connexion directe (IPv6), souvent inaccessible depuis Vercel. Utilise « Transaction pooler » (port 6543 + ?pgbouncer=true) pour DATABASE_URL.";
  }

  if (host.includes("pooler.supabase.com") && port === "6543") {
    const pb = u.searchParams.get("pgbouncer");
    if (!pb || pb === "false") {
      return "Mode Transaction (port 6543) : ajoute ?pgbouncer=true (ou &pgbouncer=true) à DATABASE_URL.";
    }
  }

  const isSupabase =
    host.includes("supabase.com") || host.endsWith(".supabase.co");
  if (isSupabase) {
    return "Mot de passe ou URI : reprends l’URI depuis Supabase → Connect → Transaction ; compare les Runtime logs (auth vs réseau).";
  }

  return "Vérifie DATABASE_URL dans Vercel (pas de guillemets parasites) et les Runtime logs pour le détail.";
}
