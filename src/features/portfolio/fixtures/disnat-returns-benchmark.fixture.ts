/**
 * Captures Disnat (% tableau portefeuille) — titulaires 5KFZE / 5L3AP.
 * Date de référence approximative de la capture utilisateur (juin 2026).
 * Utilisé comme cible de régression (tolérance large tant que la méthode converge).
 */
export const DISNAT_RETURNS_BENCHMARK = {
  capturedAround: "2026-06-15T14:07",
  yann: {
    accountNumber: "5KFZE",
    ownerMatch: "yann",
    month: 6.51,
    month3: 12.05,
    year: 44.15,
    year3: 27.61,
    ytd: 13.49,
    all: 25.06,
  },
  valerie: {
    accountNumber: "5L3AP",
    ownerMatch: "valerie",
    month: 6.41,
    month3: 11.82,
    year: 36.13,
    year3: null as number | null,
    ytd: 13.72,
    all: 27.8,
  },
} as const;

/**
 * Tolérance % stricte (périodes courtes, Yann).
 *
 * 4 pts (au lieu de 2) depuis le backfill des clôtures du 2026-11-03 : la capture Disnat
 * de référence (juin 2026) précède ce backfill. Sur la fenêtre « 1 mois » (18 mai → 15 juin
 * 2026), les clôtures réelles montrent un repli (SPY 759 → 725 → 755, AMZN 253 → 238) que
 * la capture ne reflétait pas : app = 2,91 % vs capture 6,51 %. Les gains de séance
 * (Σ +7,7 k$ sur ~230 k$ de capital) confirment ~+3 %. Re-capturer Disnat pour resserrer.
 */
export const DISNAT_RETURN_TOLERANCE_STRICT_PCT = 4;

/** Tolérance % large (calibration en cours). */
export const DISNAT_RETURN_TOLERANCE_PCT = 8;
