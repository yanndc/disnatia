import type { EnrichedPosition } from "@/features/portfolio/live-enrichment";
import { normalizeCurrency } from "@/lib/utils";
import type { AccountWithStats } from "./comptes-types";

export function sum(vals: number[]) {
  return vals.reduce((t, v) => t + v, 0);
}

/** Somme marché approx. des lignes titre projetées pour ce compte. */
export type AccountDayTitresPnLState = {
  sum: number | null;
  /**
   * Σ (valeur titre − P&L jour) sur les lignes où le P&L jour est connu ;
   * approximation « valeur veille » pour un % journalier cohérent au niveau agrégé.
   */
  priorCloseTitresValue: number | null;
  incomplete: boolean;
  hasTitresProjetes: boolean;
};

export function emptyDayTitresState(): AccountDayTitresPnLState {
  return {
    sum: null,
    priorCloseTitresValue: null,
    incomplete: false,
    hasTitresProjetes: false,
  };
}

export function accountDayTitresPnL(rows: EnrichedPosition[]): AccountDayTitresPnLState {
  const withQty = rows.filter((p) => p.quantity > 0);
  if (withQty.length === 0) {
    return emptyDayTitresState();
  }
  const known = withQty.filter(
    (p) => p.displayDayGainLoss !== null && Number.isFinite(p.displayDayGainLoss),
  );
  const sumVal =
    known.length > 0 ? known.reduce((s, p) => s + (p.displayDayGainLoss ?? 0), 0) : null;
  let priorSum = 0;
  for (const p of known) {
    const gl = p.displayDayGainLoss ?? 0;
    const base = p.displayMarketValue - gl;
    if (Number.isFinite(base) && base > 0) priorSum += base;
  }
  return {
    sum: sumVal,
    priorCloseTitresValue:
      known.length > 0 && priorSum > 0 && Number.isFinite(priorSum) ? priorSum : null,
    incomplete: known.length < withQty.length,
    hasTitresProjetes: true,
  };
}

export function aggregateDayTitresForSubset(
  subset: AccountWithStats[],
  byKey: Map<string, AccountDayTitresPnLState>,
): AccountDayTitresPnLState {
  let total = 0;
  let hasSum = false;
  let totalPrior = 0;
  let hasPrior = false;
  let incomplete = false;
  let hasTitres = false;
  for (const acc of subset) {
    const row = byKey.get(acc.accountKey) ?? emptyDayTitresState();
    if (!row.hasTitresProjetes) continue;
    hasTitres = true;
    if (row.incomplete) incomplete = true;
    if (row.sum !== null) {
      hasSum = true;
      total += row.sum;
    }
    if (row.priorCloseTitresValue !== null && row.priorCloseTitresValue > 0) {
      hasPrior = true;
      totalPrior += row.priorCloseTitresValue;
    }
  }
  const anyTitresSansDelta =
    incomplete ||
    subset.some((acc) => {
      const row = byKey.get(acc.accountKey);
      return row?.hasTitresProjetes && row.sum === null;
    });
  return {
    sum: hasSum ? total : null,
    priorCloseTitresValue: hasPrior && totalPrior > 0 ? totalPrior : null,
    incomplete: hasTitres && anyTitresSansDelta,
    hasTitresProjetes: hasTitres,
  };
}

export function consolidatedDayTitresCadState(
  cadSubset: AccountWithStats[],
  usdSubset: AccountWithStats[],
  byKey: Map<string, AccountDayTitresPnLState>,
  usdToCad: number | null,
): AccountDayTitresPnLState {
  if (
    !Number.isFinite(usdToCad as number) ||
    usdToCad === null ||
    usdToCad <= 0
  ) {
    return emptyDayTitresState();
  }
  const cadDay = aggregateDayTitresForSubset(cadSubset, byKey);
  const usdDay = aggregateDayTitresForSubset(usdSubset, byKey);
  const hasTitres = cadDay.hasTitresProjetes || usdDay.hasTitresProjetes;
  let contributed = false;
  let total = 0;
  let totalPrior = 0;
  let hasPrior = false;
  if (cadDay.sum !== null) {
    contributed = true;
    total += cadDay.sum;
  }
  if (usdDay.sum !== null) {
    contributed = true;
    total += usdDay.sum * usdToCad;
  }
  if (cadDay.priorCloseTitresValue !== null && cadDay.priorCloseTitresValue > 0) {
    hasPrior = true;
    totalPrior += cadDay.priorCloseTitresValue;
  }
  if (usdDay.priorCloseTitresValue !== null && usdDay.priorCloseTitresValue > 0) {
    hasPrior = true;
    totalPrior += usdDay.priorCloseTitresValue * usdToCad;
  }
  const incomplete =
    hasTitres &&
    (cadDay.incomplete ||
      usdDay.incomplete ||
      (cadDay.hasTitresProjetes && cadDay.sum === null) ||
      (usdDay.hasTitresProjetes && usdDay.sum === null));
  return {
    sum: contributed ? total : null,
    priorCloseTitresValue: hasPrior && totalPrior > 0 ? totalPrior : null,
    incomplete,
    hasTitresProjetes: hasTitres,
  };
}

