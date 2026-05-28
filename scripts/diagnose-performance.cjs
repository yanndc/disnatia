/**
 * Diagnostic P&L vs données prod — compare live quotes et séances persistées.
 * Usage: node scripts/diagnose-performance.cjs
 */
require("dotenv").config({ path: ".env.local" });
const { PrismaClient } = require("../src/generated/prisma/client");

const prisma = new PrismaClient();

async function main() {
  const accounts = await prisma.portfolioAccountState.findMany({
    where: { accountKey: { not: { startsWith: "ext:" } } },
    orderBy: { accountKey: "asc" },
  });

  const positions = await prisma.portfolioPosition.findMany({
    where: { quantity: { gt: 0 } },
    include: { account: true },
  });

  const quotes = await prisma.portfolioLiveQuote.findMany();
  const quoteMap = new Map(
    quotes.map((q) => [`${q.ticker.toUpperCase()}|${q.currency.toUpperCase()}`, q]),
  );

  const fxRow = await prisma.$queryRaw`
    SELECT rate FROM fx_usd_cad_rates ORDER BY rate_date DESC LIMIT 1
  `.catch(() => null);
  const usdToCad =
    Array.isArray(fxRow) && fxRow[0]?.rate ? Number(fxRow[0].rate) : 1.38;

  const byAccount = new Map();
  for (const p of positions) {
    const key = `${p.account.accountNumber?.replace(/\s/g, "").toUpperCase()}|${p.currency.toUpperCase()}`;
    const q = quoteMap.get(`${p.ticker.toUpperCase()}|${p.currency.toUpperCase()}`);
    const delta = q?.changeAmount ?? (q?.price != null && q?.previousClose != null ? q.price - q.previousClose : null);
    const dayGain = delta != null ? p.quantity * delta : null;
    const row = byAccount.get(key) ?? { gainNative: 0, hasGain: false, missing: 0, lines: 0 };
    row.lines++;
    if (dayGain != null) {
      row.hasGain = true;
      row.gainNative += dayGain;
    } else row.missing++;
    byAccount.set(key, row);
  }

  let totalCad = 0;
  console.log("\n=== P&L jour (live quotes) ===");
  for (const acc of accounts) {
    const row = byAccount.get(acc.accountKey);
    if (!row?.hasGain) continue;
    const cur = acc.currency.toUpperCase();
    const gainCad = cur === "USD" ? row.gainNative * usdToCad : row.gainNative;
    totalCad += gainCad;
    console.log(
      `${acc.accountKey}: ${gainCad.toFixed(2)} CAD (${row.lines} lignes, ${row.missing} sans cotation)`,
    );
  }
  console.log(`TOTAL live: ${totalCad.toFixed(2)} CAD (FX ${usdToCad})`);

  const sessionCount = await prisma.portfolioDailyAccountSessionGain.count();
  console.log(`\n=== Séances persistées: ${sessionCount} lignes ===`);

  if (sessionCount > 0) {
    const recent = await prisma.portfolioDailyAccountSessionGain.groupBy({
      by: ["sessionDate"],
      _sum: { gainNative: true },
      orderBy: { sessionDate: "desc" },
      take: 5,
    });
    for (const r of recent) {
      console.log(`  ${r.sessionDate.toISOString().slice(0, 10)}: ${r._sum.gainNative?.toFixed(2)} native (approx)`);
    }
  }

  const holdings = await prisma.portfolioDailyHolding.groupBy({
    by: ["accountKey"],
    _max: { holdingDate: true },
    _count: true,
  });
  console.log("\n=== Holdings journaliers (dernière date) ===");
  for (const h of holdings.sort((a, b) => a.accountKey.localeCompare(b.accountKey))) {
    console.log(
      `  ${h.accountKey}: ${h._max.holdingDate?.toISOString().slice(0, 10)} (${h._count} rows)`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
