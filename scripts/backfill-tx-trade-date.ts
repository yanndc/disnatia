import { prisma } from "../src/lib/db/prisma";
import { txFingerprint, GLOBAL_TRANSACTION_DUPLICATE_SCOPE } from "../src/lib/csv/tx-fingerprint";

/**
 * Rattrape les transactions importées avant le repli `tradeDate ?? settlementDate` :
 * sans date d'opération, les cotisations et transferts étaient ignorés par les calculs
 * de flux (performance « depuis le début » / 3 ans faussés).
 *
 * Le fingerprint est recalculé avec la même règle que l'import pour éviter des doublons
 * lors d'un futur ré-import.
 */
async function main() {
  const dryRun = !process.argv.includes("--apply");
  const rows = await prisma.portfolioTransactionLine.findMany({
    where: { tradeDate: null, settlementDate: { not: null } },
    select: {
      id: true,
      accountKey: true,
      tradeDate: true,
      settlementDate: true,
      transactionType: true,
      ticker: true,
      amount: true,
      currency: true,
      quantity: true,
      price: true,
      securityName: true,
    },
  });

  const existing = await prisma.portfolioTransactionLine.findMany({
    where: { fingerprint: { not: null } },
    select: { id: true, fingerprint: true },
  });
  const fingerprintOwner = new Map(existing.map((row) => [row.fingerprint!, row.id]));

  console.log(
    `Transactions sans tradeDate : ${rows.length} — mode ${dryRun ? "SIMULATION (ajoute --apply)" : "APPLICATION"}`,
  );
  let duplicates = 0;
  let fixed = 0;

  for (const row of rows) {
    if (!row.settlementDate) continue;
    const tx = {
      tradeDate: row.settlementDate,
      settlementDate: row.settlementDate,
      transactionType: row.transactionType,
      ticker: row.ticker,
      amount: row.amount,
      currency: row.currency,
      quantity: row.quantity,
      price: row.price,
      securityName: row.securityName,
    };
    const scope = row.accountKey ?? GLOBAL_TRANSACTION_DUPLICATE_SCOPE;
    const fingerprint = txFingerprint(scope, tx as never);
    const ownerId = fingerprintOwner.get(fingerprint);

    if (ownerId && ownerId !== row.id) {
      duplicates += 1;
      if (!dryRun) {
        await prisma.portfolioTransactionLine.delete({ where: { id: row.id } });
      }
      continue;
    }

    fixed += 1;
    if (!dryRun) {
      await prisma.portfolioTransactionLine.update({
        where: { id: row.id },
        data: {
          tradeDate: row.settlementDate,
          fingerprint: row.accountKey ? fingerprint : null,
        },
      });
    }
  }

  console.log(
    `${dryRun ? "À supprimer (doublons)" : "Supprimées (doublons)"} : ${duplicates}`,
  );
  console.log(`${dryRun ? "À corriger (date)" : "Corrigées (date)"} : ${fixed}`);
}

main()
  .catch((cause) => {
    console.error("[backfill-tx-trade-date] échec", cause);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
