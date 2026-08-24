import { isoDateInToronto } from "@/lib/market/equity-session";
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

    const date = isoDateInToronto(effective);
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

export function cashLedgerReliableForAccount(
  accountKey: string,
  ledgers: Record<string, AccountCashLedgerPoint[]>,
  earliestTitresAsOf: string | null,
  latestTitresAsOf: string | null = null,
): boolean {
  const series = ledgers[accountKey];
  if (!series || series.length === 0) return true;

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
