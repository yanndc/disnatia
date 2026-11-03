/**
 * Version de la méthode de calcul des indicateurs.
 * Incrémenter lors d'un changement de formule (ex. Dietz → TWR) pour ne pas
 * écraser silencieusement les snapshots historiques.
 *
 * v11 (2026-11-03) : bornes de période 100 % calendrier (invariance fuseau),
 * plancher BMV d'import neutre des apports, base marché-only pour les snapshots,
 * agrégation multi-devises par compte, dates de flux issues de composantes UTC.
 * v12 (2026-11-03) : AAJ piloté par `selectedYear`, repli chaîne de séances quand la
 * séance est ouverte sans cotation, historique « Total » depuis la première séance.
 * v13 (2026-11-03) : BMV = 1re séance **couverte** (prior > 0) puis premier point connu du
 * compte — les comptes ouverts après la borne étaient exclus du $ (Total < 3 ans).
 */
export const PERFORMANCE_CALC_VERSION = 13;
