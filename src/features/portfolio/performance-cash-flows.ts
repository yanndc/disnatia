import { isoDateInToronto } from "@/lib/market/equity-session";
import type { PerformanceCashFlow } from "./performance-indicator-types";
import { daysBetweenIso } from "./performance-money-weighted";

const FLOW_CATEGORIES = new Set<PerformanceCashFlow["txCategory"]>([
  "CONTRIBUTION",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "INTERNAL_TRANSFER",
]);

/** Réimportations : trade vs settlement décalés d'au plus 1 jour calendaire. */
const NEAR_DUPLICATE_FLOW_DAYS = 1;
/** Sous ce montant, les cotisations récurrentes ne fusionnent pas sur jours adjacents (comptes actifs). */
const NEAR_DUPLICATE_MIN_CAD_DEFAULT = 500;
const NEAR_DUPLICATE_MIN_CAD_SPARSE = 400;
/** Comptes avec peu de flux : fusionner aussi les 400 $ réimportés à J±1. */
const SPARSE_ACCOUNT_FLOW_COUNT = 15;
/** Comptes très actifs : ne garder que la dédup. par fingerprint (cotisations récurrentes). */
const DENSE_ACCOUNT_FLOW_COUNT = 50;

export type RawFlowTransaction = {
  accountKey: string | null;
  tradeDate: Date | null;
  settlementDate: Date | null;
  transactionType?: string | null;
  txCategory: string | null;
  amount: number | null;
  currency: string | null;
  quantity?: number | null;
  ticker?: string | null;
  fingerprint?: string | null;
  importId?: string | null;
};

/** Date effective d'un flux : tradeDate, sinon date de règlement (exports Disnat). */
export function resolveFlowEffectiveDate(
  tradeDate: Date | null | undefined,
  settlementDate: Date | null | undefined,
): Date | null {
  return tradeDate ?? settlementDate ?? null;
}

function toCad(amount: number, currency: string, usdToCad: number | null): number {
  if (currency.toUpperCase() === "USD" && usdToCad != null && usdToCad > 0) {
    return amount * usdToCad;
  }
  return amount;
}

function flowAmountKey(flow: PerformanceCashFlow): string {
  return `${flow.accountKey}|${flow.txCategory}|${Math.round(flow.amountCad * 100)}`;
}

/** Supprime les réimportations : même compte, catégorie et montant à quelques jours d'écart. */
export function dedupeNearDuplicateFlows(
  flows: PerformanceCashFlow[],
  minCadByAccount?: Record<string, number>,
): PerformanceCashFlow[] {
  const sorted = [...flows].toSorted((a, b) =>
    a.tradeDate.localeCompare(b.tradeDate),
  );
  const kept: PerformanceCashFlow[] = [];

  for (const flow of sorted) {
    const amountKey = flowAmountKey(flow);
    const minCad =
      minCadByAccount?.[flow.accountKey] ?? NEAR_DUPLICATE_MIN_CAD_DEFAULT;
    const isNearDup = kept.some((existing) => {
      if (flowAmountKey(existing) !== amountKey) return false;
      const daysApart = Math.abs(
        daysBetweenIso(existing.tradeDate, flow.tradeDate),
      );
      if (daysApart > NEAR_DUPLICATE_FLOW_DAYS) return false;
      // Doublon strict (même jour) : toujours éliminer, même pour les montants < minCad.
      if (daysApart === 0) return true;
      return Math.abs(flow.amountCad) >= minCad;
    });
    if (isNearDup) continue;
    kept.push(flow);
  }

  return kept;
}

/** Construit les flux performance à partir des lignes transaction (cotisations / transferts). */
export function buildPerformanceCashFlowsFromTxRows(
  rows: RawFlowTransaction[],
  usdToCad: number | null,
): PerformanceCashFlow[] {
  const rawCountByAccount = new Map<string, number>();
  for (const tx of rows) {
    if (!tx.accountKey || !tx.txCategory) continue;
    if (!FLOW_CATEGORIES.has(tx.txCategory as PerformanceCashFlow["txCategory"])) {
      continue;
    }
    rawCountByAccount.set(
      tx.accountKey,
      (rawCountByAccount.get(tx.accountKey) ?? 0) + 1,
    );
  }

  const out: PerformanceCashFlow[] = [];
  const seenExact = new Set<string>();
  const seenFingerprint = new Set<string>();

  for (const tx of rows) {
    if (!tx.accountKey || !tx.txCategory) continue;
    if (!FLOW_CATEGORIES.has(tx.txCategory as PerformanceCashFlow["txCategory"])) {
      continue;
    }
    const effective = resolveFlowEffectiveDate(tx.tradeDate, tx.settlementDate);
    if (!effective) continue;
    const amount = tx.amount;
    if (amount === null || !Number.isFinite(amount) || Math.abs(amount) < 0.01) {
      continue;
    }

    if (tx.fingerprint) {
      if (seenFingerprint.has(tx.fingerprint)) continue;
      seenFingerprint.add(tx.fingerprint);
    }

    const isDense =
      (rawCountByAccount.get(tx.accountKey) ?? 0) > DENSE_ACCOUNT_FLOW_COUNT;
    if (!isDense) {
      const exactKey = [
        tx.accountKey,
        isoDateInToronto(effective),
        tx.txCategory,
        Math.round(amount * 100),
      ].join("|");
      if (seenExact.has(exactKey)) continue;
      seenExact.add(exactKey);
    }

    out.push({
      accountKey: tx.accountKey,
      tradeDate: isoDateInToronto(effective),
      txCategory: tx.txCategory as PerformanceCashFlow["txCategory"],
      amountCad: toCad(amount, tx.currency ?? "CAD", usdToCad),
    });
  }

  const minCadByAccount: Record<string, number> = {};
  for (const [key, rawCount] of rawCountByAccount) {
    if (rawCount > DENSE_ACCOUNT_FLOW_COUNT) continue;
    minCadByAccount[key] =
      rawCount <= SPARSE_ACCOUNT_FLOW_COUNT
        ? NEAR_DUPLICATE_MIN_CAD_SPARSE
        : NEAR_DUPLICATE_MIN_CAD_DEFAULT;
  }

  const denseKeys = new Set(
    [...rawCountByAccount.entries()]
      .filter(([, c]) => c > DENSE_ACCOUNT_FLOW_COUNT)
      .map(([k]) => k),
  );
  const denseOut = out.filter((f) => denseKeys.has(f.accountKey));
  const sparseOut = out.filter((f) => !denseKeys.has(f.accountKey));
  const dedupedDense = dedupeNearDuplicateFlows(denseOut, minCadByAccount);
  const dedupedSparse = dedupeNearDuplicateFlows(sparseOut, minCadByAccount);
  return [...dedupedDense, ...dedupedSparse];
}

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
