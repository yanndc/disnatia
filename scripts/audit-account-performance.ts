import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computePeriodResult,
  computeTitresPeriodGain,
  defaultPerformanceFilters,
  resolvePeriodBounds,
  sumSessionGainsInRange,
} from "@/features/portfolio/performance-indicator-logic";
import { isoDateFromDbDate } from "@/features/portfolio/daily-close-key";
import { resolvePeriodReturnPercent } from "@/features/portfolio/performance-return-methods";

const ACCOUNTS = ["5KFZEZ2|CAD", "5L3APY0|CAD"] as const;

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  const filters = {
    ...defaultPerformanceFilters(payload),
    preset: "custom" as const,
    includedAccountKeys: [...ACCOUNTS],
    excludedAccountKeys: [],
  };

  for (const accountKey of ACCOUNTS) {
    const accFilters = {
      ...filters,
      includedAccountKeys: [accountKey],
    };
    console.log(`\n${"=".repeat(70)}`);
    console.log(`COMPTE ${accountKey}`);
    console.log("=".repeat(70));

    const state = await prisma.portfolioAccountState.findFirst({
      where: { accountKey },
      select: {
        accountType: true,
        marketValue: true,
        cashValue: true,
        totalValue: true,
        asOf: true,
      },
    });
    console.log("État:", state);

    const [txCount, holdingDays, sessionDays, flows] = await Promise.all([
      prisma.portfolioTransactionLine.count({ where: { accountKey } }),
      prisma.portfolioDailyHolding.count({
        where: { accountKey, quantity: { gt: 0 } },
      }),
      prisma.portfolioDailyAccountSessionGain.count({ where: { accountKey } }),
      prisma.portfolioTransactionLine.findMany({
        where: {
          accountKey,
          txCategory: {
            in: ["CONTRIBUTION", "TRANSFER_IN", "TRANSFER_OUT", "INTERNAL_TRANSFER"],
          },
        },
        select: {
          tradeDate: true,
          settlementDate: true,
          txCategory: true,
          amount: true,
          transactionType: true,
        },
        orderBy: { settlementDate: "asc" },
      }),
    ]);
    console.log(
      `tx=${txCount} | holding_days=${holdingDays} | session_days=${sessionDays} | flux=${flows.length}`,
    );

    const firstSession = await prisma.portfolioDailyAccountSessionGain.findFirst({
      where: { accountKey },
      orderBy: { sessionDate: "asc" },
    });
    const lastSession = await prisma.portfolioDailyAccountSessionGain.findFirst({
      where: { accountKey },
      orderBy: { sessionDate: "desc" },
    });
    if (firstSession) {
      console.log(
        `Sessions: ${isoDateFromDbDate(firstSession.sessionDate)} → ${isoDateFromDbDate(lastSession!.sessionDate)}`,
      );
      console.log(
        `  1re: prior=${firstSession.priorNative} gain=${firstSession.gainNative}`,
      );
    }

    const periods = ["month3", "ytd", "year", "year3", "all"] as const;
    console.log("\nIndicateurs affichés:");
    for (const p of periods) {
      const r = computePeriodResult(payload, accFilters, p);
      console.log(
        `  ${p.padEnd(7)} $=${Math.round(r.gainCad ?? 0)} ${r.gainPct?.toFixed(2) ?? "—"}% | baseline=${Math.round(r.baselineCad ?? 0)} | method=${r.method} | ${r.note ?? ""}`,
      );
    }

    for (const p of ["ytd", "year", "month3"] as const) {
      const bounds = resolvePeriodBounds(
        p,
        new Date(payload.asOfNow),
        filters.selectedYear,
        "2022-03-23",
      );
      const titres = computeTitresPeriodGain([accountKey], payload, bounds);
      const shown = computePeriodResult(payload, accFilters, p);
      console.log(`\n${p.toUpperCase()} — 2 méthodes $:`);
      console.log(
        `  affiché (Σ séances): $=${Math.round(shown.gainCad ?? 0)} ${shown.gainPct?.toFixed(2) ?? "—"}%`,
      );
      console.log(
        `  titres Δ−flux (Disnat): $=${Math.round(titres.gainCad ?? 0)} ${titres.gainPct?.toFixed(2) ?? "—"}% incomplete=${titres.incomplete}`,
      );
    }

    for (const p of ["ytd", "year"] as const) {
      const bounds = resolvePeriodBounds(
        p,
        new Date(payload.asOfNow),
        filters.selectedYear,
        "2022-03-23",
      );
      const scoped = (payload.sessionGainsByAccount[accountKey] ?? []).filter(
        (g) => g.date >= (bounds.start ?? "") && g.date <= bounds.end,
      );
      const manual = bounds.start
        ? sumSessionGainsInRange(scoped, bounds.start, bounds.end)
        : null;
      const sumGain = scoped.reduce((s, g) => s + g.gainCad, 0);
      const sumPrior = scoped.reduce((s, g) => s + g.priorCad, 0);
      const twr = resolvePeriodReturnPercent({
        sessions: scoped,
        periodStart: bounds.start ?? "",
        periodEnd: bounds.end,
        bmv: null,
        emv: null,
        flows: payload.cashFlows,
        accountKeys: [accountKey],
      });
      console.log(`\n${p.toUpperCase()} détail (${bounds.start} → ${bounds.end}):`);
      console.log(`  séances compte: ${scoped.length}`);
      console.log(`  Σ gain (brut): ${Math.round(sumGain)}`);
      console.log(`  Σ prior (brut): ${Math.round(sumPrior)}`);
      console.log(`  sumSessionGainsInRange: ${manual ? Math.round(manual.gainCad) : "—"}`);
      console.log(
        `  TWR: ${twr.gainPct?.toFixed(2) ?? "—"}% algo=${twr.algorithm} annualized=${twr.annualized}`,
      );
    }

    // Gains journaliers extrêmes
    const extreme = await prisma.portfolioDailyAccountSessionGain.findMany({
      where: { accountKey },
      orderBy: { gainNative: "desc" },
      take: 3,
      select: { sessionDate: true, gainNative: true, priorNative: true },
    });
    console.log("\nTop gains journaliers:");
    for (const s of extreme) {
      const pct =
        s.priorNative > 0 ? ((s.gainNative / s.priorNative) * 100).toFixed(1) : "—";
      console.log(
        `  ${isoDateFromDbDate(s.sessionDate)} gain=${Math.round(s.gainNative)} prior=${Math.round(s.priorNative)} (${pct}%)`,
      );
    }

    const tinyPrior = await prisma.portfolioDailyAccountSessionGain.findMany({
      where: { accountKey, priorNative: { lt: 500, gt: 0 } },
      orderBy: { sessionDate: "asc" },
      take: 5,
      select: { sessionDate: true, gainNative: true, priorNative: true },
    });
    if (tinyPrior.length > 0) {
      console.log("\nSéances prior < 500$ (TWR explosif?):");
      for (const s of tinyPrior) {
        console.log(
          `  ${isoDateFromDbDate(s.sessionDate)} gain=${Math.round(s.gainNative)} prior=${Math.round(s.priorNative)}`,
        );
      }
    }

    // Valeur marché reconstruite vs session
    const holdings = await prisma.portfolioDailyHolding.findMany({
      where: { accountKey, quantity: { gt: 0 } },
      orderBy: { holdingDate: "asc" },
      take: 1,
      select: { holdingDate: true, ticker: true, quantity: true },
    });
    const holdingsLast = await prisma.portfolioDailyHolding.findMany({
      where: { accountKey, quantity: { gt: 0 } },
      orderBy: { holdingDate: "desc" },
      take: 3,
      select: { holdingDate: true, ticker: true, quantity: true },
    });
    console.log("\nHoldings:", holdings[0], "…", holdingsLast);

    if (flows.length > 0) {
      console.log("\nFlux externes (échantillon):");
      for (const f of flows.slice(0, 8)) {
        const d = f.settlementDate ?? f.tradeDate;
        console.log(
          `  ${d?.toISOString().slice(0, 10) ?? "?"} ${f.txCategory} ${f.transactionType} ${f.amount}`,
        );
      }
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
