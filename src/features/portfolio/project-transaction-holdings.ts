import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import {
  GLOBAL_TRANSACTION_DUPLICATE_SCOPE,
  txFingerprint,
} from "@/lib/csv/tx-fingerprint";
import { categorizeTxType } from "@/lib/csv/tx-category";
import {
  extractDisnatStemForPositionAggregation,
  normalizeDisnatTickerForPortfolio,
} from "@/lib/market/disnat-ticker";
import type { TxCategory } from "@/generated/prisma/enums";

type ProjectableTransaction = {
  id: string;
  accountKey: string | null;
  accountName: string | null;
  accountNumber: string | null;
  settlementDate: Date | null;
  tradeDate: Date | null;
  transactionType: string | null;
  txCategory: TxCategory | null;
  ticker: string | null;
  securityName: string | null;
  currency: string | null;
  priceDevise: string | null;
  /** Marché (« USA », « TSX », …) — renseigné sur beaucoup d’achats, souvent « - » sur transferts. */
  market: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  /** Classe d'actif Disnat brute sur la ligne d'opération (Actions, FNB, …). */
  assetClass: string | null;
  fees: number | null;
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
  /** Dernière classe d'actif connue sur une opération liée à cette position. */
  assetType: string | null;
};

/** Identifiant `sourceImportId` des lignes issues de `projectHoldingsFromTransactions`. */
export const PROJECTED_HOLDINGS_SOURCE_ID = "transactions-projection";
const KEY_SEPARATOR = "\u001F";

/** Types Disnat qui peuvent déplacer des titres ou des quantités signées importées telles quelles. */
const POSITION_CATEGORIES = new Set<TxCategory>([
  "BUY",
  "SELL",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "STOCK_DIVIDEND",
  "EXCHANGE",
  "CONTRIBUTION",
  "INTERNAL_TRANSFER",
  "REVERSAL",
  "TERMINATION",
  "STOCK_SPLIT",
]);

/**
 * Catégorie pour la projection de positions : priorité à la valeur persistée si elle
 * participe aux mouvements de titre ; sinon repli sur le libellé brut Disnat (ex. ACHAT
 * encore stocké en OTHER ou txCategory null).
 */
function resolvePositionCategory(tx: ProjectableTransaction): TxCategory | null {
  const raw = tx.txCategory;
  if (raw && POSITION_CATEGORIES.has(raw)) return raw;
  const inferred = categorizeTxType(tx.transactionType);
  return POSITION_CATEGORIES.has(inferred) ? inferred : null;
}

