import type {
  PerformanceCashFlow,
  PerformanceSessionGain,
  PerformancePeriodId,
} from "./performance-indicator-types";
import { daysBetweenIso } from "./performance-money-weighted";

/** Seuil au-delà duquel le rendement cumulé est annualisé (comme Desjardins). */
const ANNUALIZE_MIN_SPAN_DAYS = 366;

const FLOW_CATEGORIES = new Set<PerformanceCashFlow["txCategory"]>([
  "CONTRIBUTION",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "INTERNAL_TRANSFER",
]);

export type PeriodReturnAlgorithm = "session-single" | "modified-dietz" | "twr";

export type PeriodReturnPercent = {
  gainPct: number | null;
  baselineCad: number | null;
  annualized: boolean;
  algorithm: PeriodReturnAlgorithm;
};

export function annualizeReturnDecimal(
  cumulative: number,
  spanDays: number,
): { pct: number; annualized: boolean } {
  const annualized = spanDays > ANNUALIZE_MIN_SPAN_DAYS && cumulative > -1;
  const pct = annualized
    ? (Math.pow(1 + cumulative, 365 / spanDays) - 1) * 100
    : cumulative * 100;
  return { pct, annualized };
}

/** TWR : ∏(1 + gain_j / prior_j) − 1 sur les séances de la période. */
export function computeTwrFromSessions(
  sessions: PerformanceSessionGain[],
  periodEndIso: string,
  /** Borne basse pour l'annualisation (période demandée, pas 1re séance mesurée). */
  periodStartIso?: string,
): PeriodReturnPercent {
  if (sessions.length === 0) {
    return {
      gainPct: null,
      baselineCad: null,
      annualized: false,
      algorithm: "twr",
    };
  }

  if (sessions.length === 1) {
    const s = sessions[0]!;
    if (s.priorCad > 0 && Number.isFinite(s.gainCad)) {
      return {
        gainPct: (s.gainCad / s.priorCad) * 100,
        baselineCad: s.priorCad,
        annualized: false,
        algorithm: "session-single",
      };
    }
  }

  let product = 1;
  let used = 0;
  for (const s of sessions) {
    if (s.priorCad > 0 && Number.isFinite(s.gainCad)) {
      product *= 1 + s.gainCad / s.priorCad;
      used++;
    }
  }
  if (used === 0) {
    return {
      gainPct: null,
      baselineCad: null,
      annualized: false,
      algorithm: "twr",
    };
  }

  const cumulative = product - 1;
  const spanStart = periodStartIso ?? sessions[0]!.date;
  const spanDays = Math.max(1, daysBetweenIso(spanStart, periodEndIso));
  const { pct, annualized } = annualizeReturnDecimal(cumulative, spanDays);
  const avgPrior =
    sessions.reduce((sum, s) => sum + (s.priorCad > 0 ? s.priorCad : 0), 0) /
    used;

  return {
    gainPct: pct,
    baselineCad: avgPrior > 0 ? avgPrior : null,
    annualized,
    algorithm: "twr",
  };
}

/** Flux externes pondérés pour Modified Dietz (poids = fraction de période restante). */
export function weightedExternalFlowsForDietz(
  flows: PerformanceCashFlow[],
  accountKeys: string[],
  periodStart: string,
  periodEnd: string,
): { sumFlows: number; weightedFlows: number } {
  const keySet = new Set(accountKeys);
  const spanDays = Math.max(1, daysBetweenIso(periodStart, periodEnd));
  let sumFlows = 0;
  let weightedFlows = 0;

  for (const f of flows) {
    if (!keySet.has(f.accountKey)) continue;
    if (!FLOW_CATEGORIES.has(f.txCategory)) continue;
    if (f.tradeDate < periodStart || f.tradeDate > periodEnd) continue;
    sumFlows += f.amountCad;
    const weight = daysBetweenIso(f.tradeDate, periodEnd) / spanDays;
    weightedFlows += weight * f.amountCad;
  }

  return { sumFlows, weightedFlows };
}

/**
 * Modified Dietz : (EMV − BMV − ΣCF) / (BMV + Σ w_i × CF_i).
 * Aligné sur les écrans Disnat (rendement ajusté des apports/retraits).
 */
export function computeModifiedDietzReturn(
  bmv: number,
  emv: number,
  sumFlows: number,
  weightedFlows: number,
  periodStart: string,
  periodEnd: string,
): PeriodReturnPercent {
  const denominator = bmv + weightedFlows;
  if (!(denominator > 0) || !Number.isFinite(emv) || !Number.isFinite(bmv)) {
    return {
      gainPct: null,
      baselineCad: null,
      annualized: false,
      algorithm: "modified-dietz",
    };
  }

  const numerator = emv - bmv - sumFlows;
  const cumulative = numerator / denominator;
  const spanDays = Math.max(1, daysBetweenIso(periodStart, periodEnd));
  const { pct, annualized } = annualizeReturnDecimal(cumulative, spanDays);

  return {
    gainPct: pct,
    baselineCad: denominator,
    annualized,
    algorithm: "modified-dietz",
  };
}

/**
 * Résout le % de période : Dietz (Disnat) si BMV/EMV couvrent tous les comptes,
 * sinon TWR sur la chaîne de séances. « 1 mois » = TWR (comme Disnat).
 */
export function resolvePeriodReturnPercent(params: {
  sessions: PerformanceSessionGain[];
  periodStart: string;
  periodEnd: string;
  bmv: number | null;
  emv: number | null;
  /** false si au moins un compte titres manque à BMV ou EMV. */
  boundaryCoverageComplete?: boolean;
  flows: PerformanceCashFlow[];
  accountKeys: string[];
  periodId?: PerformancePeriodId;
}): PeriodReturnPercent {
  if (params.periodId === "month") {
    const twr = computeTwrFromSessions(
      params.sessions,
      params.periodEnd,
      params.periodStart,
    );
    if (twr.gainPct != null) return twr;
  }

  if (params.sessions.length === 1) {
    const single = computeTwrFromSessions(
      params.sessions,
      params.periodEnd,
      params.periodStart,
    );
    if (single.gainPct != null) return single;
  }

  if (
    params.boundaryCoverageComplete !== false &&
    params.bmv != null &&
    params.emv != null &&
    params.bmv > 0
  ) {
    const bmv = params.bmv;
    const emv = params.emv;
    const { sumFlows, weightedFlows } = weightedExternalFlowsForDietz(
      params.flows,
      params.accountKeys,
      params.periodStart,
      params.periodEnd,
    );
    const dietz = computeModifiedDietzReturn(
      bmv,
      emv,
      sumFlows,
      weightedFlows,
      params.periodStart,
      params.periodEnd,
    );
    if (dietz.gainPct != null) return dietz;
  }

  return computeTwrFromSessions(
    params.sessions,
    params.periodEnd,
    params.periodStart,
  );
}

/**
 * Gain $ d'affichage cohérent avec le % résolu (même signe, même méthode).
 * Pour % annualisé, dé-annualise sur la durée réelle de la période.
 */
export function gainCadFromPeriodReturn(
  ret: PeriodReturnPercent,
  periodStart: string,
  periodEnd: string,
): number | null {
  if (ret.gainPct == null || ret.baselineCad == null || ret.baselineCad <= 0) {
    return null;
  }
  const spanDays = Math.max(1, daysBetweenIso(periodStart, periodEnd));
  let cumulativePct = ret.gainPct;
  if (ret.annualized) {
    cumulativePct =
      (Math.pow(1 + ret.gainPct / 100, spanDays / 365) - 1) * 100;
  }
  return (cumulativePct / 100) * ret.baselineCad;
}
