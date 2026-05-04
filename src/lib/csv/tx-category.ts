/**
 * Mapping du type de transaction brut Disnat vers une catégorie normalisée.
 * Les chaînes brutes peuvent contenir des accents mal encodés (windows-1252 → UTF-8),
 * donc on normalise avant de comparer.
 */

import type { TxCategory } from "@/generated/prisma";

/** Normalise une chaîne : minuscules, sans accents, sans ponctuation superflue. */
function normalizeType(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['']/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Table de correspondance type normalisé → TxCategory. */
const TYPE_MAP: Array<[string | RegExp, TxCategory]> = [
  // Achats / ventes
  ["achat", "BUY"],
  ["vente", "SELL"],

  // Dividendes
  ["dividende en actions", "STOCK_DIVIDEND"],
  ["dividende societe fiducie", "DIVIDEND"],
  ["dividende", "DIVIDEND"],

  // Intérêts
  ["interets", "INTEREST"],
  ["interet", "INTEREST"],

  // Retenue d'impôt
  ["retenue d impot", "TAX_WITHHOLD"],
  ["retenue dimpot", "TAX_WITHHOLD"],
  [/retenue/, "TAX_WITHHOLD"],

  // Cotisations
  ["cotisation du conjoint", "CONTRIBUTION"],
  ["cotisation celi", "CONTRIBUTION"],
  ["cotisation reer", "CONTRIBUTION"],
  ["cotisation", "CONTRIBUTION"],

  // Transferts entrants
  ["transfert recu", "TRANSFER_IN"],
  ["depot recu", "TRANSFER_IN"],
  [/depot.*caisse/, "TRANSFER_IN"],

  // Transferts sortants
  ["transfert sortant", "TRANSFER_OUT"],

  // Transferts internes (entre comptes d'un même client)
  ["transfert interne", "INTERNAL_TRANSFER"],
  ["virement electronique", "INTERNAL_TRANSFER"],
  ["virement", "INTERNAL_TRANSFER"],

  // Annulations / inversions
  ["annulation", "REVERSAL"],

  // Fractionnement / fusion
  ["fractionnement", "STOCK_SPLIT"],
  ["regroupement", "STOCK_SPLIT"],

  // Échange (conversion de titres, currency swap, etc.)
  ["echange", "EXCHANGE"],

  // Résiliation (rachat d'obligation, remboursement, etc.)
  ["resiliation", "TERMINATION"],

  // Frais
  ["frais", "FEE"],
  ["commission", "FEE"],

  // Écriture de journal
  ["ecriture de journal", "JOURNAL"],
  [/ecriture/, "JOURNAL"],
];

export function categorizeTxType(rawType: string | null | undefined): TxCategory {
  if (!rawType) return "OTHER";

  const norm = normalizeType(rawType);

  for (const [pattern, category] of TYPE_MAP) {
    if (typeof pattern === "string") {
      if (norm === pattern || norm.startsWith(pattern)) {
        return category;
      }
    } else {
      if (pattern.test(norm)) {
        return category;
      }
    }
  }

  return "OTHER";
}

/** Libellé français court pour affichage. */
export const TX_CATEGORY_LABELS: Record<TxCategory, string> = {
  BUY: "Achat",
  SELL: "Vente",
  DIVIDEND: "Dividende",
  STOCK_DIVIDEND: "Dividende en actions",
  INTEREST: "Intérêts",
  TAX_WITHHOLD: "Retenue d'impôt",
  CONTRIBUTION: "Cotisation",
  TRANSFER_IN: "Transfert reçu",
  TRANSFER_OUT: "Transfert sortant",
  INTERNAL_TRANSFER: "Transfert interne",
  REVERSAL: "Annulation",
  FEE: "Frais",
  STOCK_SPLIT: "Fractionnement",
  EXCHANGE: "Échange",
  TERMINATION: "Résiliation",
  JOURNAL: "Écriture de journal",
  OTHER: "Autre",
};

/** Couleur Tailwind badge par catégorie. */
export const TX_CATEGORY_COLORS: Record<TxCategory, string> = {
  BUY: "bg-emerald-100 text-emerald-700",
  SELL: "bg-rose-100 text-rose-700",
  DIVIDEND: "bg-sky-100 text-sky-700",
  STOCK_DIVIDEND: "bg-sky-100 text-sky-700",
  INTEREST: "bg-blue-100 text-blue-700",
  TAX_WITHHOLD: "bg-orange-100 text-orange-700",
  CONTRIBUTION: "bg-violet-100 text-violet-700",
  TRANSFER_IN: "bg-teal-100 text-teal-700",
  TRANSFER_OUT: "bg-amber-100 text-amber-700",
  INTERNAL_TRANSFER: "bg-slate-100 text-slate-600",
  REVERSAL: "bg-red-100 text-red-600",
  FEE: "bg-red-100 text-red-700",
  STOCK_SPLIT: "bg-indigo-100 text-indigo-700",
  EXCHANGE: "bg-purple-100 text-purple-700",
  TERMINATION: "bg-gray-100 text-gray-600",
  JOURNAL: "bg-gray-100 text-gray-600",
  OTHER: "bg-gray-100 text-gray-500",
};
