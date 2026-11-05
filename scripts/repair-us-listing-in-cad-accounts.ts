/**
 * Répare les titres **US cotés en USD détenus dans un compte CAD** : Disnat libelle ces lignes
 * `-C` (devise du compte), et l'app les prenait pour des CDR TSX (`AMZN-C` → `AMZN.TO`).
 * Résultat : valorisation ~10× trop basse et « trous » de clôtures qui n'existent pas
 * (série Yahoo du CDR démarrée en 2022-07-26).
 *
 * Étapes :
 * 1. repère les tiges dont une opération tarifée dit « marché USA / prix USD » alors qu'elles
 *    portent un suffixe `-C` (donc plus tard résolues USD) ;
 * 2. purge les clôtures enregistrées pour ces paires CAD (cours d'un autre titre) ;
 * 3. re-projette les holdings depuis les transactions (clés de cotation corrigées) ;
 * 4. complète l'historique USD→CAD puis relance le backfill (clôtures, valeurs, gains) ;
 * 5. affiche les trous restants.
 *
 * Usage : npx tsx scripts/repair-us-listing-in-cad-accounts.ts [--dry-run]
 */
import { prisma } from "@/lib/db/prisma";
import { backfillMarketHistory } from "@/features/portfolio/backfill-market-history";
import { recomputeAndPersistSessionGains } from "@/features/portfolio/performance-session-gains";
import { isoDateFromDbDate } from "@/features/portfolio/daily-close-key";
import {
  projectHoldingsFromTransactions,
  resolveListingCurrencyFromEvidence,
  type ListingEvidenceRow,
} from "@/features/portfolio/project-transaction-holdings";
import { refreshUsdCadRatesIfStale } from "@/lib/fx/refresh-usd-cad-rates";
import {
  extractDisnatStemForPositionAggregation,
  standardizeDisnatTickerMarketDots,
} from "@/lib/market/disnat-ticker";
import { categorizeTxType } from "@/lib/csv/tx-category";

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  return new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

const POSITION_CATEGORIES = new Set([
  "BUY",
  "SELL",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "STOCK_DIVIDEND",
  "EXCHANGE",
  "CONTRIBUTION",
  "INTERNAL_TRANSFER",
  "REVERSAL",
  "TERMINATION",
  "STOCK_SPLIT",
]);

