/**
 * Compare indicateurs Disnatia vs capture Disnat (rendements %).
 */
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computeAllPeriodResults,
  computePeriodResult,
  defaultPerformanceFilters,
} from "@/features/portfolio/performance-indicator-logic";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";

const fmtPct = (n: number | null) =>
  n == null ? "—" : `${n.toFixed(2).replace(".", ",")} %`;
const fmtCad = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("fr-CA", { maximumFractionDigits: 0 });

/** Capture Disnat (IDs 5KFZE / 5L3AP — titulaires Yann / Valérie). */
const DISNAT = {
  yann: {
    month: 6.51,
    month3: 12.05,
    year: 44.15,
    year3: 27.61,
    ytd: 13.49,
    all: 25.06,
  },
  valerie: {
    month: 6.41,
    month3: 11.82,
    year: 36.13,
    year3: null as number | null,
    ytd: 13.72,
    all: 27.8,
  },
} as const;

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  const allResults = computeAllPeriodResults(
    payload,
    defaultPerformanceFilters(payload),
  );

  const map = new Map(allResults.map((r) => [r.periodId, r]));

  console.log("=== TOUS COMPTES (Disnatia) ===");
  for (const id of ["day", "yesterday", "month", "month3", "year", "year3", "ytd", "all"] as const) {
    const r = map.get(id)!;
    console.log(
      id.padEnd(10),
      fmtCad(r.gainCad),
      fmtPct(r.gainPct),
      r.annualized ? "(an)" : "",
      "|",
      r.method,
    );
  }

  const owners = uniquePortfolioOwners(payload.accounts.map((a) => a.owner));
  for (const owner of owners) {
    const filters = { ...defaultPerformanceFilters(payload), owner };
    console.log(`\n=== ${owner} ===`);
    for (const [id, ref] of [
      ["month", owner.toLowerCase().includes("yann") ? DISNAT.yann.month : DISNAT.valerie.month],
      ["month3", owner.toLowerCase().includes("yann") ? DISNAT.yann.month3 : DISNAT.valerie.month3],
      ["year", owner.toLowerCase().includes("yann") ? DISNAT.yann.year : DISNAT.valerie.year],
      ["year3", owner.toLowerCase().includes("yann") ? DISNAT.yann.year3 : DISNAT.valerie.year3],
      ["ytd", owner.toLowerCase().includes("yann") ? DISNAT.yann.ytd : DISNAT.valerie.ytd],
      ["all", owner.toLowerCase().includes("yann") ? DISNAT.yann.all : DISNAT.valerie.all],
    ] as const) {
      const r = computePeriodResult(payload, filters, id);
      const refPct = ref as number | null;
      const delta =
        refPct != null && r.gainPct != null
          ? (r.gainPct - refPct).toFixed(2)
          : "—";
      console.log(
        id.padEnd(8),
        "app",
        fmtPct(r.gainPct),
        r.annualized ? "(an)" : "",
        "| Disnat",
        refPct == null ? "—" : `${refPct.toFixed(2).replace(".", ",")} %`,
        "| Δ",
        delta,
        "|",
        fmtCad(r.gainCad),
      );
    }
  }
}

main().catch(console.error);
