/**
 * Sur Vercel, Prisma migrate doit voir DIRECT_URL / DATABASE_URL (sinon prisma.config
 * retombe sur 127.0.0.1). Beaucoup d'échecs viennent des vars absentes pour Preview.
 */
const { spawnSync } = require("node:child_process");

function hasDbUrl() {
  return !!(
    process.env.DIRECT_URL?.trim() ||
    process.env.MIGRATE_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim()
  );
}

if (process.env.VERCEL === "1" && !hasDbUrl()) {
  console.error(
    "\n[disnatia] Aucune URL Postgres pour le build (DATABASE_URL / DIRECT_URL / MIGRATE_DATABASE_URL).\n" +
      "Dans Vercel → Settings → Environment Variables, ajoute les mêmes clés que dans .env.local pour\n" +
      "l'environnement qui build (souvent Preview ET Production, pas seulement une des deux).\n"
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
