/**
 * Captures Disnat ($ tableau portefeuille) — titulaires 5KFZE / 5L3AP.
 * Colonnes 3m / 1an / 3ans = encaisse, valeur titres, valeur totale (pas des gains).
 * Seule la colonne « Année à date » = gain $ (devise du compte ; total titulaire en CAD).
 * Référence : export + capture écran 2026-06-15 14:07 (Toronto).
 */
export const DISNAT_DOLLARS_BENCHMARK = {
  capturedAround: "2026-06-15T14:07",
  yann: {
    total: { ytd: 2_760.25 },
    byAccountKey: {
      "5KFZEZ2|CAD": { ytd: 137.01 },
      "5KFZET5|USD": { ytd: 45.1 },
      "5KFZEY4|CAD": { ytd: -1.28 },
      "5KFZEU3|USD": { ytd: 1_240.8 },
      "5KFZE19|CAD": { ytd: 0 },
      "5KFZES7|USD": { ytd: 592.78 },
    } as Record<string, Partial<Record<"ytd", number>>>,
  },
  valerie: {
    total: { ytd: 1_275.82 },
    byAccountKey: {
      "5L3APY0|CAD": { ytd: 1_038.5 },
    } as Record<string, Partial<Record<"ytd", number>>>,
  },
} as const;

/** Tolérance $ par compte (court terme). */
export const DISNAT_DOLLARS_TOLERANCE_ACCOUNT = 500;

/** Tolérance $ consolidé titulaire. */
export const DISNAT_DOLLARS_TOLERANCE_OWNER = 500;