function normalizeCurrency(currency: string | null | undefined): string {
  const raw = currency?.trim().toUpperCase();
  if (!raw || raw === "CAN" || raw === "CDN") return "CAD";
  if (raw === "US") return "USD";
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

function signedQuantityForPosition(tx: ProjectableTransaction): number | null {
  if (tx.quantity === null || tx.quantity === undefined) return null;
  if (tx.ticker === "-" || !tx.ticker?.trim()) return null;
  const q = tx.quantity;
  if (Math.abs(q) < 1e-9) return null;

  const category = resolvePositionCategory(tx);
  if (!category) return null;

  switch (category) {
    case "BUY":
    case "TRANSFER_IN":
    case "STOCK_DIVIDEND":
      return Math.abs(q);
    case "SELL":
    case "TRANSFER_OUT":
      return -Math.abs(q);
    case "EXCHANGE":
    case "CONTRIBUTION":
    case "INTERNAL_TRANSFER":
    case "TERMINATION":
    case "STOCK_SPLIT":
      return q;
    case "REVERSAL": {
      // Prix d’opération → mouvement de titre classique.
      const p = tx.price;
      if (p !== null && p !== undefined && Number.isFinite(p) && p !== 0) {
        return q;
      }
      // Sans prix : annulation de dividende / clawback cash (montant ≠ 0) → ne pas rejouer la quantité.
      // Montant ~ 0 (ex. annulation de transfert d’actions) → rejouer la quantité signée.
      const amt = tx.amount;
      const cashAbs =
        amt !== null && amt !== undefined && Number.isFinite(amt) ? Math.abs(amt) : 0;
      if (cashAbs > 0.01) return null;
      return q;
    }
    default:
      return null;
  }
}

/**
 * Indice par ligne : devise de **cotation du titre** (pas seulement « devise du prix » sur cette ligne).
 * Les transferts sortants peuvent avoir Devise du prix = CAN alors que le titre suit encore la cote US
 * (ex. achat `AMZN-U` puis transfert libellé `AMZN`), d’où des positions fantômes si on lit seulement priceDevise.
 */
function inferListingCurrencyHintFromRow(tx: ProjectableTransaction): "USD" | "CAD" | null {
  const raw = tx.ticker?.trim().toUpperCase() ?? "";
  if (!raw || raw === "-") return null;
  if (raw.endsWith("-U")) return "USD";
  if (raw.endsWith("-C")) return "CAD";
  if (normalizeCurrency(tx.priceDevise) === "USD") return "USD";
  const m = tx.market?.trim().toUpperCase() ?? "";
  if (m && m !== "-" && !/^N\/?A$/i.test(m)) {
    if (
      /\b(USA|US|NYSE|NASDAQ|AMERIQUE|AMÉRICAIN|AMERICAIN|ÉTATS-UNIS|ETATS-UNIS)\b/.test(m) ||
      m === "US"
    ) {
      return "USD";
    }
    if (/\b(TSX|TSXV|CSE|TORONTO|CANADA|VENTURE)\b/.test(m)) {
      return "CAD";
    }
  }
  return null;
}

/**
 * Par (compte + tige de titre), choisit une devise de cotation unique pour toute la chaîne d’opérations.
 * Priorité USD si une seule ligne US est vue (typique : achat -U puis transfert sans suffixe).
 */
function buildStemListingPreferences(transactions: ProjectableTransaction[]): Map<string, "USD" | "CAD"> {
  const map = new Map<string, "USD" | "CAD">();
  for (const tx of transactions) {
    if (!tx.accountKey) continue;
    const tr = tx.ticker?.trim();
    if (!tr || tr === "-") continue;
    if (signedQuantityForPosition(tx) === null) continue;

    const stem = extractDisnatStemForPositionAggregation(tr);
    const key = `${tx.accountKey}${KEY_SEPARATOR}${stem}`;
    const hint = inferListingCurrencyHintFromRow(tx);
    if (hint === "USD") {
      map.set(key, "USD");
    } else if (hint === "CAD" && map.get(key) !== "USD") {
      map.set(key, "CAD");
    }
  }
  /* Priorité CAD pour une tige dès qu’un titre -C apparaît sur un compte en dollars canadiens
   * (évite qu’un dividende en actions ou une ligne « prix en USD » fige le stem en USD et isole les ACHAT VFV-C). */
  for (const tx of transactions) {
    if (!tx.accountKey) continue;
    const tr = tx.ticker?.trim();
    if (!tr || tr === "-") continue;
    if (!tr.toUpperCase().endsWith("-C")) continue;
    if (normalizeCurrency(tx.currency) !== "CAD") continue;
    const stem = extractDisnatStemForPositionAggregation(tr);
    const key = `${tx.accountKey}${KEY_SEPARATOR}${stem}`;
    map.set(key, "CAD");
  }
  return map;
}

/**
 * Résout la devise retenue pour la clé de position (et pour Yahoo : titre US → USD).
 */
function listingCurrencyForPosition(
  tx: ProjectableTransaction,
  stemListing: Map<string, "USD" | "CAD">,
): "USD" | "CAD" {
  const acctKey = tx.accountKey;
  const tr = tx.ticker?.trim();
  if (!acctKey || !tr) return "CAD";

  const stem = extractDisnatStemForPositionAggregation(tr);
  const mapKey = `${acctKey}${KEY_SEPARATOR}${stem}`;
  const raw = tr.toUpperCase();
  /* TSX (-C) sur compte CAD : ne pas suivre un stem figé en USD par une autre opération. */
  if (raw.endsWith("-C") && normalizeCurrency(tx.currency) === "CAD") {
    return "CAD";
  }

  const pref = stemListing.get(mapKey);
  if (pref) return pref;

  if (raw.endsWith("-C")) return "CAD";
  if (normalizeCurrency(tx.priceDevise) === "USD") return "USD";
  if (raw.endsWith("-U")) return "USD";

  /* Dernier repli : compte en CAD → cotation TSX (-C) ; compte en USD rare. */
  return normalizeCurrency(tx.currency) === "USD" ? "USD" : "CAD";
}

function txKey(tx: ProjectableTransaction, stemListing: Map<string, "USD" | "CAD">): string | null {
  if (!tx.accountKey) return null;
  const tickerRaw = tx.ticker?.trim();
  if (!tickerRaw || tickerRaw === "-") return null;
  const signed = signedQuantityForPosition(tx);
  if (signed === null) return null;

  const listingCurrency = listingCurrencyForPosition(tx, stemListing);
  const ticker = normalizeDisnatTickerForPortfolio(tickerRaw.toUpperCase(), listingCurrency);
  return `${tx.accountKey}${KEY_SEPARATOR}${ticker}${KEY_SEPARATOR}${listingCurrency}`;
}

function fingerprintInput(tx: ProjectableTransaction) {
  return {
    tradeDate: tx.tradeDate,
    settlementDate: tx.settlementDate,
    transactionType: tx.transactionType,
    ticker: tx.ticker,
    amount: tx.amount,
    currency: tx.currency,
    quantity: tx.quantity,
    price: tx.price,
    securityName: tx.securityName,
  };
}

function normalizeAssetClassLabel(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s || s === "-") return null;
  return s;
}

