import type { PerformanceCashFlow } from "./performance-indicator-types";

const FLOW_CATEGORIES = new Set<PerformanceCashFlow["txCategory"]>([
  "CONTRIBUTION",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "INTERNAL_TRANSFER",
]);

/** Flux nets externes sur la période (positif = entrée de capitaux). */
export function netExternalFlowsCad(
  flows: PerformanceCashFlow[],
  accountKeys: string[],
  periodStart: string,
  periodEnd: string,
): number {
  const keySet = new Set(accountKeys);
  let net = 0;
  for (const f of flows) {
    if (!keySet.has(f.accountKey)) continue;
    if (!FLOW_CATEGORIES.has(f.txCategory)) continue;
    if (f.tradeDate < periodStart || f.tradeDate > periodEnd) continue;
    net += f.amountCad;
  }
  return net;
}

export function formatFlowAdjustmentNote(flowCad: number): string | null {
  if (!Number.isFinite(flowCad) || Math.abs(flowCad) < 0.01) return null;
  const abs = Math.abs(flowCad).toLocaleString("fr-CA", {
    maximumFractionDigits: 0,
  });
  if (flowCad > 0) {
    return `Ajusté des entrées de capitaux (~${abs} $) — dépôts et transferts exclus du gain.`;
  }
  return `Ajusté des retraits (~${abs} $) — sorties de capitaux exclus du gain.`;
}
