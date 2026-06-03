/**
 * Décomposition gain période par compte (BD).
 */
import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  titresCadAtOrBefore,
  resolvePeriodBounds,
} from "@/features/portfolio/performance-indicator-logic";
import { netExternalFlowsCad } from "@/features/portfolio/performance-cash-flows";
import { isoDateInToronto } from "@/lib/market/equity-session";

const fmt = (n: number) =>
  n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });

async function breakdown(period: "month" | "month3" | "year") {
  const now = new Date();
  const payload = await getPerformanceIndicatorPayload();
  const bounds = resolvePeriodBounds(period, now, 2026, null);
  const keys = payload.accounts.filter((a) => !a.isExternal).map((a) => a.accountKey);
  const lookup = bounds.baselineLookup ?? bounds.start!;
  const endLive = keys.reduce(
    (s, k) => s + (payload.currentByAccount[k]?.positionsCad ?? 0),
    0,
  );

  console.log(`\n========== ${period} | start=${bounds.start} baseline=${lookup} end=${bounds.end} ========`);

  let sumStart = 0;
  let sumEndHist = 0;
  let sumFlows = 0;
  const rows: {
    key: string;
    start: number;
    startAsOf: string;
    end: number;
    endAsOf: string;
    flows: number;
    gain: number;
  }[] = [];

  for (const k of keys) {
    const sh = titresCadAtOrBefore([k], payload, lookup);
    const eh = titresCadAtOrBefore([k], payload, bounds.end);
    const live = payload.currentByAccount[k]?.positionsCad ?? 0;
    const flows = netExternalFlowsCad(payload.cashFlows, [k], bounds.start!, bounds.end);
    const start = sh?.valueCad ?? 0;
    const end = bounds.end === isoDateInToronto(now) && live > 0 ? live : (eh?.valueCad ?? live);
    const gain = end - start - flows;
    sumStart += start;
    sumEndHist += end;
    sumFlows += flows;
    rows.push({
      key: k,
      start,
      startAsOf: sh?.asOf ?? "—",
      end,
      endAsOf: eh?.asOf ?? (live > 0 ? "live" : "—"),
      flows,
      gain,
    });
  }

  rows.sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain));
  console.log("Par compte (tri |gain|):");
  for (const r of rows) {
    const stale = r.startAsOf < lookup ? " STALE" : "";
    console.log(
      `  ${r.key}${stale}`,
      `| début ${fmt(r.start)} (${r.startAsOf})`,
      `| fin ${fmt(r.end)} (${r.endAsOf})`,
      `| flux ${fmt(r.flows)}`,
      `| gain ${fmt(r.gain)}`,
    );
  }
  const totalGain = sumEndHist - sumStart - sumFlows;
  console.log("Σ début:", fmt(sumStart), "| Σ fin:", fmt(sumEndHist), "| Σ flux:", fmt(sumFlows));
  console.log("Gain recomposé:", fmt(totalGain));
}

async function main() {
  await breakdown("month");
  await breakdown("month3");
  await breakdown("year");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
