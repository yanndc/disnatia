import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

const DATABASE_ENV_KEYS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "LOCAL_DATABASE_URL",
  "MIGRATE_DATABASE_URL",
] as const;

/**
 * L’IDE (ex. Cursor) ou le shell peuvent exporter un `DATABASE_URL` vers une autre base :
 * alors ni Next ni `dotenv.config({ override: false })` ne lisent `.env.local` pour cette clé.
 * On reapplique depuis `.env.local` pour les URLs Postgres vues par Prisma.
 */
export function applyDatabaseEnvOverridesFromEnvLocal(
  cwd: string = process.cwd(),
): void {
  const envLocalPath = resolve(cwd, ".env.local");
  if (!existsSync(envLocalPath)) return;

  let parsed: ReturnType<typeof dotenv.parse>;
  try {
    parsed = dotenv.parse(readFileSync(envLocalPath, "utf8"));
  } catch {
    return;
  }

  for (const key of DATABASE_ENV_KEYS) {
    const raw = parsed[key];
    if (raw === undefined) continue;
    const value = raw.trim();
    if (value.length > 0) {
      process.env[key] = value;
    }
  }
}
