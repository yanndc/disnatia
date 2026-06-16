import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  resolvePeriodBounds,
  titresCadFullCoverageAtOrBefore,
  aggregateBmvTitresCad,
} from "@/features/portfolio/performance-indicator-logic";
import {
  resolvePeriodReturnPercent,
  computeTwrFromSessions,
} from "@/features/portfolio/performance-return-methods";

const AS_OF = "2026-06-15T14:07:00";

function weightedReturn(
  rows: { pct: number | null; weight: number }[],
): number | null {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    if (r.pct == null || r.weight <= 0) continue;
    num += r.pct * r.weight;
    den += r.weight;
  }
  return den > 0 ? num / den : null;
}

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;

  for (const periodId of ["month", "month3", "ytd"] as const) {
    const bounds = resolvePeriodBounds(periodId, new Date(AS_OF), 2026, null);
    const lookup = bounds.baselineLookup!;
    const keys = ["5L3APU9|USD", "5L3APY0|CAD"];
    const rows: { key: string; pct: number | null; weight: number }[] = [];

    for (const key of keys) {
      const sessions = (payload.sessionGainsByAccount?.[key] ?? []).filter(
        (g) => g.date >= bounds.start! && g.date <= bounds.end,
      );
      const bmv =
        titresCadFullCoverageAtOrBefore([key], payload, lookup)?.valueCad ??
        sessions[0]?.priorCad ??
        0;
      const emv =
        titresCadFullCoverageAtOrBefore([key], payload, bounds.end)?.valueCad ??
        0;
      const twr = computeTwrFromSessions(sessions, bounds.end, bounds.start!);
      const dietz = resolvePeriodReturnPercent({
        sessions,
        periodStart: bounds.start!,
        periodEnd: bounds.end,
        bmv,
        emv,
        boundaryCoverageComplete: bmv > 0 && emv > 0,
        flows: payload.cashFlows,
        accountKeys: [key],
      });
      rows.push({ key, pct: twr.gainPct, weight: bmv });
      console.log(
        periodId,
        key,
        `twr=${twr.gainPct?.toFixed(2)}% dietz=${dietz.gainPct?.toFixed(2)}% w=${Math.round(bmv)}`,
      );
    }

    const aggSessions = keys.flatMap(
      (k) =>
        (payload.sessionGainsByAccount?.[k] ?? []).filter(
          (g) => g.date >= bounds.start! && g.date <= bounds.end,
        ),
    );
    // wrong aggregate - sum by date
    const byDate = new Map<string, { gain: number; prior: number }>();
    for (const key of keys) {
      for (const g of payload.sessionGainsByAccount?.[key] ?? []) {
        if (g.date < bounds.start! || g.date > bounds.end) continue;
        const b = byDate.get(g.date) ?? { gain: 0, prior: 0 };
        b.gain += g.gainCad;
        b.prior += g.priorCad;
        byDate.set(g.date, b);
      }
    }
    const agg = [...byDate.entries()]
      .map(([date, v]) => ({ date, gainCad: v.gain, priorCad: v.prior }))
      .toSorted((a, b) => a.date.localeCompare(b.date));
    const aggTwr = computeTwrFromSessions(agg, bounds.end, bounds.start!);

    console.log(
      periodId,
      "weighted TWR",
      weightedReturn(rows.map((r) => ({ pct: r.pct, weight: r.weight })))?.toFixed(2),
      "agg TWR",
      aggTwr.gainPct?.toFixed(2),
      "ref",
      periodId === "month" ? "6.41" : periodId === "month3" ? "11.82" : "13.72",
    );
    console.log("");
  }
}

main().catch(console.error);
