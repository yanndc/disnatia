/**
 * Compare les indicateurs de performance de l'app à un rapport Disnat figé (rendement par
 * client), en simulant `asOfNow` à la date du rapport pour forcer une reconstruction
 * historique cohérente (pas de cotations live).
 * Usage : npx tsx scripts/verify-disnat-report.ts
 */
import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computePeriodResultWithSnapshots,
  resolveActiveAccountKeys,
  titresCadAtOrBefore,
} from "@/features/portfolio/performance-indicator-logic";
import { cashCadAtOrBefore } from "@/features/portfolio/performance-cash-ledger";
import type {
  PerformanceFilterState,
  PerformancePeriodId,
} from "@/features/portfolio/performance-indicator-types";

const REPORT_DATE = "2026-07-31";
const AS_OF_NOW = `${REPORT_DATE}T15:00:00-04:00`;

const PERIODS: { id: PerformancePeriodId; label: string }[] = [
  { id: "month", label: "1 mois" },
  { id: "month3", label: "3 mois" },
  { id: "year", label: "1 an" },
  { id: "year3", label: "3 ans" },
  { id: "ytd", label: "Année à date" },
  { id: "all", label: "Depuis le début" },
];

const DISNAT_REF: Record<string, Partial<Record<PerformancePeriodId, number>>> = {
  "Yann de Champlain": {
    month: 0.73,
    month3: 8.45,
    year: 29.1,
    year3: 25.71,
    ytd: 15.44,
    all: 24.18,
  },
  "Valérie Degrandpré": {
    month: -0.93,
    month3: 7.17,
    year: 23.54,
    ytd: 14.21,
    all: 24.95,
    // year3: pas de donnée Disnat ("-")
  },
};

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  const payloadAtDate = { ...payload, asOfNow: AS_OF_NOW };
  console.log(`quotesAsOf (réel, aujourd'hui) = ${payload.quotesAsOf}`);
  console.log(`asOfNow simulé = ${AS_OF_NOW}\n`);

  for (const owner of Object.keys(DISNAT_REF)) {
    console.log(`\n=== ${owner} ===`);
    const accountKeys = resolveActiveAccountKeys(
      payload.accounts,
      "disnat",
      [],
      [],
      owner,
      null,
      payload.portfolioScopes ?? [],
    );
    console.log(`Comptes Disnat inclus: ${accountKeys.join(", ")}`);

    const filters: PerformanceFilterState = {
      preset: "disnat",
      owner,
      portfolioKey: null,
      includedAccountKeys: [],
      excludedAccountKeys: [],
      selectedYear: 2026,
      activePeriod: "month",
    };

    for (const { id, label } of PERIODS) {
      const result = computePeriodResultWithSnapshots(payloadAtDate, filters, id);
      const disnatPct = DISNAT_REF[owner]?.[id];
      const deltaPct =
        disnatPct != null && result.gainPct != null ? result.gainPct - disnatPct : null;
      console.log(
        `${label.padEnd(16)} app%=${result.gainPct?.toFixed(2).padStart(8) ?? "N/A".padStart(8)} ` +
          `disnat%=${disnatPct != null ? disnatPct.toFixed(2).padStart(8) : "N/A".padStart(8)} ` +
          `Δ=${deltaPct != null ? deltaPct.toFixed(2).padStart(7) : "N/A".padStart(7)} ` +
          `method=${result.method.padEnd(14)} gainCad=${result.gainCad?.toFixed(2) ?? "N/A"} ` +
          `baselineCad=${result.baselineCad?.toFixed(2) ?? "N/A"} baselineDate=${result.baselineDate ?? "N/A"} ` +
          `incomplete=${result.incomplete} note=${result.note ?? ""}`,
      );
    }
  }

  // Débogage ciblé : détail BMV/EMV/flux pour la période 3 mois de chaque personne.
  const month3Window: Record<string, [string, string]> = {
    "Yann de Champlain": ["2026-04-29", "2026-07-31"],
    "Valérie Degrandpré": ["2026-04-29", "2026-07-31"],
  };
  for (const owner of Object.keys(DISNAT_REF)) {
    console.log(`\n--- Détail 3 mois : ${owner} ---`);
    const accountKeys = resolveActiveAccountKeys(
      payload.accounts,
      "disnat",
      [],
      [],
      owner,
      null,
      payload.portfolioScopes ?? [],
    );
    const [baselineDate, endDate] = month3Window[owner]!;
    const bmv = titresCadAtOrBefore(accountKeys, payloadAtDate, baselineDate);
    const emv = titresCadAtOrBefore(accountKeys, payloadAtDate, endDate);
    console.log(`BMV @ ${baselineDate}:`, bmv);
    console.log(`EMV @ ${endDate}:`, emv);
    const flows = (payload.cashFlows ?? []).filter(
      (f) => accountKeys.includes(f.accountKey) && f.tradeDate >= baselineDate && f.tradeDate <= endDate,
    );
    console.log(`Flux dans la fenêtre (${flows.length}):`);
    for (const f of flows) {
      console.log(`  ${f.tradeDate} | ${f.accountKey} | ${f.amountCad.toFixed(2)} CAD`);
    }
    console.log(`Encaisse (ledger) par compte à ${baselineDate} et ${endDate}:`);
    for (const key of accountKeys) {
      const cashStart = cashCadAtOrBefore([key], payload.accountCashLedgers, baselineDate);
      const cashEnd = cashCadAtOrBefore([key], payload.accountCashLedgers, endDate);
      console.log(`  ${key}: début=${cashStart.toFixed(2)} CAD, fin=${cashEnd.toFixed(2)} CAD`);
    }
  }

  // Débogage ciblé : trace mensuelle de l'encaisse pour 5KFZEZ2|CAD (compte du test
  // performance-contributions-disnat.test.ts, Disnat YTD au 12 juin 2026 = -165.19 $).
  console.log(`\n--- Trace encaisse 5KFZEZ2|CAD (Disnat YTD @ 2026-06-12 = -165.19 $) ---`);
  const checkpoints = [
    "2025-12-31",
    "2026-01-15",
    "2026-02-01",
    "2026-03-01",
    "2026-04-01",
    "2026-04-29",
    "2026-05-01",
    "2026-05-26",
    "2026-06-03",
    "2026-06-12",
  ];
  for (const d of checkpoints) {
    const cash = cashCadAtOrBefore(["5KFZEZ2|CAD"], payload.accountCashLedgers, d);
    const titres = titresCadAtOrBefore(["5KFZEZ2|CAD"], payloadAtDate, d);
    console.log(
      `  ${d}: cash=${cash.toFixed(2).padStart(10)} CAD, titres=${titres?.valueCad.toFixed(2).padStart(10) ?? "N/A".padStart(10)} CAD`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
