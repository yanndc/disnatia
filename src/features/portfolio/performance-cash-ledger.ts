import { isoDateFromDbTimestamp } from "./daily-close-key";
import { resolveFlowEffectiveDate } from "./performance-cash-flows";

const CASH_LEDGER_CATEGORIES = new Set([
  "CONTRIBUTION",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "INTERNAL_TRANSFER",
  "DIVIDEND",
  "SELL",
  "BUY",
  "FEE",
  "INTEREST",
  "TAX_WITHHOLD",
]);

export type CashLedgerTx = {
  accountKey: string | null;
  tradeDate: Date | null;
  settlementDate: Date | null;
  txCategory: string | null;
  amount: number | null;
  currency: string | null;
};

export type AccountCashLedgerPoint = {
  date: string;
  balanceCad: number;
};

function toCad(amount: number, currency: string, usdToCad: number | null): number {
  if (currency.toUpperCase() === "USD" && usdToCad != null && usdToCad > 0) {
    return amount * usdToCad;
  }
  return amount;
}

/** Soldes cash cumulés par compte (ledger simplifié à partir des transactions). */
export function buildAccountCashLedgers(
  rows: CashLedgerTx[],
  usdToCad: number | null,
): Record<string, AccountCashLedgerPoint[]> {
  const byAccount = new Map<string, Map<string, number>>();

  for (const tx of rows) {
    if (!tx.accountKey || !tx.txCategory) continue;
    if (!CASH_LEDGER_CATEGORIES.has(tx.txCategory)) continue;
    const effective = resolveFlowEffectiveDate(tx.tradeDate, tx.settlementDate);
    if (!effective) continue;
    const amount = tx.amount;
    if (amount === null || !Number.isFinite(amount)) continue;

    const date = isoDateFromDbTimestamp(effective);
    const delta = toCad(amount, tx.currency ?? "CAD", usdToCad);
    const dates = byAccount.get(tx.accountKey) ?? new Map<string, number>();
    dates.set(date, (dates.get(date) ?? 0) + delta);
    byAccount.set(tx.accountKey, dates);
  }

  const out: Record<string, AccountCashLedgerPoint[]> = {};
  for (const [accountKey, deltas] of byAccount) {
    let balance = 0;
    const points = [...deltas.entries()]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([date, delta]) => {
        balance += delta;
        return { date, balanceCad: balance };
      });
    out[accountKey] = points;
  }
  return out;
}

/**
 * Le ledger cash est un solde CUMULATIF construit à partir des transactions connues en base —
 * pas un solde absolu réel. S'il démarre nettement APRÈS le début de l'historique titres connu
 * pour ce compte, un financement initial (ou une activité cash antérieure) est probablement
 * manquant en base, et le delta cash calculé sur une fenêtre qui chevauche ce trou serait faux.
 * Dans ce cas on désactive l'usage du ledger pour ce compte (retour à titres seuls).
 * Si le ledger démarre à/avant le début de l'historique titres (ou n'a aucune donnée), il est
 * considéré fiable — un solde constant (delta nul) n'a de toute façon aucun effet sur un calcul
 * de delta BMV/EMV.
 *
 * Trois garde-fous supplémentaires (audit 2026-11) :
 * - **solde négatif** : une encaisse négative = financement initial non importé → fiable = false
 *   (les comptes Disnat suivis ici ne sont pas sur marge) ;
 * - **péremption** : plus d'écriture cash depuis longtemps alors que les titres ont continué ;
 * - **écart avec l'encaisse réelle** du dernier import (`total − market`, seule mesure
 *   indépendante disponible) : au-delà de la tolérance, le ledger est rejeté.
 */
const CASH_LEDGER_GAP_TOLERANCE_DAYS = 45;

/**
 * Si le ledger d'un compte n'a plus reçu la moindre transaction cash (dépôt, dividende,
 * intérêt, achat/vente...) depuis longtemps alors que ce compte a continué à avoir de
 * l'activité titres (holdings/imports plus récents), c'est le signe que le suivi cash s'est
 * arrêté en base pour ce compte (ex. import incomplet) plutôt qu'un compte réellement inactif.
 * Le solde cumulé figé (souvent négatif de façon persistante, ex. financement initial non
 * importé) n'est alors plus représentatif au-delà de ce point mort — on désactive le ledger.
 */
const CASH_LEDGER_STALENESS_TOLERANCE_DAYS = 90;

/** En dessous de ce solde (négatif), l'encaisse reconstruite est jugée impossible. */
const CASH_LEDGER_MIN_PLAUSIBLE_CAD = -1;

/** Tolérance (en $ ou 50 % de l'encaisse réelle) sur l'écart ledger ↔ encaisse importée. */
const CASH_LEDGER_IMPORT_TOLERANCE_MIN_CAD = 100;
const CASH_LEDGER_IMPORT_TOLERANCE_RATIO = 0.5;

export function cashLedgerReliableForAccount(
  accountKey: string,
  ledgers: Record<string, AccountCashLedgerPoint[]>,
  earliestTitresAsOf: string | null,
  latestTitresAsOf: string | null = null,
  /** Encaisse réelle observée dans un import (total − valeur marché), pour contrôle. */
  expectedCash?: { asOf: string; cad: number } | null,
): boolean {
  const series = ledgers[accountKey];
  if (!series || series.length === 0) return true;

  const minBalance = Math.min(...series.map((p) => p.balanceCad));
  if (minBalance < CASH_LEDGER_MIN_PLAUSIBLE_CAD) return false;

  if (earliestTitresAsOf) {
    const earliestMs = Date.parse(earliestTitresAsOf);
    const ledgerStartMs = Date.parse(series[0]!.date);
    if (Number.isFinite(earliestMs) && Number.isFinite(ledgerStartMs)) {
      const toleranceMs = CASH_LEDGER_GAP_TOLERANCE_DAYS * 24 * 60 * 60 * 1000;
      if (ledgerStartMs - earliestMs > toleranceMs) return false;
    }
  }

  if (latestTitresAsOf) {
    const latestMs = Date.parse(latestTitresAsOf);
    const ledgerEndMs = Date.parse(series[series.length - 1]!.date);
    if (Number.isFinite(latestMs) && Number.isFinite(ledgerEndMs)) {
      const staleToleranceMs =
        CASH_LEDGER_STALENESS_TOLERANCE_DAYS * 24 * 60 * 60 * 1000;
      if (latestMs - ledgerEndMs > staleToleranceMs) return false;
    }
  }

  if (expectedCash && Number.isFinite(expectedCash.cad)) {
    const balanceAtImport = cashCadAtOrBefore([accountKey], ledgers, expectedCash.asOf);
    const tolerance = Math.max(
      CASH_LEDGER_IMPORT_TOLERANCE_MIN_CAD,
      Math.abs(expectedCash.cad) * CASH_LEDGER_IMPORT_TOLERANCE_RATIO,
    );
    if (Math.abs(balanceAtImport - expectedCash.cad) > tolerance) return false;
  }

  return true;
}

/** Solde cash (CAD) au plus tard à `targetDate`. */
export function cashCadAtOrBefore(
  accountKeys: string[],
  ledgers: Record<string, AccountCashLedgerPoint[]>,
  targetDate: string,
): number {
  let total = 0;
  for (const key of accountKeys) {
    const series = ledgers[key] ?? [];
    let balance = 0;
    for (const pt of series) {
      if (pt.date > targetDate) break;
      balance = pt.balanceCad;
    }
    total += balance;
  }
  return total;
}
