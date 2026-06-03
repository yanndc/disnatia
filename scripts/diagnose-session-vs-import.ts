import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import { normalizeCurrency } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });

function toCad(v: number, cur: string, fx: number | null) {
  return normalizeCurrency(cur) === "USD" && fx ? v * fx : v;
}

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  const fx = payload.usdToCad;
  const states = await prisma.portfolioAccountState.findMany();
  const keys = payload.accounts.filter((a) => !a.isExternal).map((a) => a.accountKey);

  let sumLiveDay = 0;
  let sumImportDelta = 0;
  console.log("Compte | P&L live (app) | Δ titres live − import.marketValue");
  for (const k of keys) {
    const cur = payload.currentByAccount[k];
    const st = states.find((s) => s.accountKey === k);
    if (!cur || !st) continue;
    const liveDay = cur.dayGainCad ?? 0;
    const importTitresCad = toCad(st.marketValue, st.currency, fx);
    const importDelta = cur.positionsCad - importTitresCad;
    sumLiveDay += liveDay;
    sumImportDelta += importDelta;
    if (cur.positionsCad > 0 || Math.abs(liveDay) > 1) {
      console.log(
        k.slice(0, 12),
        fmt(liveDay),
        fmt(importDelta),
        "| import asOf",
        st.asOf.toISOString().slice(0, 10),
      );
    }
  }
  console.log("Σ P&L live:", fmt(sumLiveDay));
  console.log("Σ live titres − import marketValue:", fmt(sumImportDelta));
  console.log("Disnat ref:", fmt(-1163));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
