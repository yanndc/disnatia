/**
 * Rendement « pondéré en fonction de la valeur en dollars » — **formule officielle Disnat**
 * (`docs/Disnat-taux-de-rendement-disnat-fr.pdf`) : c'est un TRI (XIRR) résolu sur les
 * mouvements monétaires datés.
 *
 *   0 = −VMD + Σ(−dépôts)/(1+R)^Pi + Σ(retraits)/(1+R)^Pi + VMF/(1+R)^Pn
 *
 * `Pi = jours écoulés / 365`. Au-delà d'un an, Disnat annualise ; sinon le rendement de la
 * période est affiché tel quel.
 */

/** Seuil au-delà duquel le rendement est annualisé (comme Desjardins). */
const ANNUALIZE_MIN_SPAN_DAYS = 366;
const DAYS_PER_YEAR = 365;

function parseIsoUtc(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
}

/** Nombre de jours calendaires entre deux dates ISO (>= 0). */
export function daysBetweenIso(startIso: string, endIso: string): number {
  const diff = (parseIsoUtc(endIso) - parseIsoUtc(startIso)) / 86_400_000;
  return Math.max(0, Math.round(diff));
}

export type MoneyFlow = {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  /** Montant absolu du mouvement. */
  amount: number;
  /** `in` = dépôt / transfert entrant ; `out` = retrait / transfert sortant. */
  direction: "in" | "out";
};

export type MoneyWeightedInput = {
  startIso: string;
  /** Valeur marchande au début de la période (VMD). */
  startValue: number;
  endIso: string;
  /** Valeur marchande à la fin de la période (VMF). */
  endValue: number;
  flows: MoneyFlow[];
};

export type MoneyWeightedResult = {
  /** Rendement en % (annualisé si la période dépasse ~1 an). */
  gainPct: number | null;
  /** Capital de départ pris en compte (VMD). */
  baselineCad: number | null;
  /** true si le % retourné est un taux annualisé. */
  annualized: boolean;
  spanDays: number;
  flowCount: number;
};

function netPresentValue(rate: number, input: MoneyWeightedInput): number {
  // Borne basse : évite une base négative/instable dans la puissance.
  const safeRate = rate <= -0.999999 ? -0.999999 : rate;
  let total = -input.startValue;
  for (const flow of input.flows) {
    const exponent = daysBetweenIso(input.startIso, flow.date) / DAYS_PER_YEAR;
    const signed = flow.direction === "in" ? -flow.amount : flow.amount;
    total += signed / Math.pow(1 + safeRate, exponent);
  }
  total += input.endValue / Math.pow(1 + safeRate, daysBetweenIso(input.startIso, input.endIso) / DAYS_PER_YEAR);
  return total;
}

/**
 * Résout le TRI de la période (méthode Disnat). `null` si l'équation n'a pas de racine
 * exploitable (valeurs manquantes, période nulle).
 */
export function computeMoneyWeightedReturn(input: MoneyWeightedInput): MoneyWeightedResult {
  const spanDays = daysBetweenIso(input.startIso, input.endIso);
  const flows = input.flows
    .filter((flow) => Number.isFinite(flow.amount) && Math.abs(flow.amount) > 0.005)
    .filter((flow) => flow.date >= input.startIso && flow.date <= input.endIso)
    .sort((a, b) => a.date.localeCompare(b.date));
  const annualized = spanDays > ANNUALIZE_MIN_SPAN_DAYS;

  if (spanDays <= 0 || !(input.endValue > 0)) {
    return { gainPct: null, baselineCad: null, annualized, spanDays, flowCount: flows.length };
  }

  // Aucun mouvement : simple variation de valeur.
  if (flows.length === 0) {
    if (!(input.startValue > 0)) {
      return { gainPct: null, baselineCad: null, annualized, spanDays, flowCount: 0 };
    }
    const periodRate = input.endValue / input.startValue - 1;
    const gainPct = annualized
      ? (Math.pow(1 + periodRate, DAYS_PER_YEAR / spanDays) - 1) * 100
      : periodRate * 100;
    return { gainPct, baselineCad: input.startValue, annualized, spanDays, flowCount: 0 };
  }

  const normalized: MoneyWeightedInput = { ...input, flows };
  let low = -0.999999;
  let high = 10;
  let fLow = netPresentValue(low, normalized);
  const fHigh = netPresentValue(high, normalized);
  if (!Number.isFinite(fLow) || !Number.isFinite(fHigh) || fLow * fHigh > 0) {
    return { gainPct: null, baselineCad: input.startValue, annualized, spanDays, flowCount: flows.length };
  }

  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    const fMid = netPresentValue(mid, normalized);
    if (Math.abs(fMid) < 0.01) {
      low = mid;
      high = mid;
      break;
    }
    if (fLow * fMid <= 0) {
      high = mid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }

  const annualRate = (low + high) / 2;
  const periodRate = annualized
    ? Math.pow(1 + annualRate, spanDays / DAYS_PER_YEAR) - 1
    : annualRate;
  const gainPct = (annualized ? annualRate : periodRate) * 100;

  return {
    gainPct: Number.isFinite(gainPct) ? gainPct : null,
    baselineCad: input.startValue,
    annualized,
    spanDays,
    flowCount: flows.length,
  };
}

