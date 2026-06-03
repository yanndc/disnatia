import type { PerformanceSessionGain } from "./performance-indicator-types";

/** Seuil au-delà duquel le rendement est annualisé (comme Desjardins). */
const ANNUALIZE_MIN_SPAN_DAYS = 366;

function parseIsoUtc(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
}

/** Nombre de jours calendaires entre deux dates ISO (>= 0). */
export function daysBetweenIso(startIso: string, endIso: string): number {
  const diff = (parseIsoUtc(endIso) - parseIsoUtc(startIso)) / 86_400_000;
  return Math.max(0, Math.round(diff));
}

export type MoneyWeightedResult = {
  /** Rendement en % (annualisé si la période dépasse ~1 an). */
  gainPct: number | null;
  /** Capital moyen investi sur la période (dénominateur du rendement). */
  baselineCad: number | null;
  /** true si le % retourné est un taux annualisé. */
  annualized: boolean;
};

/**
 * Rendement pondéré en fonction de la valeur en dollars (approche capital moyen),
 * aligné sur la méthode Desjardins.
 *
 * Numérateur : P&L titres de la période (Σ gains de séance, déjà insensible aux
 * cotisations/retraits car basé sur qty × Δ clôture).
 * Dénominateur : capital moyen réellement investi = moyenne des valeurs titres
 * quotidiennes (priorCad) sur les séances de la période. Cela neutralise les
 * apports de capitaux sans avoir besoin du détail des flux.
 *
 * Sur > 1 an, le rendement cumulé est converti en taux annualisé.
 */
export function computeMoneyWeightedReturn(
  sessions: PerformanceSessionGain[],
  gainCad: number,
  periodEndIso: string,
): MoneyWeightedResult {
  if (sessions.length === 0) {
    return { gainPct: null, baselineCad: null, annualized: false };
  }

  const priors = sessions
    .map((s) => s.priorCad)
    .filter((p) => Number.isFinite(p) && p > 0);
  if (priors.length === 0) {
    return { gainPct: null, baselineCad: null, annualized: false };
  }

  const avgCapital = priors.reduce((sum, p) => sum + p, 0) / priors.length;
  if (!(avgCapital > 0) || !Number.isFinite(gainCad)) {
    return { gainPct: null, baselineCad: avgCapital > 0 ? avgCapital : null, annualized: false };
  }

  const cumulative = gainCad / avgCapital;

  // Span = de la première séance réellement mesurée jusqu'à la fin de période.
  const firstSessionDate = sessions[0]!.date;
  const spanDays = Math.max(1, daysBetweenIso(firstSessionDate, periodEndIso));

  // Annualise au-delà d'un an (cumulé sinon). Évite la racine d'un nombre négatif
  // en cas de perte > 100 % du capital moyen (cas extrême, repli sur le cumulé).
  const annualized = spanDays > ANNUALIZE_MIN_SPAN_DAYS && cumulative > -1;
  const gainPct = annualized
    ? (Math.pow(1 + cumulative, 365 / spanDays) - 1) * 100
    : cumulative * 100;

  return { gainPct, baselineCad: avgCapital, annualized };
}
