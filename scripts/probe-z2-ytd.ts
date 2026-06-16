import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import { computePeriodResult, defaultPerformanceFilters } from "@/features/portfolio/performance-indicator-logic";

const AS_OF = "2026-06-15T14:07:00";
const KEY = "5KFZEZ2|CAD";

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;
  const cur = payload.currentByAccount[KEY];
  console.log("live pos", cur?.positionsCad, "total", cur?.totalCad);

  const r = computePeriodResult(
    payload,
    {
      ...defaultPerformanceFilters(payload),
      preset: "custom",
      includedAccountKeys: [KEY],
      excludedAccountKeys: [],
    },
    "ytd",
  );
  console.log("ytd", r.gainCad, r.gainPct, r.note);
}

main().catch(console.error);
