import {
  isTradingDayIso,
  nextTradingDayIso,
  priorSessionDateIso,
} from "@/lib/market/equity-session";

/**
 * État de couverture d'un compte pour la session d'import guidée.
 *
 * La « fraîcheur » d'un compte est le maximum de trois sources :
 * - le dernier export **portefeuille** (montants / encaisse de référence) ;
 * - la dernière **opération** importée (historique des transactions) ;
 * - la dernière **attestation** « aucune transaction depuis le … ».
 *
 * L'attestation ne change aucune valeur en base : elle documente seulement que
 * l'historique des opérations est complet jusqu'à `dataAsOf`.
 */
export type AccountCoverageStatus = "A_JOUR" | "A_CONFIRMER" | "SANS_DONNEES";

export type AccountCoverageSource =
  | "PORTEFEUILLE"
  | "OPERATIONS"
  | "CONFIRMATION"
  | "SNAPSHOT_CLIENT";


export type AccountCoverageInput = {
  accountKey: string;
  /** `asOf` du dernier import portefeuille (ISO `yyyy-mm-dd`). */
  snapshotAsOf: string | null;
  /** Date de la dernière opération importée (ISO `yyyy-mm-dd`). */
  lastTransactionDate: string | null;
  /** `dataAsOf` de la dernière attestation (ISO `yyyy-mm-dd`). */
  lastConfirmationDataAsOf: string | null;
  /** Horodatage de la dernière attestation (ISO datetime). */
  lastConfirmationAt: string | null;
  /**
   * `asOf` de la dernière capture « Vue d'ensemble » du **client** (favori Disnat).
   * Les totaux officiels du client ont été lus à cette date : tous ses comptes sont frais.
   */
  clientSnapshotAsOf?: string | null;
};

export type AccountCoverage = {
  accountKey: string;
  freshnessIso: string | null;
  freshnessSource: AccountCoverageSource | null;
  /** Nombre de séances manquantes entre la fraîcheur et la dernière séance attendue. */
  staleTradingDays: number;
  status: AccountCoverageStatus;
  requiresConfirmation: boolean;
  lastConfirmationAt: string | null;
  /** Date proposée pour l'attestation (dernière séance attendue). */
  suggestedDataAsOf: string;
};

/** Tolérance : en deçà, on considère le compte à jour malgré quelques séances de retard. */
export const ACCOUNT_COVERAGE_MAX_STALE_TRADING_DAYS = 5;

/** Dernière séance dont on attend les données (veille de séance en semaine, dernière clôture le week-end). */
export function expectedCoverageSessionIso(now = new Date()): string {
  return priorSessionDateIso(now);
}

/** Séances strictement comprises entre `fromIso` (exclu) et `toIso` (inclus). */
export function countTradingDaysAfter(fromIso: string, toIso: string): number {
  if (fromIso >= toIso) return 0;
  let cursor = isTradingDayIso(fromIso) ? nextTradingDayIso(fromIso) : fromIso;
  let count = 0;
  while (cursor <= toIso) {
    if (isTradingDayIso(cursor)) count += 1;
    cursor = nextTradingDayIso(cursor);
  }
  return count;
}

export function assessAccountCoverage(
  input: AccountCoverageInput,
  now = new Date(),
  maxStaleTradingDays = ACCOUNT_COVERAGE_MAX_STALE_TRADING_DAYS,
): AccountCoverage {
  const expected = expectedCoverageSessionIso(now);

  const candidates: { iso: string | null; source: AccountCoverageSource }[] = [
    { iso: input.snapshotAsOf, source: "PORTEFEUILLE" },
    { iso: input.lastTransactionDate, source: "OPERATIONS" },
    { iso: input.lastConfirmationDataAsOf, source: "CONFIRMATION" },
    { iso: input.clientSnapshotAsOf ?? null, source: "SNAPSHOT_CLIENT" },
  ];

  let freshnessIso: string | null = null;
  let freshnessSource: AccountCoverageSource | null = null;
  for (const candidate of candidates) {
    if (!candidate.iso) continue;
    if (freshnessIso === null || candidate.iso > freshnessIso) {
      freshnessIso = candidate.iso;
      freshnessSource = candidate.source;
    }
  }

  if (freshnessIso === null) {
    return {
      accountKey: input.accountKey,
      freshnessIso: null,
      freshnessSource: null,
      staleTradingDays: 0,
      status: "SANS_DONNEES",
      requiresConfirmation: true,
      lastConfirmationAt: input.lastConfirmationAt,
      suggestedDataAsOf: expected,
    };
  }

  const staleTradingDays = countTradingDaysAfter(freshnessIso, expected);
  const upToDate = staleTradingDays <= maxStaleTradingDays;

  return {
    accountKey: input.accountKey,
    freshnessIso,
    freshnessSource,
    staleTradingDays,
    status: upToDate ? "A_JOUR" : "A_CONFIRMER",
    requiresConfirmation: !upToDate,
    lastConfirmationAt: input.lastConfirmationAt,
    suggestedDataAsOf: expected,
  };
}

export function coverageStatusLabel(status: AccountCoverageStatus): string {
  switch (status) {
    case "A_JOUR":
      return "À jour";
    case "A_CONFIRMER":
      return "À confirmer";
    default:
      return "Sans données";
  }
}

/** Résumé d'une file d'attente de comptes pour l'en-tête de la session guidée. */
export function summarizeCoverage(coverages: AccountCoverage[]): {
  total: number;
  upToDate: number;
  toConfirm: number;
  withoutData: number;
} {
  return {
    total: coverages.length,
    upToDate: coverages.filter((c) => c.status === "A_JOUR").length,
    toConfirm: coverages.filter((c) => c.status === "A_CONFIRMER").length,
    withoutData: coverages.filter((c) => c.status === "SANS_DONNEES").length,
  };
}