async function findMislistedPairs() {
  const txs = await prisma.portfolioTransactionLine.findMany({
    where: { ticker: { not: null }, accountKey: { not: null } },
    select: {
      accountKey: true,
      ticker: true,
      currency: true,
      priceDevise: true,
      market: true,
      price: true,
      quantity: true,
      txCategory: true,
      transactionType: true,
    },
  });

  const groups = new Map<
    string,
    { accountKey: string; stem: string; rows: ListingEvidenceRow[]; sawCanadianSuffix: boolean }
  >();

  for (const tx of txs) {
    const ticker = tx.ticker?.trim();
    if (!ticker || ticker === "-" || !tx.accountKey) continue;
    const movesShares =
      POSITION_CATEGORIES.has(String(tx.txCategory ?? "")) ||
      POSITION_CATEGORIES.has(String(categorizeTxType(tx.transactionType) ?? ""));
    if (!movesShares || tx.quantity == null || Math.abs(tx.quantity) < 1e-9) continue;

    const stem = extractDisnatStemForPositionAggregation(ticker);
    const key = `${tx.accountKey}|${stem}`;
    const group =
      groups.get(key) ?? { accountKey: tx.accountKey, stem, rows: [], sawCanadianSuffix: false };
    group.rows.push({
      ticker,
      currency: tx.currency,
      priceDevise: tx.priceDevise,
      market: tx.market,
      price: tx.price,
    });
    if (standardizeDisnatTickerMarketDots(ticker.toUpperCase()).endsWith("-C")) {
      group.sawCanadianSuffix = true;
    }
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter((g) => g.sawCanadianSuffix && resolveListingCurrencyFromEvidence(g.rows) === "USD")
    .map((g) => ({ accountKey: g.accountKey, stem: g.stem, ticker: `${g.stem}-C` }));
}

/**
 * Paires de clôtures devenues orphelines : une série `TITRE-C|CAD` qui n'est plus détenue alors que
 * la version US (`TITRE-U|USD`) l'est — trace d'une projection où le titre US avait été pris
 * pour une cotation canadienne.
 */
async function findOrphanCadSeries(): Promise<{ ticker: string; currency: string }[]> {
  const [pricePairs, holdingPairs] = await Promise.all([
    prisma.portfolioDailyPrice.groupBy({ by: ["ticker", "currency"] }),
    prisma.portfolioDailyHolding.groupBy({
      by: ["ticker", "currency"],
      where: { quantity: { gt: 0 } },
    }),
  ]);

  const held = new Set(
    holdingPairs.map((row) => `${row.ticker.toUpperCase()}|${row.currency.toUpperCase()}`),
  );

  const out: { ticker: string; currency: string }[] = [];
  for (const pair of pricePairs) {
    const ticker = pair.ticker.toUpperCase();
    if (!ticker.endsWith("-C")) continue;
    if (!pair.currency.trim().toUpperCase().startsWith("CA")) continue;
    if (held.has(`${ticker}|CAD`)) continue;
    const stem = ticker.slice(0, -2);
    if (!held.has(`${stem}-U|USD`)) continue;
    out.push({ ticker: pair.ticker, currency: pair.currency });
  }
  return out;
}

/**
 * Fenêtre où la valorisation était fausse pour ces paires : bornes des opérations connues
 * sur la tige (achat → sortie), + marge pour couvrir le report de clôture.
 */
async function resolveAffectedWindow(
  mislisted: { accountKey: string; stem: string }[],
): Promise<{ from: string | null; to: string | null }> {
  let from: string | null = null;
  let to: string | null = null;
  for (const pair of mislisted) {
    const rows = await prisma.portfolioTransactionLine.findMany({
      where: {
        accountKey: pair.accountKey,
        ticker: { startsWith: pair.stem },
        OR: [{ tradeDate: { not: null } }, { settlementDate: { not: null } }],
      },
      select: { tradeDate: true, settlementDate: true },
    });
    for (const row of rows) {
      const date = row.tradeDate ?? row.settlementDate;
      if (!date) continue;
      const iso = isoDateFromDbDate(date);
      if (!from || iso < from) from = iso;
      if (!to || iso > to) to = iso;
    }
  }
  return { from, to: to ? addDaysIso(to, 10) : null };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const gainsOnly = process.argv.includes("--gains-only");

  const mislisted = await findMislistedPairs();
  if (mislisted.length === 0) {
    console.log("✅ Aucune paire confondue avec une cotation canadienne.");
  } else {
    console.log(
      `⚠️ ${mislisted.length} paire(s) US libellée(s) -C en compte CAD :\n` +
        mislisted.map((m) => `   • ${m.ticker}|CAD (compte ${m.accountKey}) → titre US`).join("\n"),
    );
  }
  if (dryRun) {
    const orphans = await findOrphanCadSeries();
    if (orphans.length > 0) {
      console.log(
        `\nSéries de clôtures orphelines à purger :\n` +
          orphans.map((o) => `   • ${o.ticker}|${o.currency}`).join("\n"),
      );
    }
    console.log("\n--dry-run : rien n'a été écrit.");
    return;
  }

  const window = await resolveAffectedWindow(mislisted);

  if (!gainsOnly) {
    console.log("\n1/5 · re-projection des holdings depuis les transactions…");
    const projection = await projectHoldingsFromTransactions();
    console.log(`   holdings projetés : ${projection.currentHoldingsProjected}`);
    console.log(`   lignes holdings journalières : ${projection.dailyRowsProjected}`);

    console.log("\n2/5 · purge des clôtures enregistrées sous une ancienne paire CAD…");
    const orphans = await findOrphanCadSeries();
    if (orphans.length === 0) {
      console.log("   rien à purger");
    }
    for (const pair of orphans) {
      const deleted = await prisma.portfolioDailyPrice.deleteMany({
        where: { ticker: pair.ticker, currency: pair.currency },
      });
      console.log(`   ${pair.ticker}|${pair.currency} : ${deleted.count} clôture(s) supprimée(s)`);
    }

    console.log("\n3/5 · historique USD→CAD…");
    await refreshUsdCadRatesIfStale();
  }

  if (!gainsOnly) {
    console.log("\n4/5 · backfill clôtures + valeurs + gains récents…");
    const result = await backfillMarketHistory({
      force: true,
      recomputeDailyValues: true,
      recomputeSessionGains: true,
      recomputeSessionGainsDays: 90,
      ensureDailyHoldings: true,
    });
    console.log(result.message ?? "");
    if (result.dailyValuesStats) {
      const s = result.dailyValuesStats;
      console.log(
        `Valeurs : ${result.dailyValuesUpserted} lignes | ${s.carriedForwardPositions} report(s) | ${s.unpricedPositions} sans prix`,
      );
      for (const sample of s.unpricedSamples.slice(0, 5)) {
        console.log(`   • sans prix : ${sample.ticker}|${sample.currency} @ ${sample.date}`);
      }
    }
    if (result.priceGaps) {
      console.log(
        `Trous restants : ${result.priceGaps.missingSessions} séance(s) sur ${result.priceGaps.heldSessionsChecked}`,
      );
      for (const gap of result.priceGaps.pairsWithGaps.slice(0, 5)) {
        console.log(
          `   • ${gap.ticker}|${gap.currency} : ${gap.missingSessions}/${gap.heldSessions}`,
        );
      }
    }
  }

  if (window.from && window.to) {
    console.log(
      `\n5/5 · gains de séance ${window.from} → ${window.to} (fenêtre corrigée, par tranches)…`,
    );
    const accountKeys = (
      await prisma.portfolioAccountState.findMany({ select: { accountKey: true } })
    ).map((row) => row.accountKey);
    let cursor = window.from;
    let written = 0;
    const missingFx = new Set<string>();
    while (cursor <= window.to) {
      const chunkEnd =
        addDaysIso(cursor, 120) > window.to ? window.to : addDaysIso(cursor, 120);
      const chunk = await recomputeAndPersistSessionGains(accountKeys, cursor, chunkEnd);
      written += chunk.rowsWritten;
      for (const date of chunk.missingFxDates) missingFx.add(date);
      console.log(`   ${cursor} → ${chunkEnd} : ${chunk.rowsWritten} ligne(s)`);
      cursor = addDaysIso(chunkEnd, 1);
    }
    console.log(`   total : ${written} ligne(s)`);
    if (missingFx.size > 0) {
      console.log(
        `   ⚠️ ${missingFx.size} date(s) sans taux USD→CAD : ${[...missingFx].slice(0, 5).join(", ")}`,
      );
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
