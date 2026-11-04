import type { NewsCategory } from "@/generated/prisma/client";

/**
 * Score de pertinence « pour moi » d'un article (0–100).
 * Volontairement déterministe et testable : aucune I/O, aucun appel réseau.
 */
export const NEWS_SCORE_WEIGHTS = {
  exposure: 45,
  recency: 25,
  match: 20,
  source: 5,
  category: 5,
} as const;

/** Exposition prise en compte à 100 % : au-delà, le titre est déjà « majeur » pour le score. */
export const EXPOSURE_FULL_POINTS_PCT = 20;

/** Demi-vie de la fraîcheur : une nouvelle de 48 h vaut la moitié d'une nouvelle du jour. */
export const RECENCY_HALF_LIFE_HOURS = 48;

const CATEGORY_WEIGHT: Record<NewsCategory, number> = {
  MARKETS: 1,
  COMPANY: 1,
  ECONOMY: 0.6,
  REAL_ESTATE: 0.4,
  PERSONAL_FINANCE: 0.4,
  OTHER: 0,
};

export type RelevanceInput = {
  /** Poids du/des titres touchés dans le portefeuille Disnat (%). */
  exposurePct: number;
  /** Ancienneté de publication en heures (0 = maintenant). */
  hoursOld: number;
  /** Confiance du rattachement ticker (0 si aucun titre reconnu). */
  matchConfidence: number;
  /** Pondération éditoriale du flux (0.2 – 2). */
  sourceWeight: number;
  category: NewsCategory;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function computeRelevanceScore(input: RelevanceInput): number {
  const exposureRatio =
    clamp(input.exposurePct, 0, EXPOSURE_FULL_POINTS_PCT) / EXPOSURE_FULL_POINTS_PCT;
  const recencyRatio = Math.exp(
    (-Math.LN2 * Math.max(0, input.hoursOld)) / RECENCY_HALF_LIFE_HOURS,
  );
  const matchRatio = clamp(input.matchConfidence, 0, 1);
  const sourceRatio = clamp(input.sourceWeight / 2, 0, 1);
  const categoryRatio = CATEGORY_WEIGHT[input.category] ?? 0;

  const score =
    exposureRatio * NEWS_SCORE_WEIGHTS.exposure +
    recencyRatio * NEWS_SCORE_WEIGHTS.recency +
    matchRatio * NEWS_SCORE_WEIGHTS.match +
    sourceRatio * NEWS_SCORE_WEIGHTS.source +
    categoryRatio * NEWS_SCORE_WEIGHTS.category;

  return Math.round(clamp(score, 0, 100) * 10) / 10;
}

/** Trois paliers d'affichage : à lire, utile, contexte. */
export function relevanceTone(score: number): "high" | "medium" | "low" {
  if (score >= 55) return "high";
  if (score >= 30) return "medium";
  return "low";
}
