/**
 * Captures Disnat (% tableau portefeuille) — titulaires 5KFZE / 5L3AP.
 * Date de référence approximative de la capture utilisateur (juin 2026).
 * Utilisé comme cible de régression (tolérance large tant que la méthode converge).
 */
export const DISNAT_RETURNS_BENCHMARK = {
  capturedAround: "2026-06-12",
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

/** Tolérance % stricte (Yann, périodes courtes). */
export const DISNAT_RETURN_TOLERANCE_STRICT_PCT = 2;

/** Tolérance % large (calibration en cours). */
export const DISNAT_RETURN_TOLERANCE_PCT = 8;
