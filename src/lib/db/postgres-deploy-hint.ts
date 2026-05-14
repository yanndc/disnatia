/**
 * Indices pour erreurs Postgres en prod (Vercel + Supabase surtout).
 * @see https://supabase.com/docs/guides/database/prisma
 */
export function getPostgresDeployHint(): string | null {
  if (process.env.VERCEL !== "1") return null;

  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) {
    return "DATABASE_URL est absente pour ce déploiement. Vercel → Settings → Environment Variables → Production.";
  }

  try {
    const u = new URL(raw);
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
      return "Mot de passe avec @ # etc. → doit être encodé dans l’URL. Copie DATABASE_URL depuis Supabase → Connect → Transaction ; compare avec les Runtime logs (erreur auth vs réseau).";
    }

    return "Vérifie DATABASE_URL dans Vercel (pas de guillemets parasites) et les Runtime logs pour le détail.";
  } catch {
    return "DATABASE_URL n’est pas une URI valide (essayez d’encoder les caractères spéciaux du mot de passe).";
  }
}
