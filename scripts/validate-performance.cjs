/**
 * Validation manuelle post-déploiement : compare P&L calculé vs somme des séances DB.
 * Usage: NODE_ENV=development node scripts/validate-performance.cjs
 */
const { spawnSync } = require("node:child_process");

const script = `
import { getPerformanceIndicatorPayload } from "../src/features/portfolio/performance-indicator-queries.ts";
import {
  computeAllPeriodResults,
  defaultPerformanceFilters,
  resolvePeriodBounds,
  sumSessionGainsInRange,
} from "../src/features/portfolio/performance-indicator-logic.ts";

const payload = await getPerformanceIndicatorPayload();
const filters = defaultPerformanceFilters(payload);
filters.preset = "disnat";
const now = payload.asOfNow;
const results = computeAllPeriodResults(payload, filters);

console.log("=== Validation performance Disnat ===");
console.log("asOfNow:", now, "| sessions chargées:", payload.sessionGainsByDate.length);

for (const r of results) {
  const b = resolvePeriodBounds(r.periodId, new Date(now + "T15:00:00"), filters.selectedYear, "2022-03-23");
  const manual =
    r.periodId === "day" || !b.start
      ? null
      : sumSessionGainsInRange(payload.sessionGainsByDate, b.start, b.end);
  console.log({
    periode: r.periodId,
    affiche: Math.round(r.gainCad ?? 0),
    manuel: manual ? Math.round(manual.gainCad) : null,
    delta: manual && r.gainCad != null ? Math.round(r.gainCad - manual.gainCad) : null,
    method: r.method,
    partial: r.incomplete,
  });
}
`;

const r = spawnSync("npx", ["tsx", "-e", script], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NODE_ENV: "development" },
});
process.exit(r.status ?? 1);
