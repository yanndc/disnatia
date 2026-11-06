import { clientCodeFromAccountKey } from "./account-coverage";
import type {
  PerformanceAccountRef,
  PerformanceClientCashSnapshot,
} from "./performance-indicator-types";

/**
 * Captures officielles du favori Disnat « Vue d'ensemble » (`disnat_client_cash_snapshots`).
 *
 * Elles donnent, **par client**, la valeur des titres, l'encaisse et le total tels que Disnat
 * les affiche — souvent quotidiennement — alors qu'un export portefeuille CSV ne revient que
 * de temps en temps. Elles servent donc de référence de **fin de période** quand elles sont
 * plus récentes que le dernier import.
 */

/** Nombre de séances ouvrées de tolérance entre la date de rapport et la capture. */
export const FAVORI_MAX_GAP_TRADING_DAYS = 5;

export type ClientKeysScope = {
  clientCode: string;
  accountKeys: string[];
};

/** Regroupe des clés de compte par code client Disnat. */
export function groupAccountKeysByClient(accountKeys: string[]): ClientKeysScope[] {
  const byClient = new Map<string, string[]>();
  for (const accountKey of accountKeys) {
    const clientCode = clientCodeFromAccountKey(accountKey);
    const list = byClient.get(clientCode) ?? [];
    list.push(accountKey);
    byClient.set(clientCode, list);
  }
  return [...byClient.entries()].map(([clientCode, keys]) => ({
    clientCode,
    accountKeys: keys,
  }));
}

/**
 * Capture favori utilisable pour une date de rapport : la plus récente **au plus tard** à
 * `isoDate` et **au plus tôt** à `minAsOf` (borne de péremption).
 */
export function favoriReferenceForClient(
  snapshots: PerformanceClientCashSnapshot[] | undefined,
  clientCode: string,
  isoDate: string,
  minAsOf: string,
): PerformanceClientCashSnapshot | null {
  const code = clientCode.trim().toUpperCase();
  let best: PerformanceClientCashSnapshot | null = null;
  for (const snapshot of snapshots ?? []) {
    if (snapshot.clientCode.trim().toUpperCase() !== code) continue;
    if (snapshot.asOf > isoDate || snapshot.asOf < minAsOf) continue;
    if (!best || snapshot.asOf > best.asOf) best = snapshot;
  }
  return best;
}

/** Dates de rapport publiées par le favori (ISO), triées du plus récent au plus ancien. */
export function favoriReportDates(
  snapshots: PerformanceClientCashSnapshot[] | undefined,
): string[] {
  const unique = new Set<string>();
  for (const snapshot of snapshots ?? []) {
    if (snapshot.asOf) unique.add(snapshot.asOf);
  }
  return [...unique].toSorted((a, b) => b.localeCompare(a));
}

/**
 * Une capture client ne peut servir de total que si **tous** les comptes Disnat de ce client
 * sont dans la portée analysée : sinon le total officiel couvre des comptes exclus par les
 * filtres (propriétaire, comptes cochés…).
 */
export function favoriCoversScope(
  accounts: PerformanceAccountRef[],
  clientCode: string,
  scopedAccountKeys: string[],
): boolean {
  const scoped = new Set(scopedAccountKeys);
  const clientAccounts = accounts.filter(
    (account) =>
      !account.isExternal && clientCodeFromAccountKey(account.accountKey) === clientCode,
  );
  if (clientAccounts.length === 0) return false;
  return clientAccounts.every((account) => scoped.has(account.accountKey));
}

export type CashAccountLine = {
  accountKey: string;
  currency: string;
  /** Encaisse native issue du dernier export portefeuille. */
  cashValue: number;
  /** `asOf` du dernier export portefeuille du compte (ms). */
  csvAsOfMs: number;
};

export type FavoriCashSnapshot = {
  clientCode: string;
  asOfMs: number;
  cashCad: number;
};

/**
 * Remplace l'encaisse du fichier par l'encaisse **officielle** du favori « Vue d'ensemble »
 * quand elle est plus récente, client par client.
 *
 * Le favori ne donne qu'un total par client : l'écart est réparti au prorata de l'encaisse
 * de chaque compte (à parts égales si tous les comptes sont vides), puis reconverti dans la
 * devise du compte. Le total par devise reste donc cohérent avec Disnat.
 */
export function favoriAdjustedCashByAccount(
  accounts: CashAccountLine[],
  snapshots: FavoriCashSnapshot[],
  usdToCad: number | null,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const account of accounts) result.set(account.accountKey, account.cashValue);

  const toCad = (value: number, currency: string) => {
    const cur = currency.trim().toUpperCase();
    return (cur === "USD" || cur === "US") && usdToCad !== null ? value * usdToCad : value;
  };
  const fromCad = (valueCad: number, currency: string) => {
    const cur = currency.trim().toUpperCase();
    return (cur === "USD" || cur === "US") && usdToCad !== null ? valueCad / usdToCad : valueCad;
  };

  const latestFavoriByClient = new Map<string, FavoriCashSnapshot>();
  for (const snapshot of snapshots) {
    const code = snapshot.clientCode.trim().toUpperCase();
    const current = latestFavoriByClient.get(code);
    if (!current || snapshot.asOfMs > current.asOfMs) latestFavoriByClient.set(code, snapshot);
  }

  const byClient = new Map<string, CashAccountLine[]>();
  for (const account of accounts) {
    const code = clientCodeFromAccountKey(account.accountKey);
    const list = byClient.get(code) ?? [];
    list.push(account);
    byClient.set(code, list);
  }

  for (const [clientCode, clientAccounts] of byClient) {
    const favori = latestFavoriByClient.get(clientCode);
    if (!favori) continue;
    const csvAsOfMs = Math.max(...clientAccounts.map((account) => account.csvAsOfMs));
    if (favori.asOfMs <= csvAsOfMs) continue;

    const currentCashCad = clientAccounts.reduce(
      (total, account) => total + toCad(account.cashValue, account.currency),
      0,
    );
    const deltaCad = favori.cashCad - currentCashCad;
    if (Math.abs(deltaCad) < 0.01) continue;

    const share = (account: CashAccountLine) =>
      currentCashCad > 0
        ? toCad(account.cashValue, account.currency) / currentCashCad
        : 1 / clientAccounts.length;

    for (const account of clientAccounts) {
      const deltaNative = fromCad(deltaCad * share(account), account.currency);
      result.set(account.accountKey, account.cashValue + deltaNative);
    }
  }

  return result;
}

