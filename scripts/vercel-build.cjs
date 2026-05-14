/**
 * Sur Vercel, Prisma migrate doit voir DIRECT_URL / DATABASE_URL (sinon prisma.config
 * retombe sur 127.0.0.1). Beaucoup d'échecs viennent des vars absentes pour Preview.
 */
const { spawnSync } = require("node:child_process");

/** Garde en sync avec `src/lib/db/postgres-env.ts` → MIGRATE_POSTGRES_URL_KEYS */
const MIGRATE_POSTGRES_URL_KEYS = [
  "DIRECT_URL",
  "POSTGRES_URL_NON_POOLING",
  "MIGRATE_DATABASE_URL",
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "SUPABASE_DATABASE_URL",
];

function hasDbUrl() {
  return MIGRATE_POSTGRES_URL_KEYS.some(
    (k) => process.env[k] && String(process.env[k]).trim().length > 0,
  );
}

if (process.env.VERCEL === "1" && !hasDbUrl()) {
  console.error(
    "\n[disnatia] Aucune URL Postgres pour le build. Variables reconnues :\n  " +
      MIGRATE_POSTGRES_URL_KEYS.join(", ") +
      "\n(voir src/lib/db/postgres-env.ts). Coche Preview + Production sur Vercel.\n"
  );
  process.exit(1);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("pnpm", ["exec", "prisma", "migrate", "deploy"]);
run("pnpm", ["exec", "next", "build"]);
