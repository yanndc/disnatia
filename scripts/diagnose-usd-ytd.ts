import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computePeriodResult,
  defaultPerformanceFilters,
  resolvePeriodBounds,
  titresCadFullCoverageAtOrBefore,
} from "@/features/portfolio/performance-indicator-logic";
import { netExternalFlowsCad } from "@/features/portfolio/performance-cash-flows";

const KEYS = ["5KFZEU3|USD", "5KFZET5|USD", "5KFZES7|USD", "5KFZEZ2|CAD"] as const;
const DISNAT: Record<string, number> = {
  "5KFZEU3|USD": 118.84,
  "5KFZET5|USD": 12.42,
  "5KFZES7|USD": 247.11,
  "5KFZEZ2|CAD": -165.19,
};
const AS_OF = "2026-06-12T15:00:00";

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;
  const bounds = resolvePeriodBounds("ytd", new Date(AS_OF), 2026, null);
  const lookup = bounds.baselineLookup!;

  for (const key of KEYS) {
    const r = computePeriodResult(
      payload,
      {
        ...defaultPerformanceFilters(payload),
        preset: "custom",
        includedAccountKeys: [key],
        excludedAccountKeys: [],
      },
      "ytd",
    );
    const bmvHist = titresCadFullCoverageAtOrBefore([key], payload, lookup);
    const emvHist = titresCadFullCoverageAtOrBefore([key], payload, bounds.end);
    const flows = netExternalFlowsCad(
      payload.cashFlows,
      [key],
      bounds.start!,
      bounds.end,
    );
  const snaps = (payload.snapshots ?? []).filter((s) => s.accountKey === key);
    const first2026 = snaps
      .filter((s) => s.asOf >= bounds.start!)
      .toSorted((a, b) => a.asOf.localeCompare(b.asOf))[0];

    console.log(`\n=== ${key} ===`);
    console.log(`hist BMV ${bmvHist?.valueCad.toFixed(0)} EMV ${emvHist?.valueCad.toFixed(0)} flux ${flows.toFixed(0)}`);
    console.log(`raw Δ ${((emvHist?.valueCad ?? 0) - (bmvHist?.valueCad ?? 0) - flows).toFixed(0)}`);
    console.log(`app $ ${Math.round(r.gainCad ?? 0)} pct ${r.gainPct?.toFixed(2)}% disnat ${DISNAT[key]}`);
    console.log(`1er import ${first2026?.asOf} market ${first2026?.marketValueNative} total ${first2026?.totalValueNative}`);
    const sessions = (payload.sessionGainsByAccount?.[key] ?? []).filter(
      (g) => g.date >= bounds.start!,
    );
    const sumSess = sessions.reduce((a, g) => a + g.gainCad, 0);
    const nativeRows = await prisma.portfolioDailyAccountSessionGain.findMany({
      where: {
        accountKey: key,
        sessionDate: {
          gte: new Date(bounds.start! + "T12:00:00"),
          lte: new Date(bounds.end + "T12:00:00"),
        },
      },
      select: { gainNative: true },
    });
    const sumNativeYtd = nativeRows.reduce((a, r) => a + r.gainNative, 0);
    const sinceImport = await prisma.portfolioDailyAccountSessionGain.findMany({
      where: {
        accountKey: key,
        sessionDate: {
          gte: new Date((first2026?.asOf ?? bounds.start!) + "T12:00:00"),
          lte: new Date(bounds.end + "T12:00:00"),
        },
      },
      select: { gainNative: true },
    });
    const sumSinceImport = sinceImport.reduce((a, r) => a + r.gainNative, 0);
    const spotCad =
      payload.usdToCad != null ? sumNativeYtd * payload.usdToCad : sumNativeYtd;
    const spotSince =
      payload.usdToCad != null
        ? sumSinceImport * payload.usdToCad
        : sumSinceImport;
    console.log(
      `Σ native YTD ${sumNativeYtd.toFixed(2)} (→${Math.round(spotCad)} CAD) | depuis import ${sumSinceImport.toFixed(2)} (→${Math.round(spotSince)} CAD)`,
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
