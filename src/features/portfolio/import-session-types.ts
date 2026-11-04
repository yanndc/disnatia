import type { AccountCoverage } from "@/features/portfolio/account-coverage";

/**
 * Types partagés entre le serveur (`buildImportSession`) et l'écran client de la
 * session d'import guidée. Aucun import runtime : ce fichier est sûr côté client.
 */

export type ImportSessionHolding = {
  ticker: string;
  currency: string;
  quantity: number;
};

export type ImportSessionAccount = {
  accountKey: string;
  accountName: string;
  accountNumber: string | null;
  accountType: string | null;
  owner: string | null;
  currency: string;
  totalValue: number;
  cashValue: number;
  snapshotAsOf: string | null;
  lastTransactionDate: string | null;
  lastConfirmationDataAsOf: string | null;
  lastConfirmationAt: string | null;
  coverage: AccountCoverage;
  holdings: ImportSessionHolding[];
};

export type ImportSessionAttributionRule = {
  signature: string;
  accountKey: string;
  sampleFileName: string;
  hits: number;
  updatedAt: string;
};

export type ImportSessionPayload = {
  /** Jour de référence (Toronto) de la session. */
  todayIso: string;
  /** Dernière séance dont on attend les données. */
  expectedSessionIso: string;
  accounts: ImportSessionAccount[];
  summary: {
    total: number;
    upToDate: number;
    toConfirm: number;
    withoutData: number;
    transactionCount: number;
    transactionFrom: string | null;
    transactionTo: string | null;
  };
  attributionRules: ImportSessionAttributionRule[];
};
