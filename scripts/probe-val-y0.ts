import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  titresCadAtOrBefore,
  titresCadFullCoverageAtOrBefore,
} from "@/features/portfolio/performance-indicator-logic";

const AS_OF = "2026-06-15T14:07:00";
const KEY = "5L3APY0|CAD";

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  payload.asOfNow = AS_OF;
  const cur = payload.currentByAccount[KEY];
  console.log("live positionsCad", cur?.positionsCad);

  const end = "2026-06-15";
  console.log("fullCoverage end", titresCadFullCoverageAtOrBefore([KEY], payload, end));
  console.log("atOrBefore end", titresCadAtOrBefore([KEY], payload, end));

  const hist = [...(payload.historyPoints ?? []), ...(payload.snapshots ?? [])]
    .filter((p) => p.accountKey === KEY)
    .toSorted((a, b) => a.asOf.localeCompare(b.asOf))
    .slice(-8);
  for (const p of hist) {
    const native = "marketValueNative" in p ? (p.marketValueNative ?? p.totalValueNative) : p.totalValueNative;
    console.log(p.asOf, "native", native, "from", "marketValueNative" in p ? "snap" : "hist");
  }
}

main().catch(console.error);
