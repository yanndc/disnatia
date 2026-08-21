/**
 * Supprime les transactions "sans titre" (cotisations, virements) dupliquées entre deux
 * imports Historique Disnat à cause d'un ticker placeholder différent ("-" vs "--C").
 * Garde la ligne du PREMIER import (la plus ancienne par importedAt) dans chaque groupe de
 * doublons, supprime les autres.
 *
 * Usage :
 *   npx tsx scripts/dedupe-transactions.ts            (dry-run, n'écrit rien)
 *   npx tsx scripts/dedupe-transactions.ts --apply     (supprime réellement)
 */
import { prisma } from "@/lib/db/prisma";

const TICKERLESS_CATEGORIES = ["CONTRIBUTION", "TRANSFER_IN", "TRANSFER_OUT", "INTERNAL_TRANSFER"] as const;

/** Même logique que isPlaceholderTicker dans src/lib/csv/tx-fingerprint.ts. */
function normalizedTickerForGrouping(ticker: string | null): string {
  const t = (ticker ?? "").toUpperCase().trim();
  const stripped = t.replace(/-/g, "");
  return stripped.length <= 1 ? "" : t;
}

async function main() {
  const apply = process.argv.includes("--apply");

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
  type Group = { accountKey: string; date: string; category: string; currency: string; amount: number; rows: Row[] };
  const groups = new Map<string, Group>();

  for (const r of rows) {
    const dateKey = (r.tradeDate ?? r.settlementDate)?.toISOString().slice(0, 10) ?? "N/A";
    const amount = Math.round((r.amount ?? 0) * 100) / 100;
    const key = JSON.stringify([
      r.accountKey ?? "?",
      dateKey,
      r.txCategory,
      r.currency,
      amount,
      normalizedTickerForGrouping(r.ticker),
    ]);
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
  const idsToDelete: string[] = [];

  console.log(`Groupes avec doublons : ${dupGroups.length}\n`);

  for (const g of dupGroups) {
    const sorted = [...g.rows].toSorted(
      (a, b) => a.import.importedAt.getTime() - b.import.importedAt.getTime(),
    );
    const keep = sorted[0]!;
    const drop = sorted.slice(1);

    console.log(
      `${g.accountKey} | ${g.date} | ${g.category} | ${g.amount.toFixed(2)} ${g.currency}`,
    );
    console.log(
      `  garde  id=${keep.id} ticker="${keep.ticker}" import="${keep.import.sourceFileName}" (${keep.import.importedAt.toISOString().slice(0, 10)})`,
    );
    for (const d of drop) {
      console.log(
        `  ${apply ? "SUPPRIME" : "supprimerait"} id=${d.id} ticker="${d.ticker}" import="${d.import.sourceFileName}" (${d.import.importedAt.toISOString().slice(0, 10)})`,
      );
      idsToDelete.push(d.id);
    }
  }

  console.log(`\nTotal lignes à supprimer : ${idsToDelete.length}`);

  if (!apply) {
    console.log("\nMode dry-run — aucune suppression effectuée. Relance avec --apply pour appliquer.");
    return;
  }

  const result = await prisma.portfolioTransactionLine.deleteMany({
    where: { id: { in: idsToDelete } },
  });
  console.log(`\n${result.count} ligne(s) supprimée(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
