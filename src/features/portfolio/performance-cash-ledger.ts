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
  "WITHHOLDING_TAX",
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
