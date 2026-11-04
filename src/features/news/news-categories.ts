import type { NewsCategory } from "@/generated/prisma/client";

/**
 * Libellés français des catégories (UI + badges).
 * Fichier volontairement sans dépendance Node : importable côté client.
 */
export const NEWS_CATEGORY_LABELS: Record<NewsCategory, string> = {
  MARKETS: "Marchés",
  COMPANY: "Entreprises",
  ECONOMY: "Économie",
  REAL_ESTATE: "Immobilier",
  PERSONAL_FINANCE: "Finances personnelles",
  OTHER: "Autre",
};
