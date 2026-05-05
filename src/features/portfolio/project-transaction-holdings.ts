import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";

type PositionTxCategory =
  | "BUY"
  | "SELL"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "STOCK_DIVIDEND";

type ProjectableTransaction = {
  accountKey: string | null;
  accountName: string | null;
  accountNumber: string | null;
  settlementDate: Date | null;
  tradeDate: Date | null;
  txCategory: string | null;
  ticker: string | null;
  securityName: string | null;
  currency: string | null;
  priceDevise: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
};

type PositionState = {
  accountKey: string;
  accountName: string | null;
  accountNumber: string | null;
  ticker: string;
  securityName: string | null;
  currency: string;
  quantity: number;
  costBasis: number;
  lastPrice: number | null;
  asOf: Date;
};

const PROJECTED_IMPORT_ID = "transactions-projection";
const KEY_SEPARATOR = "\u001F";
const POSITION_CATEGORIES = new Set<PositionTxCategory>([
  "BUY",
  "SELL",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "STOCK_DIVIDEND",
]);

function normalizeCurrency(currency: string | null | undefined): string {
  const raw = currency?.trim().toUpperCase();
  if (!raw || raw === "CAN" || raw === "CDN") return "CAD";
  if (raw === "US") return "USD";
  return raw;
}

function normalizeTickerForCurrency(ticker: string, currency: string): string {
  const raw = ticker.trim().toUpperCase();
  if (currency === "USD") {
    return raw.replace(/-U$/, "");
  }
  if (currency === "CAD" && !raw.endsWith("-C")) {
    return `${raw}-C`;
  }
  return raw;
}

function isTransferDescription(value: string): boolean {
  return /\b(TRSF|TRANSFERT|CONV\s*@|ARTICLE\s+146)/i.test(value);
}

function dateOnlyUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function txDate(tx: ProjectableTransaction): Date | null {
  return tx.settlementDate ?? tx.tradeDate;
}

function txKey(tx: ProjectableTransaction): string | null {
  if (!tx.accountKey || !tx.ticker || tx.ticker === "-" || !tx.quantity) return null;
  const category = tx.txCategory as PositionTxCategory | null;
  if (!category || !POSITION_CATEGORIES.has(category)) return null;
  const currency = normalizeCurrency(tx.priceDevise ?? tx.currency);
  const ticker = normalizeTickerForCurrency(tx.ticker, currency);
  return `${tx.accountKey}${KEY_SEPARATOR}${ticker}${KEY_SEPARATOR}${currency}`;
}

function applyTransaction(state: PositionState, tx: ProjectableTransaction) {
  const category = tx.txCategory as PositionTxCategory;
  const rawQuantity = Math.abs(tx.quantity ?? 0);
  if (rawQuantity <= 0) return;

  const signedQuantity =
    category === "SELL" || category === "TRANSFER_OUT" ? -rawQuantity : rawQuantity;
  const previousQuantity = state.quantity;
  state.quantity += signedQuantity;
  state.asOf = txDate(tx) ?? state.asOf;

  if (tx.securityName && !isTransferDescription(tx.securityName)) state.securityName = tx.securityName;
  if (tx.price && Number.isFinite(tx.price)) state.lastPrice = tx.price;

  if (signedQuantity > 0) {
    const cost =
      tx.amount !== null && tx.amount !== undefined
        ? Math.abs(tx.amount)
        : tx.price
          ? tx.price * signedQuantity
          : 0;
    state.costBasis += cost;
  } else if (previousQuantity > 0) {
    const averageCost = state.costBasis / previousQuantity;
    state.costBasis = Math.max(0, state.costBasis - averageCost * rawQuantity);
  }

  if (Math.abs(state.quantity) < 0.000001) {
    state.quantity = 0;
    state.costBasis = 0;
  }
}

function buildStateFromTransactions(transactions: ProjectableTransaction[]) {
  const states = new Map<string, PositionState>();
  const dailyEvents = new Map<string, Map<string, PositionState>>();

  for (const tx of transactions) {
    const key = txKey(tx);
    const date = txDate(tx);
    if (!key || !date) continue;

    const [accountKey, ticker, currency] = key.split(KEY_SEPARATOR);
    const state =
      states.get(key) ??
      ({
        accountKey,
        accountName: tx.accountName,
        accountNumber: tx.accountNumber,
        ticker,
        securityName:
          tx.securityName && !isTransferDescription(tx.securityName) ? tx.securityName : null,
        currency,
        quantity: 0,
        costBasis: 0,
        lastPrice: tx.price ?? null,
        asOf: date,
      } satisfies PositionState);

    applyTransaction(state, tx);
    states.set(key, state);

    const dayKey = dateOnlyUtc(date).toISOString();
    const dayMap = dailyEvents.get(dayKey) ?? new Map<string, PositionState>();
    dayMap.set(key, { ...state });
    dailyEvents.set(dayKey, dayMap);
  }

  return { states, dailyEvents };
}

async function accountStateByKey() {
  const rows = await prisma.portfolioAccountState.findMany({
    select: {
      accountKey: true,
      accountName: true,
      accountNumber: true,
    },
  });
  return new Map(rows.map((row) => [row.accountKey, row]));
}