/** Coût d’entrée pour une augmentation de position : montant signifiant, sinon prix × qté. */
function costForLotIncrease(tx: ProjectableTransaction, signedQuantity: number): number {
  if (
    tx.amount !== null &&
    tx.amount !== undefined &&
    Number.isFinite(tx.amount) &&
    Math.abs(tx.amount) > 1e-6
  ) {
    return Math.abs(tx.amount);
  }
  if (
    tx.price !== null &&
    tx.price !== undefined &&
    Number.isFinite(tx.price) &&
    tx.price > 0
  ) {
    return tx.price * signedQuantity;
  }
  return 0;
}

/**
 * Recalcule quantité + coût de base en faisant correspondre uniquement le ticker
 * normalisé sous une devise de cotation donnée (sans txKey / stem map).
 */
function replayPositionCostForListing(
  state: PositionState,
  transactions: ProjectableTransaction[],
  listing: "USD" | "CAD",
): { quantity: number; costBasis: number } {
  let quantity = 0;
  let costBasis = 0;

  for (const tx of transactions) {
    if (tx.accountKey !== state.accountKey) continue;
    const tr = tx.ticker?.trim();
    if (!tr || tr === "-") continue;
    const norm = normalizeDisnatTickerForPortfolio(tr.toUpperCase(), listing);
    if (norm !== state.ticker) continue;
    const date = txDate(tx);
    if (!date) continue;
    const signed = signedQuantityForPosition(tx);
    if (signed === null || signed === 0) continue;

    const rawQuantity = Math.abs(signed);
    const previousQuantity = quantity;
    quantity += signed;

    if (signed > 0) {
      costBasis += costForLotIncrease(tx, signed);
    } else if (previousQuantity > 0) {
      const averageCost = costBasis / previousQuantity;
      costBasis = Math.max(0, costBasis - averageCost * rawQuantity);
    }

    if (Math.abs(quantity) < 0.000001) {
      quantity = 0;
      costBasis = 0;
    }
  }

  return { quantity, costBasis };
}

