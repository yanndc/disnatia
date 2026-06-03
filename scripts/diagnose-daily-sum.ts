import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computeTitresPeriodGain,
  titresCadAtOrBefore,
} from "@/features/portfolio/performance-indicator-logic";
import { previousTradingDayIso } from "@/lib/market/equity-session";

const fmt = (n: number) => n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  const keys = payload.accounts.filter((a) => !a.isExternal).map((a) => a.accountKey);
  const sessions = [
    ...new Set(
      (payload.historyPoints ?? []).map((p) => p.asOf).filter((d) => d >= "2026-05-02" && d <= "2026-06-02"),
    ),
  ].sort();
  // trading days from session gains
  const days = (payload.sessionGainsByDate ?? [])
    .map((g) => g.date)
    .filter((d) => d >= "2026-05-02" && d <= "2026-06-02");

  let sumDaily = 0;
  for (const d of days) {
    const prior = previousTradingDayIso(d, 1);
    const c = computeTitresPeriodGain(keys, payload, {
      start: d,
      end: d,
      baselineLookup: prior,
    });
    sumDaily += c.gainCad ?? 0;
  }

  const month = computeTitresPeriodGain(keys, payload, {
    start: "2026-05-02",
    end: "2026-06-02",
    baselineLookup: "2026-05-01",
  });

  console.log("Σ gains journaliers (Préc. chaque séance):", fmt(sumDaily), "| jours:", days.length);
  console.log("Gain 1 mois direct:", fmt(month.gainCad ?? 0));
  console.log("Écart:", fmt((month.gainCad ?? 0) - sumDaily));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
