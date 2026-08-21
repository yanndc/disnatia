/**
 * Rapport (lecture seule, ne modifie rien) des transactions "sans titre" (cotisations,
 * virements) probablement dupliquées entre deux imports "Historique" Disnat, à cause d'un
 * ticker placeholder qui varie d'un fichier à l'autre ("-" vs "--C") et contournait la
 * déduplication (voir src/lib/csv/tx-fingerprint.ts).
 * Usage : npx tsx scripts/find-duplicate-transactions.ts
 */
import { prisma } from "@/lib/db/prisma";

const TICKERLESS_CATEGORIES = ["CONTRIBUTION", "TRANSFER_IN", "TRANSFER_OUT", "INTERNAL_TRANSFER"] as const;

async function main() {
  const rows = await prisma.portfolioTransactionLine.findMany({
    where: { txCategory: { in: [...TICKERLESS_CATEGORIES] } },
    select: {
      id: true,
      accountKey: true,
      tradeDate: true,
      settlementDate: true,
      txCategory: true,
      ticker: true,
      amount: true,
      currency: true,
      import: { select: { sourceFileName: true, importedAt: true } },
    },
    orderBy: [{ accountKey: "asc" }, { settlementDate: "asc" }],
  });

  type Row = (typeof rows)[number];
  type Group = {
    accountKey: string;
    date: string;
    category: string;
    currency: string;
    amount: number;
    rows: Row[];
  };
  const groups = new Map<string, Group>();

  for (const r of rows) {
    const dateKey = (r.tradeDate ?? r.settlementDate)?.toISOString().slice(0, 10) ?? "N/A";
    const amount = Math.round((r.amount ?? 0) * 100) / 100;
    const key = JSON.stringify([r.accountKey ?? "?", dateKey, r.txCategory, r.currency, amount]);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(r);
    } else {
      groups.set(key, {
        accountKey: r.accountKey ?? "?",
        date: dateKey,
        category: r.txCategory ?? "?",
        currency: r.currency ?? "?",
        amount,
        rows: [r],
      });
    }
  }

  const dupGroups = [...groups.values()].filter((g) => g.rows.length > 1);
  let totalDuplicateRows = 0;

  console.log(`Groupes de transactions sans titre trouvés : ${groups.size}`);
  console.log(`Groupes avec >1 ligne (doublons probables) : ${dupGroups.length}\n`);

  for (const g of dupGroups) {
    totalDuplicateRows += g.rows.length - 1;
    console.log(
      `${g.accountKey} | ${g.date} | ${g.category} | ${g.amount.toFixed(2)} ${g.currency} — ${g.rows.length} lignes :`,
    );
    for (const r of g.rows) {
      console.log(
        `    id=${r.id} ticker="${r.ticker}" import="${r.import.sourceFileName}" (${r.import.importedAt.toISOString().slice(0, 10)})`,
      );
    }
  }

  console.log(`\nTotal lignes en trop (si un seul exemplaire gardé par groupe) : ${totalDuplicateRows}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
