/**
 * Compare, pour une date, les lignes d'un import portefeuille Disnat aux positions
 * reconstruites (transactions × clôture du jour) — pour expliquer un écart de niveau.
 *
 * Usage : npx tsx scripts/diagnose-import-vs-reconstruction.ts 2026-06-05
 */
import { prisma } from "@/lib/db/prisma";
import { isoDateFromDbDate, isoDateFromDbTimestamp } from "@/features/portfolio/daily-close-key";

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Date requise (yyyy-mm-dd).");
    process.exitCode = 1;
    return;
  }

  const imports = await prisma.portfolioImport.findMany({
    where: { status: "COMPLETED", accounts: { some: {} } },
    orderBy: [{ dataToDate: "desc" }, { importedAt: "desc" }],
    select: { id: true, importedAt: true, dataToDate: true, sourceFileName: true },
  });
  const matching = imports.filter((imp) =>
    (imp.dataToDate ? isoDateFromDbDate(imp.dataToDate) : isoDateFromDbTimestamp(imp.importedAt)) === target,
  );
  if (matching.length === 0) {
    console.log(`Aucun import portefeuille au ${target}. Imports disponibles :`);
    for (const imp of imports.slice(0, 12)) {
      console.log(
        `  ${imp.dataToDate ? isoDateFromDbDate(imp.dataToDate) : isoDateFromDbTimestamp(imp.importedAt)} · ${imp.sourceFileName}`,
      );
    }
    return;
  }

  const day = new Date(`${target}T00:00:00.000Z`);
  const [holdings, prices] = await Promise.all([
    prisma.portfolioDailyHolding.findMany({ where: { holdingDate: day } }),
    prisma.portfolioDailyPrice.findMany({ where: { priceDate: day } }),
  ]);
  const priceMap = new Map(
    prices.map((p) => [`${p.ticker.toUpperCase()}|${p.currency.toUpperCase()}`, p.closePrice]),
  );
  const reconByKey = new Map(
    holdings.map((h) => [`${h.accountKey}|${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`, h]),
  );

  for (const imp of matching) {
    console.log(`\n=== Import ${imp.sourceFileName} (${imp.id}) ===`);
    const positions = await prisma.portfolioPosition.findMany({
      where: { importId: imp.id },
      orderBy: [{ accountNumber: "asc" }, { marketValue: "desc" }],
    });

    let totalFile = 0;
    let totalRecon = 0;
    for (const pos of positions) {
      const accountKey = `${(pos.accountNumber ?? "").replace(/\s/g, "").toUpperCase()}|${pos.currency.toUpperCase()}`;
      const recon = reconByKey.get(`${accountKey}|${pos.ticker.toUpperCase()}|${pos.currency.toUpperCase()}`);
      const price = priceMap.get(`${pos.ticker.toUpperCase()}|${pos.currency.toUpperCase()}`);
      const reconValue = recon && price !== undefined ? Math.abs(recon.quantity) * price : null;
      const delta = reconValue === null ? null : reconValue - pos.marketValue;
      totalFile += pos.marketValue;
      if (reconValue !== null) totalRecon += reconValue;
      if (delta === null || Math.abs(delta) >= 25 || (recon && Math.abs(recon.quantity - pos.quantity) > 0.0001)) {
        console.log(
          `  ${accountKey} ${pos.ticker} q=${fmt(pos.quantity)} (recon ${fmt(recon?.quantity)})` +
            ` · fichier ${fmt(pos.marketValue)} $ · recon ${fmt(reconValue)} $` +
            ` (prix fichier ${fmt(pos.marketPrice)} / clôture ${fmt(price)}) → écart ${fmt(delta)} $`,
        );
      }
    }
    console.log(
      `  TOTAL fichier ${fmt(totalFile)} $ · recon ${fmt(totalRecon)} $ → ${fmt(totalRecon - totalFile)} $`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