export function scaleUsdTitresDayStateToCad(
  state: AccountDayTitresPnLState,
  usdToCad: number | null,
): AccountDayTitresPnLState {
  if (!state.hasTitresProjetes) return emptyDayTitresState();
  if (usdToCad == null || !Number.isFinite(usdToCad) || usdToCad <= 0) {
    return {
      sum: null,
      priorCloseTitresValue: null,
      incomplete: true,
      hasTitresProjetes: true,
    };
  }
  if (state.sum === null) {
    return {
      sum: null,
      priorCloseTitresValue:
        state.priorCloseTitresValue !== null
          ? state.priorCloseTitresValue * usdToCad
          : null,
      incomplete: state.incomplete,
      hasTitresProjetes: true,
    };
  }
  return {
    sum: state.sum * usdToCad,
    priorCloseTitresValue:
      state.priorCloseTitresValue !== null
        ? state.priorCloseTitresValue * usdToCad
        : null,
    incomplete: state.incomplete,
    hasTitresProjetes: true,
  };
}

export function accountDriftTitresCad(
  acc: AccountWithStats,
  usdToCad: number | null,
): number | null {
  if (acc.driftTitresVsSnapshot === null) return null;
  const cur = normalizeCurrency(acc.currency);
  if (cur === "USD") return usdToCad != null ? acc.driftTitresVsSnapshot * usdToCad : null;
  return acc.driftTitresVsSnapshot;
}

export function aggregateByCurrency(accounts: AccountWithStats[], currency: "CAD" | "USD") {
  const subset = accounts.filter((a) => normalizeCurrency(a.currency) === currency);
  let reconMissing = false;
  let driftMissing = false;
  let reconSum = 0;
  let driftSum = 0;
  for (const a of subset) {
    if (a.reconstructedMarketValue === null) reconMissing = true;
    else reconSum += a.reconstructedMarketValue;
    if (a.driftTitresVsSnapshot === null) driftMissing = true;
    else driftSum += a.driftTitresVsSnapshot;
  }
  return {
    subset,
    cash: sum(subset.map((a) => a.cashValue)),
    market: sum(subset.map((a) => a.marketValue)),
    total: sum(subset.map((a) => a.totalValue)),
    reconstructedMarketValue: reconMissing ? null : reconSum,
    driftTitresVsSnapshot: driftMissing ? null : driftSum,
    txCount: sum(subset.map((a) => a.txCount)),
    lastTxDate: subset.reduce<Date | null>((latest, a) => {
      const d = a.lastTxDate;
      if (!d) return latest;
      if (!latest || d.getTime() > latest.getTime()) return d;
      return latest;
    }, null),
  };
}

export function ownerDriftNetCad(
  accounts: AccountWithStats[],
  usdToCad: number | null,
): number | null {
  const parts = accounts
    .map((a) => accountDriftTitresCad(a, usdToCad))
    .filter((v): v is number => v !== null);
  return parts.length > 0 ? sum(parts) : null;
}

export function ownerConsolidatedCad(
  accounts: AccountWithStats[],
  usdToCad: number | null,
): {
  encaisse: number | null;
  titresFichier: number | null;
  titresRecon: number | null;
  total: number | null;
} {
  if (usdToCad == null) {
    return {
      encaisse: null,
      titresFichier: null,
      titresRecon: null,
      total: null,
    };
  }
  let reconMissing = false;
  let enc = 0;
  let mkt = 0;
  let tot = 0;
  let recon = 0;
  for (const a of accounts) {
    const cur = normalizeCurrency(a.currency);
    const mult = cur === "USD" ? usdToCad : 1;
    enc += a.cashValue * mult;
    mkt += a.marketValue * mult;
    tot += a.totalValue * mult;
    if (a.reconstructedMarketValue === null) reconMissing = true;
    else recon += a.reconstructedMarketValue * mult;
  }
  return {
    encaisse: enc,
    titresFichier: mkt,
    titresRecon: reconMissing ? null : recon,
    total: tot,
  };
}

export function driftCellClass(drift: number | null) {
  if (drift === null) return "text-slate-400";
  return Math.abs(drift) > 500 ? "font-medium text-amber-700" : "text-slate-700";
}

export const RECON_COLUMNS_STORAGE_KEY = "disnatia.comptes.showReconciliation";