function applyTransaction(state: PositionState, tx: ProjectableTransaction) {
  const signedQuantity = signedQuantityForPosition(tx);
  if (signedQuantity === null || signedQuantity === 0) return;

  const rawQuantity = Math.abs(signedQuantity);
  const previousQuantity = state.quantity;
  state.quantity += signedQuantity;
  state.asOf = txDate(tx) ?? state.asOf;

  const assetLabel = normalizeAssetClassLabel(tx.assetClass);
  if (assetLabel) state.assetType = assetLabel;

  if (tx.securityName && !isTransferDescription(tx.securityName)) state.securityName = tx.securityName;
  if (tx.price && Number.isFinite(tx.price)) state.lastPrice = tx.price;

  if (signedQuantity > 0) {
    state.costBasis += costForLotIncrease(tx, signedQuantity);
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
  const stemListing = buildStemListingPreferences(transactions);
  const states = new Map<string, PositionState>();
  const dailyEvents = new Map<string, Map<string, PositionState>>();

  for (const tx of transactions) {
    const key = txKey(tx, stemListing);
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
        assetType: normalizeAssetClassLabel(tx.assetClass),
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

/** Supprime les doublons strictement identiques (même opération importée sous deux comptes). */
function dedupeGlobalTransactions(transactions: ProjectableTransaction[]) {
  const byFp = new Map<string, ProjectableTransaction>();
  for (const tx of transactions) {
    const ak = tx.accountKey ?? GLOBAL_TRANSACTION_DUPLICATE_SCOPE;
    const fp = txFingerprint(ak, fingerprintInput(tx));
    if (!byFp.has(fp)) byFp.set(fp, tx);
  }
  return [...byFp.values()].toSorted((a, b) => {
    const da = txDate(a)?.getTime() ?? 0;
    const db = txDate(b)?.getTime() ?? 0;
    if (da !== db) return da - db;
    return a.id.localeCompare(b.id);
  });
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
  const raw = await prisma.portfolioTransactionLine.findMany({
    where: {
      accountKey: { not: null },
      ticker: { not: null },
      quantity: { not: null },
    },
    orderBy: [{ settlementDate: "asc" }, { tradeDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      accountKey: true,
      accountName: true,
      accountNumber: true,
      settlementDate: true,
      tradeDate: true,
      transactionType: true,
      txCategory: true,
      ticker: true,
      securityName: true,
      currency: true,
      priceDevise: true,
      market: true,
      quantity: true,
      price: true,
      amount: true,
      assetClass: true,
      fees: true,
    },
  });

  const transactions = dedupeGlobalTransactions(raw as ProjectableTransaction[]);

  const { states, dailyEvents } = buildStateFromTransactions(transactions);
  const openStates = [...states.values()].filter((state) => state.quantity > 0.000001);

  const qtyTolerance = (q: number) => Math.max(0.02, Math.abs(q) * 0.002);
  for (const state of openStates) {
    const preferred: "USD" | "CAD" = normalizeCurrency(state.currency) === "USD" ? "USD" : "CAD";
    const alternate: "USD" | "CAD" = preferred === "USD" ? "CAD" : "USD";
    const tol = qtyTolerance(state.quantity);
    let replayed = replayPositionCostForListing(state, transactions, preferred);
    if (Math.abs(replayed.quantity - state.quantity) > tol) {
      const r2 = replayPositionCostForListing(state, transactions, alternate);
      if (Math.abs(r2.quantity - state.quantity) < Math.abs(replayed.quantity - state.quantity)) {
        replayed = r2;
      }
    }
    if (Math.abs(replayed.quantity - state.quantity) <= tol) {
      state.costBasis = replayed.costBasis;
    } else if (
      state.costBasis < 1e-4 &&
      replayed.costBasis > 1 &&
      Math.abs(replayed.quantity - state.quantity) <= Math.max(0.05, Math.abs(state.quantity) * 0.05)
    ) {
      state.costBasis = replayed.costBasis;
    }
  }

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
        sourceImportId: PROJECTED_HOLDINGS_SOURCE_ID,
        assetType: state.assetType,
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
        sourceImportId: PROJECTED_HOLDINGS_SOURCE_ID,
        assetType: state.assetType,
      },
    });
  }

  const openKeys = new Set(
    openStates.map((state) => `${state.accountKey}${KEY_SEPARATOR}${state.ticker}${KEY_SEPARATOR}${state.currency}`),
  );
  const projectedHoldings = await prisma.portfolioHolding.findMany({
    where: { sourceImportId: PROJECTED_HOLDINGS_SOURCE_ID },
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
        sourceImportId: PROJECTED_HOLDINGS_SOURCE_ID,
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
    transactionsRaw: raw.length,
    currentHoldingsProjected: openStates.length,
    dailyRowsProjected,
    fromDate: earliestDate,
    toDate: new Date(),
  };
}

/** Ligne opération renvoyée pour le détail « position → transactions » (UI). */
export type HoldingRelatedTransactionRow = {
  id: string;
  tradeDate: Date | null;
  settlementDate: Date | null;
  transactionType: string | null;
  txCategory: TxCategory | null;
  ticker: string | null;
  securityName: string | null;
  market: string | null;
  currency: string | null;
  priceDevise: string | null;
  assetClass: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  fees: number | null;
};

/**
 * Opérations reliées à une ligne titre projetée : même logique de clé que la projection,
 * plus les lignes même tige / même marché (ex. dividendes) sans mouvement de quantité projeté.
 */
export async function getTransactionLinesForProjectedHolding(params: {
  accountKey: string;
  ticker: string;
  currency: string;
}): Promise<HoldingRelatedTransactionRow[]> {
  const raw = await prisma.portfolioTransactionLine.findMany({
    where: { accountKey: params.accountKey },
    orderBy: [{ settlementDate: "asc" }, { tradeDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      accountKey: true,
      accountName: true,
      accountNumber: true,
      settlementDate: true,
      tradeDate: true,
      transactionType: true,
      txCategory: true,
      ticker: true,
      securityName: true,
      currency: true,
      priceDevise: true,
      market: true,
      quantity: true,
      price: true,
      amount: true,
      assetClass: true,
      fees: true,
    },
  });

  const transactions = dedupeGlobalTransactions(raw as ProjectableTransaction[]);
  const stemListing = buildStemListingPreferences(transactions);
  const curNorm = normalizeCurrency(params.currency);
  const targetKey = `${params.accountKey}${KEY_SEPARATOR}${params.ticker}${KEY_SEPARATOR}${curNorm}`;

  const matched = transactions.filter((tx) => {
    const key = txKey(tx, stemListing);
    if (key === targetKey) return true;
    if (!tx.ticker || tx.ticker.trim() === "-") return false;
    if (tx.accountKey !== params.accountKey) return false;
    const stem = extractDisnatStemForPositionAggregation(tx.ticker);
    const stemH = extractDisnatStemForPositionAggregation(params.ticker);
    if (stem !== stemH) return false;
    const listCur = listingCurrencyForPosition(tx, stemListing);
    return listCur === curNorm;
  });

  return matched.map((tx) => ({
    id: tx.id,
    tradeDate: tx.tradeDate,
    settlementDate: tx.settlementDate,
    transactionType: tx.transactionType,
    txCategory: tx.txCategory,
    ticker: tx.ticker,
    securityName: tx.securityName,
    market: tx.market,
    currency: tx.currency,
    priceDevise: tx.priceDevise,
    assetClass: tx.assetClass ?? null,
    quantity: tx.quantity,
    price: tx.price,
    amount: tx.amount,
    fees: tx.fees,
  }));
}
