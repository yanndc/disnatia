/**
 * Captures Disnat ($ tableau portefeuille) — titulaires 5KFZE / 5L3AP.
 * Référence : juin 2026.
 */
export const DISNAT_DOLLARS_BENCHMARK = {
  capturedAround: "2026-06-12",
  yann: {
    total: { month3: 814.91, year: 169_067.19, year3: 169_882.1, ytd: 298.47 },
    byAccountKey: {
      "5KFZEZ2|CAD": { ytd: -165.19 },
      "5L3APY0|CAD": { ytd: 315.52 },
    } as Record<string, Partial<Record<"ytd", number>>>,
  },
  valerie: {
    total: { month3: 129.2, year: 68_877.68, year3: 69_006.88, ytd: 397.95 },
    byAccountKey: {
      "5L3APY0|CAD": { month3: 48.02, ytd: 315.52 },
    } as Record<string, Partial<Record<"month3" | "ytd", number>>>,
  },
} as const;

/** Tolérance $ par compte (court terme). */
export const DISNAT_DOLLARS_TOLERANCE_ACCOUNT = 500;

/** Tolérance $ consolidé titulaire (plus large : périmètre Disnat variable). */
export const DISNAT_DOLLARS_TOLERANCE_OWNER = 3_000;
