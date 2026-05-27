/**
 * Normalise les champs owner en base (portfolio_account_states, external_portfolio_accounts).
 * Usage : node scripts/normalize-portfolio-owners.mjs
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import pg from "pg";

const { Pool } = pg;

config({ path: resolve(process.cwd(), ".env.local") });

const DISNAT_SECTION = /^(ACTIONS|OPÉRATIONS|OPERATIONS)\s+(CAD|USD)\s*$/i;
const LOWER_PARTICLES = new Set([
  "de", "du", "des", "d", "la", "le", "les", "l", "et",
]);

function collapseWhitespace(raw) {
  return raw.trim().replace(/\s+/g, " ");
}

function capitalizeWord(word) {
  const lower = word.toLocaleLowerCase("fr-CA");
  if (lower.includes("-")) {
    return lower
      .split("-")
      .map((part) =>
        part.length > 0
          ? part.charAt(0).toLocaleUpperCase("fr-CA") + part.slice(1)
          : part,
      )
      .join("-");
  }
  if (lower.length === 0) return lower;
  return lower.charAt(0).toLocaleUpperCase("fr-CA") + lower.slice(1);
}

function formatPortfolioOwnerDisplay(raw) {
  const s = collapseWhitespace(raw);
  if (!s) return s;
  return s
    .split(" ")
    .map((word, index) => {
      const lower = word.toLocaleLowerCase("fr-CA");
      if (index > 0 && LOWER_PARTICLES.has(lower)) return lower;
      return capitalizeWord(word);
    })
    .join(" ");
}

function sanitizePortfolioOwner(raw) {
  if (raw == null) return null;
  const s = collapseWhitespace(String(raw));
  if (!s) return null;
  if (DISNAT_SECTION.test(s)) return null;
  return formatPortfolioOwnerDisplay(s);
}

function resolveUrl() {
  return (
    process.env.DIRECT_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL
  );
}

async function normalizeTable(pool, table) {
  const { rows } = await pool.query(
    `select id, owner from ${table} where owner is not null`,
  );
  let updated = 0;
  for (const row of rows) {
    const next = sanitizePortfolioOwner(row.owner);
    if (next === row.owner) continue;
    await pool.query(`update ${table} set owner = $1 where id = $2`, [
      next,
      row.id,
    ]);
    console.log(`${table}: "${row.owner}" → "${next}"`);
    updated++;
  }
  return updated;
}

async function main() {
  const url = resolveUrl();
  if (!url) {
    console.error("DATABASE_URL / DIRECT_URL manquant.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  let total = 0;
  total += await normalizeTable(pool, "portfolio_account_states");
  total += await normalizeTable(pool, "external_portfolio_accounts");
  console.log(`Terminé — ${total} ligne(s) mise(s) à jour.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
