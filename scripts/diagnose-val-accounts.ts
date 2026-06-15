import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import { computePeriodResult, defaultPerformanceFilters } from "@/features/portfolio/performance-indicator-logic";

const AS_OF = "2026-06-15T14:07:00";

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;
  payload.sessionDataHealth = {
    ok: true,
    message: null,
    persistedDays: 1100,
    firstDate: "2022-03-23",
    lastDate: "2026-06-12",
  };

  const valAccounts = payload.accounts.filter(
    (a) => (a.owner ?? "").toLowerCase().includes("valerie") && !a.isExternal,
  );
  console.log("Val accounts:", valAccounts.map((a) => a.accountKey));

  for (const acc of valAccounts) {
    for (const p of ["month", "ytd"] as const) {
      const r = computePeriodResult(
        payload,
        {
          ...defaultPerformanceFilters(payload),
          preset: "custom",
          includedAccountKeys: [acc.accountKey],
          excludedAccountKeys: [],
        },
        p,
      );
      console.log(
        acc.accountKey,
        p,
        "$",
        Math.round(r.gainCad ?? 0),
        r.gainPct?.toFixed(2) + "%",
        "pos",
        Math.round(payload.currentByAccount[acc.accountKey]?.positionsCad ?? 0),
      );
    }
  }

  const owner = valAccounts[0]?.owner ?? "";
  const r = computePeriodResult(
    payload,
    { ...defaultPerformanceFilters(payload), owner, preset: "disnat" },
    "ytd",
  );
  console.log("OWNER ytd", Math.round(r.gainCad ?? 0), r.gainPct?.toFixed(2) + "%");
}

main().catch(console.error);
