import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import { computePeriodResult, defaultPerformanceFilters } from "@/features/portfolio/performance-indicator-logic";

const fmt = (n: number) => n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  const filters = defaultPerformanceFilters(payload);
  const keys = payload.accounts.filter((a) => !a.isExternal).map((a) => a.accountKey);

  let sumDayGain = 0;
  let sumDayPrior = 0;
  for (const k of keys) {
    const c = payload.currentByAccount[k];
    if (!c) continue;
    sumDayGain += c.dayGainCad ?? 0;
    sumDayPrior += c.dayPriorCad ?? 0;
  }

  const prec = computePeriodResult(payload, filters, "yesterday");
  const day = computePeriodResult(payload, filters, "day");
  const month = computePeriodResult(payload, filters, "month");

  console.log("Σ dayGainCad (live positions):", fmt(sumDayGain));
  console.log("Σ dayPriorCad:", fmt(sumDayPrior));
  console.log("Préc.:", fmt(prec.gainCad ?? 0), prec.gainPct?.toFixed(2) + "%");
  console.log("Séance:", day.gainCad == null ? "—" : fmt(day.gainCad), day.gainPct?.toFixed(2) + "%");
  console.log("1 mois:", fmt(month.gainCad ?? 0), month.gainPct?.toFixed(2) + "%");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
