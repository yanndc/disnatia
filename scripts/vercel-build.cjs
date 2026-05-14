const { spawnSync } = require("node:child_process");

/**
 * Liste identique à `MIGRATE_POSTGRES_URL_KEYS` dans src/lib/db/postgres-env.ts
 */
const MIGRATE_POSTGRES_URL_KEYS = [
  "DIRECT_URL",
  "MIGRATE_DATABASE_URL",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "SUPABASE_DATABASE_URL",
  "LOCAL_DATABASE_URL",
];

function hasDbUrl() {
  return MIGRATE_POSTGRES_URL_KEYS.some(
    (k) => process.env[k] && String(process.env[k]).trim().length > 0,
  );
}

if (process.env.VERCEL === "1" && !hasDbUrl()) {
  console.error(
    "\n[disnatia] Il manque une URL Postgres pour migrate (ex. DIRECT_URL + DATABASE_URL).\n" +
      "Voir src/lib/db/postgres-env.ts\n"
  );
  process.exit(1);
}

if (process.env.VERCEL === "1") {
  for (const k of MIGRATE_POSTGRES_URL_KEYS) {
    const v = process.env[k]?.trim();
    if (!v) continue;
    let where = "?";
    try {
      const u = new URL(v);
      where = u.hostname + (u.port ? `:${u.port}` : "");
    } catch {
      where = "(URI illisible)";
    }
    console.log(`[disnatia] prisma migrate utilise ${k} → ${where}`);
    break;
  }
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
