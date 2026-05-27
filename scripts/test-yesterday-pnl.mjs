import { fetchYahooChartDailyCloses } from "../src/lib/market/yahoo-chart-closes.ts";
import { backfillDailyClosesForPairs } from "../src/features/portfolio/daily-close-prices.ts";
import { getPerformanceIndicatorPayload } from "../src/features/portfolio/performance-indicator-queries.ts";
import {
  computeAllPeriodResults,
  defaultPerformanceFilters,
} from "../src/features/portfolio/performance-indicator-logic.ts";

const holdings = [{ ticker: "SPY", currency: "USD" }];
await backfillDailyClosesForPairs(
  holdings.map((h) => ({ ...h, yahooSymbol: "SPY" })),
);
const chart = await fetchYahooChartDailyCloses("SPY");
console.log("SPY last closes:", chart.slice(-3));

const payload = await getPerformanceIndicatorPayload();
const filters = defaultPerformanceFilters(payload);
const results = computeAllPeriodResults(payload, filters);
for (const r of results) {
  console.log(
    r.periodId.padEnd(10),
    r.gainCad?.toFixed(2) ?? "null",
    r.method,
  );
}
