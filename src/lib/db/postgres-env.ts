/**
 * Noms de variables possibles pour l’URL Postgres (héritage Vercel / Supabase / projets).
 * Prisma ne lit pas NEXT_PUBLIC_* ni la clé publishable : il faut une URI postgresql:// complète.
 */

/** Migrate / prisma.config : préfère une URL « directe » ou session quand c’est possible. */
export const MIGRATE_POSTGRES_URL_KEYS = [
  "DIRECT_URL",
  "POSTGRES_URL_NON_POOLING",
  "MIGRATE_DATABASE_URL",
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "SUPABASE_DATABASE_URL",
] as const;

/** Runtime @prisma/adapter-pg : URL applicative (souvent pooler transaction). */
export const RUNTIME_POSTGRES_URL_KEYS = [
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "SUPABASE_DATABASE_URL",
  "DIRECT_URL",
  "LOCAL_DATABASE_URL",
] as const;

/** Clés à réappliquer depuis `.env.local` (database-env-bootstrap). */
export const POSTGRES_URL_ENV_KEYS_FOR_DOTENV = [
  ...new Set([...MIGRATE_POSTGRES_URL_KEYS, ...RUNTIME_POSTGRES_URL_KEYS]),
] as const;

export function firstEnvValue(
  keys: readonly string[],
): string | undefined {
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function hasAnyPostgresUrlForMigrate(): boolean {
  return firstEnvValue(MIGRATE_POSTGRES_URL_KEYS) !== undefined;
}

export function hasAnyPostgresUrlForRuntime(): boolean {
  return firstEnvValue(RUNTIME_POSTGRES_URL_KEYS) !== undefined;
}