async function replaceDailyHoldings(
  dailyEvents: Map<string, Map<string, PositionState>>,
  fromDate: Date | null,
  accountsByKey: Awaited<ReturnType<typeof accountStateByKey>>,
) {
  await prisma.portfolioDailyHolding.deleteMany({
    where: { source: "transactions" },
  });

  if (!fromDate) return 0;

  const eventDays = [...dailyEvents.keys()].sort();
  if (eventDays.length === 0) return 0;

  let cursor = dateOnlyUtc(fromDate);
  const today = dateOnlyUtc(new Date());
  const open = new Map<string, PositionState>();
  const rows: {
    id: string;
    holdingDate: Date;
    accountKey: string;
    accountName: string | null;
    accountNumber: string | null;
    ticker: string;
    securityName: string | null;
    currency: string;
    quantity: number;
    averageCost: number | null;
    source: string;
    updatedAt: Date;
  }[] = [];

  while (cursor <= today) {
    const dayEvents = dailyEvents.get(cursor.toISOString());
    if (dayEvents) {
      for (const [key, state] of dayEvents) {
        if (state.quantity > 0.000001) {
          open.set(key, state);
        } else {
          open.delete(key);
        }
      }
    }

    for (const state of open.values()) {
      const account = accountsByKey.get(state.accountKey);
      rows.push({
        id: randomUUID(),
        holdingDate: cursor,
        accountKey: state.accountKey,
        accountName: account?.accountName ?? state.accountName,
        accountNumber: account?.accountNumber ?? state.accountNumber,
        ticker: state.ticker,
        securityName: state.securityName,
        currency: state.currency,
        quantity: state.quantity,
        averageCost: state.quantity > 0 ? state.costBasis / state.quantity : null,
        source: "transactions",
        updatedAt: new Date(),
      });
    }

    cursor = addDays(cursor, 1);
  }

  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await prisma.portfolioDailyHolding.createMany({
      data: rows.slice(i, i + chunkSize),
      skipDuplicates: true,
    });
  }

  return rows.length;
}

export async function projectHoldingsFromTransactions() {
  const transactions = await prisma.portfolioTransactionLine.findMany({
    where: {
      accountKey: { not: null },
      ticker: { not: null },
      quantity: { not: null },
      txCategory: { in: [...POSITION_CATEGORIES] },
    },
    orderBy: [{ settlementDate: "asc" }, { tradeDate: "asc" }, { id: "asc" }],
    select: {
      accountKey: true,
      accountName: true,
      accountNumber: true,
      settlementDate: true,
      tradeDate: true,
      txCategory: true,
      ticker: true,
      securityName: true,
      currency: true,
      priceDevise: true,
      quantity: true,
      price: true,
      amount: true,
    },
  });

  const { states, dailyEvents } = buildStateFromTransactions(transactions);
  const openStates = [...states.values()].filter((state) => state.quantity > 0.000001);
  const accountsByKey = await accountStateByKey();
  const datedTransactions = transactions
    .map(txDate)
    .filter((date): date is Date => date !== null);
  const earliestDate =
    datedTransactions.toSorted((a, b) => a.getTime() - b.getTime())[0] ?? null;

  for (const state of openStates) {
    const account = accountsByKey.get(state.accountKey);
    const accountName = account?.accountName ?? state.accountName ?? state.accountKey;
    const accountNumber = account?.accountNumber ?? state.accountNumber;

    await prisma.portfolioHolding.upsert({
      where: {
        accountKey_ticker_currency: {
          accountKey: state.accountKey,
          ticker: state.ticker,
          currency: state.currency,
        },
      },
      create: {
        accountKey: state.accountKey,
        accountName,
        accountNumber,
        ticker: state.ticker,
        securityName: state.securityName,
        currency: state.currency,
        quantity: state.quantity,
        averageCost: state.quantity > 0 ? state.costBasis / state.quantity : null,
        snapshotPrice: state.lastPrice,
        snapshotValue: state.lastPrice ? state.quantity * state.lastPrice : state.costBasis,
        asOf: state.asOf,
        sourceImportId: PROJECTED_IMPORT_ID,
      },
      update: {
        accountName,
        accountNumber,
        securityName: state.securityName,
        quantity: state.quantity,
        averageCost: state.quantity > 0 ? state.costBasis / state.quantity : null,
        snapshotPrice: state.lastPrice,
        snapshotValue: state.lastPrice ? state.quantity * state.lastPrice : state.costBasis,
        asOf: state.asOf,
        sourceImportId: PROJECTED_IMPORT_ID,
      },
    });
  }

  const openKeys = new Set(
    openStates.map((state) => `${state.accountKey}${KEY_SEPARATOR}${state.ticker}${KEY_SEPARATOR}${state.currency}`),
  );
  const projectedHoldings = await prisma.portfolioHolding.findMany({
    where: { sourceImportId: PROJECTED_IMPORT_ID },
    select: { accountKey: true, ticker: true, currency: true },
  });
  const staleProjectedHoldings = projectedHoldings.filter(
    (holding) =>
      !openKeys.has(
        `${holding.accountKey}${KEY_SEPARATOR}${holding.ticker}${KEY_SEPARATOR}${holding.currency}`,
      ),
  );
  if (staleProjectedHoldings.length > 0) {
    await prisma.portfolioHolding.deleteMany({
      where: {
        sourceImportId: PROJECTED_IMPORT_ID,
        OR: staleProjectedHoldings.map((holding) => ({
          accountKey: holding.accountKey,
          ticker: holding.ticker,
          currency: holding.currency,
        })),
      },
    });
  }

  const dailyRowsProjected = await replaceDailyHoldings(dailyEvents, earliestDate, accountsByKey);

  return {
    transactionsConsidered: transactions.length,
    currentHoldingsProjected: openStates.length,
    dailyRowsProjected,
    fromDate: earliestDate,
    toDate: new Date(),
  };
}
