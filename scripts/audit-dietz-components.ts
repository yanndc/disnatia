import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computeTitresPeriodGain,
  resolvePeriodBounds,
  titresCadAtOrBefore,
  titresCadFullCoverageAtOrBefore,
} from "@/features/portfolio/performance-indicator-logic";
import { netExternalFlowsCad } from "@/features/portfolio/performance-cash-flows";
import { computeModifiedDietzReturn } from "@/features/portfolio/performance-return-methods";

const TARGETS: Array<{ key: string; disnatYtd: number; disnatYear: number; disnatMonth3: number }> = [
  { key: "5KFZEZ2|CAD", disnatYtd: -165.19, disnatYear: 28_671.76, disnatMonth3: 435 },
  { key: "5L3APY0|CAD", disnatYtd: 315.52, disnatYear: 58_461.04, disnatMonth3: 48.02 },
];

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  const now = new Date(payload.asOfNow);

  for (const t of TARGETS) {
    console.log(`\n=== ${t.key} ===`);
    for (const period of ["month3", "ytd", "year"] as const) {
      const bounds = resolvePeriodBounds(period, now, 2026, "2022-03-23");
      const lookup =
        bounds.baselineLookup ??
        bounds.start;
      const titres = computeTitresPeriodGain([t.key], payload, bounds);
      const bmv = titresCadFullCoverageAtOrBefore([t.key], payload, lookup!);
      const emv = titresCadFullCoverageAtOrBefore([t.key], payload, bounds.end);
      const flows = netExternalFlowsCad(
        payload.cashFlows,
        [t.key],
        bounds.start!,
        bounds.end,
      );
      const dietz =
        bmv && emv
          ? computeModifiedDietzReturn(
              bmv.valueCad,
              emv.valueCad,
              flows,
              0,
              bounds.start!,
              bounds.end,
            )
          : null;
      const ref =
        period === "ytd"
          ? t.disnatYtd
          : period === "year"
            ? t.disnatYear
            : t.disnatMonth3;

      console.log(`\n  ${period} (${bounds.start} → ${bounds.end}, lookup ${lookup})`);
      console.log(`    BMV titres: ${bmv ? Math.round(bmv.valueCad) : "—"} @ ${bmv?.asOf}`);
      console.log(`    EMV titres: ${emv ? Math.round(emv.valueCad) : "—"} @ ${emv?.asOf}`);
      console.log(`    flux nets:  ${Math.round(flows)}`);
      console.log(
        `    EMV−BMV−flux: ${bmv && emv ? Math.round(emv.valueCad - bmv.valueCad - flows) : "—"}`,
      );
      console.log(
        `    titresGain:   $=${Math.round(titres.gainCad ?? 0)} ${titres.gainPct?.toFixed(2) ?? "—"}%`,
      );
      console.log(
        `    Dietz %:      ${dietz?.gainPct?.toFixed(2) ?? "—"}%`,
      );
      console.log(`    Disnat ref:   $=${ref} Δ=${titres.gainCad != null ? Math.round(titres.gainCad - ref) : "—"}`);
    }

    const ytdBounds = resolvePeriodBounds("ytd", now, 2026, "2022-03-23");
    const ytdFlows = payload.cashFlows.filter(
      (f) =>
        f.accountKey === t.key &&
        f.tradeDate >= ytdBounds.start! &&
        f.tradeDate <= ytdBounds.end,
    );
    if (ytdFlows.length > 0) {
      console.log("\n  Flux YTD:");
      for (const f of ytdFlows) {
        console.log(`    ${f.tradeDate} ${f.txCategory} ${Math.round(f.amountCad)}`);
      }
    }
  }
}

main().catch(console.error);
