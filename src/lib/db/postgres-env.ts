/**
 * Postgres / Prisma : l’app et `migrate` n’utilisent pas la même URL Supabase idéale.
 * - Runtime : pooler **Transaction** → surtout `DATABASE_URL` (6543).
 * - Migrate : pooler **Session** ou direct → surtout `DIRECT_URL` (5432) en premier si défini.
 * NEXT_PUBLIC_* = client JS uniquement, pas une URI Postgres.
 */

/** Client Prisma / requêtes (priorité au pooler transaction). */
export const RUNTIME_POSTGRES_URL_KEYS = [
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "SUPABASE_DATABASE_URL",
  "POSTGRES_URL_NON_POOLING",
  "DIRECT_URL",
  "MIGRATE_DATABASE_URL",
  "LOCAL_DATABASE_URL",
] as const;

/** `prisma migrate` (priorité session/direct avant transaction). */
export const MIGRATE_POSTGRES_URL_KEYS = [
  "DIRECT_URL",
  "MIGRATE_DATABASE_URL",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "SUPABASE_DATABASE_URL",
  "LOCAL_DATABASE_URL",
] as const;

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

export function getPostgresUrlFromEnv(): string | undefined {
  return firstEnvValue(RUNTIME_POSTGRES_URL_KEYS);
}
