/**
 * Détecte les trous réels entre holdings et clôtures :
 * une séance boursière où une position (qty > 0) n'a AUCUNE clôture en base,
 * alors que le marché de ce titre était bien ouvert ce jour-là.
 *
 * Le compteur `missingPricesFilled` du backfill ne voit que les dates renvoyées
 * par Yahoo ; ce script compare holdings ↔ prix, donc il voit les angles morts.
 *
 * Usage : npx tsx scripts/diagnose-price-gaps.ts [--dates=20]
 */
import { prisma } from "@/lib/db/prisma";
import { findPriceGaps } from "@/features/portfolio/price-gap-detection";
import { isoDateFromDbDate, parseIsoDateLocal } from "@/features/portfolio/daily-close-key";
import { MAX_CLOSE_CARRY_FORWARD_DAYS } from "@/features/portfolio/backfill-market-history";
import { normalizeCurrency } from "@/lib/utils";

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (parseIsoDateLocal(toIso).getTime() - parseIsoDateLocal(fromIso).getTime()) /
      86_400_000,
  );
}

/**
 * Pour chaque séance sans clôture, indique si la valorisation peut être sauvée par
 * le report de la dernière clôture connue (sinon la position reste sans prix).
 */
async function describeFallbacks(
  gaps: Awaited<ReturnType<typeof findPriceGaps>>,
): Promise<void> {
  const rows = await prisma.portfolioDailyPrice.findMany({
    select: { ticker: true, currency: true, priceDate: true },
  });

  const datesByPair = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = `${row.ticker.toUpperCase()}|${normalizeCurrency(row.currency)}`;
    let dates = datesByPair.get(key);
    if (!dates) {
      dates = new Set<string>();
      datesByPair.set(key, dates);
    }
    dates.add(isoDateFromDbDate(row.priceDate));
  }

  for (const pair of gaps.pairsWithGaps) {
    const ownDates = [
      ...(datesByPair.get(`${pair.ticker}|${pair.currency}`) ?? []),
    ].toSorted();

    let carried = 0;
    let unpriced = 0;
    for (const date of pair.missingDates) {
      const previous = ownDates.filter((d) => d < date).at(-1);
      if (
        previous &&
        daysBetween(previous, date) <= MAX_CLOSE_CARRY_FORWARD_DAYS
      ) {
        carried += 1;
      } else {
        unpriced += 1;
      }
    }

    console.log(
      `  → ${pair.ticker}|${pair.currency} : ${carried} sauvable(s) par report, ` +
        `${unpriced} sans aucun prix` +
        ` (échantillon ${pair.missingDates.length} date(s))`,
    );
  }
}

function parseMaxDates(): number {
  const arg = process.argv.find((value) => value.startsWith("--dates="));
  if (!arg) return 12;
  const parsed = Number(arg.slice("--dates=".length));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 12;
}

async function main() {
  const report = await findPriceGaps({ maxDatesPerPair: parseMaxDates() });

  console.log("=== Trous holdings ↔ clôtures (séances réelles par marché) ===");
  console.log(
    `Séances reconstruites : TSX ${report.marketSessions.TSX} | US ${report.marketSessions.US}`,
  );
  console.log(`Paires (titre, devise) suivies : ${report.pairsChecked}`);
  console.log(
    `Séances détenues vérifiées : ${report.heldSessionsChecked} | sans clôture : ${report.missingSessions}`,
  );
  console.log(
    `Paires avec au moins un trou : ${report.pairsWithGaps.length}` +
      (report.pairsChecked > 0
        ? ` (${((report.pairsWithGaps.length / report.pairsChecked) * 100).toFixed(1)} %)`
        : ""),
  );
  console.log(
    `Séances non vérifiables (calendrier insuffisant) : ${report.unverifiedSessions}`,
  );
  console.log(
    `Dates de holdings hors séance (week-ends/fériés communs, ignorées) : ${report.ignoredNonTradingHoldingDates}`,
  );
  console.log("");

  if (report.pairsWithGaps.length === 0) {
    console.log("✅ Aucun trou : chaque séance détenue a une clôture.");
    return;
  }

  console.log("Couverture de valorisation des trous (échantillon) :");
  await describeFallbacks(report);
  console.log("");

  for (const pair of report.pairsWithGaps) {
    const more =
      pair.missingSessions > pair.missingDates.length
        ? ` … (+${pair.missingSessions - pair.missingDates.length})`
        : "";
    console.log(
      `${pair.ticker}|${pair.currency} [${pair.market}] : ${pair.missingSessions}/${pair.heldSessions} séances sans clôture` +
        ` | détenu ${pair.firstHeldDate} → ${pair.lastHeldDate}` +
        ` | dernière clôture ${pair.lastCloseDate ?? "aucune"}` +
        (pair.sessionsAfterLastClose > 0
          ? ` | ${pair.sessionsAfterLastClose} séance(s) après la dernière clôture`
          : ""),
    );
    console.log(`  dates : ${pair.missingDates.join(", ")}${more}`);
  }

  if (report.pairsWithoutAnyClose.length > 0) {
    console.log("");
    console.log(
      `⚠️ ${report.pairsWithoutAnyClose.length} paire(s) n'ont AUCUNE clôture : ` +
        report.pairsWithoutAnyClose
          .map((pair) => `${pair.ticker}|${pair.currency}`)
          .join(", "),
    );
  }
  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
