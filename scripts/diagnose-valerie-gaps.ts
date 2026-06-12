import { prisma } from "@/lib/db/prisma";
import { isoDateFromDbDate } from "@/features/portfolio/daily-close-key";

const PREFIX = "5L3AP";

async function main() {
  const accounts = await prisma.portfolioAccountState.findMany({
    where: { accountKey: { startsWith: PREFIX } },
    select: { accountKey: true, owner: true, marketValue: true, cashValue: true, totalValue: true },
    orderBy: { accountKey: "asc" },
  });

  console.log(`=== Comptes ${PREFIX}* (${accounts.length}) ===\n`);

  for (const acc of accounts) {
    const [holdings, dailyHoldings, sessions, txs, liveHoldings] = await Promise.all([
      prisma.portfolioHolding.count({ where: { accountKey: acc.accountKey, quantity: { gt: 0 } } }),
      prisma.portfolioDailyHolding.aggregate({
        where: { accountKey: acc.accountKey, quantity: { gt: 0 } },
        _count: true,
        _min: { holdingDate: true },
        _max: { holdingDate: true },
      }),
      prisma.portfolioDailyAccountSessionGain.aggregate({
        where: { accountKey: acc.accountKey },
        _count: true,
        _min: { sessionDate: true },
        _max: { sessionDate: true },
      }),
      prisma.portfolioTransactionLine.aggregate({
        where: { accountKey: acc.accountKey },
        _count: true,
        _min: { tradeDate: true, settlementDate: true },
        _max: { tradeDate: true, settlementDate: true },
      }),
      prisma.portfolioHolding.findMany({
        where: { accountKey: acc.accountKey, quantity: { gt: 0 } },
        select: { ticker: true, currency: true, quantity: true, snapshotValue: true },
        orderBy: { snapshotValue: "desc" },
        take: 3,
      }),
    ]);

    const dailyFirst = dailyHoldings._min.holdingDate
      ? isoDateFromDbDate(dailyHoldings._min.holdingDate)
      : "—";
    const dailyLast = dailyHoldings._max.holdingDate
      ? isoDateFromDbDate(dailyHoldings._max.holdingDate)
      : "—";
    const sessFirst = sessions._min.sessionDate
      ? isoDateFromDbDate(sessions._min.sessionDate)
      : "—";
    const sessLast = sessions._max.sessionDate
      ? isoDateFromDbDate(sessions._max.sessionDate)
      : "—";

    console.log(acc.accountKey);
    console.log(`  titres live: ${holdings} | MV=${Math.round(acc.marketValue)} cash=${Math.round(acc.cashValue)}`);
    console.log(`  holdings journaliers: ${dailyHoldings._count} jours (${dailyFirst} → ${dailyLast})`);
    console.log(`  session_gains: ${sessions._count} jours (${sessFirst} → ${sessLast})`);
    console.log(`  transactions: ${txs._count}`);
    if (liveHoldings.length > 0) {
      console.log(
        `  positions: ${liveHoldings.map((h) => `${h.ticker}(${h.currency})=${Math.round(h.snapshotValue)}`).join(", ")}`,
      );
    } else {
      console.log("  positions: (aucune — compte cash seulement?)");
    }

    if (dailyHoldings._count === 0 && txs._count > 0) {
      console.log("  ⚠ transactions présentes mais PAS de holdings journaliers projetés");
    }
    if (dailyHoldings._count > 0 && sessions._count === 0) {
      console.log("  ⚠ holdings journaliers OK mais PAS de session_gains (prix/FX manquants?)");
    }
    if (holdings === 0 && sessions._count === 0) {
      console.log("  → compte sans titres : pas de P&L titres attendu");
    }
    console.log();
  }

  // Transactions sans accountKey pour Valérie
  const orphanTx = await prisma.portfolioTransactionLine.count({
    where: {
      accountKey: null,
      OR: [
        { accountName: { contains: "5L3AP", mode: "insensitive" } },
        { accountNumber: { contains: "5L3AP", mode: "insensitive" } },
      ],
    },
  });
  if (orphanTx > 0) {
    console.log(`⚠ ${orphanTx} transactions Valérie sans accountKey rattaché`);
  }

  console.log("\n=== Transactions 5L3APA5|CAD (compte sans titres) ===");
  const apa5Txs = await prisma.portfolioTransactionLine.findMany({
    where: { accountKey: "5L3APA5|CAD" },
    select: {
      tradeDate: true,
      txCategory: true,
      transactionType: true,
      ticker: true,
      quantity: true,
      amount: true,
    },
    orderBy: { tradeDate: "asc" },
  });
  for (const t of apa5Txs) {
    console.log(
      `  ${t.tradeDate?.toISOString().slice(0, 10)} | ${t.txCategory} | ${t.transactionType} | ${t.ticker ?? "-"} | qty=${t.quantity} | ${t.amount}`,
    );
  }

  console.log("\n=== Début historique 5L3APY0|CAD (TWR gonflé?) ===");
  const early = await prisma.portfolioDailyAccountSessionGain.findMany({
    where: { accountKey: "5L3APY0|CAD" },
    orderBy: { sessionDate: "asc" },
    take: 5,
    select: { sessionDate: true, gainNative: true, priorNative: true },
  });
  for (const s of early) {
    const pct =
      s.priorNative > 0 ? ((s.gainNative / s.priorNative) * 100).toFixed(1) : "—";
    console.log(
      `  ${isoDateFromDbDate(s.sessionDate)} | prior=${Math.round(s.priorNative)} | gain=${Math.round(s.gainNative)} | ${pct}%`,
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
