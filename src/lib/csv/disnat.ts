import Papa from "papaparse";
import { z } from "zod";
import type {
  CsvImportKind,
  NormalizedDisnatAccount,
  NormalizedDisnatPosition,
  NormalizedDisnatTransaction,
  ParsedDisnatRow,
  PortfolioSnapshotInput,
} from "@/types/portfolio";

const normalizedPositionSchema = z.object({
  accountName: z.string().min(1),
  accountType: z.string().optional(),
  ticker: z.string().min(1),
  securityName: z.string().optional(),
  currency: z.string().min(3).max(3),
  quantity: z.number(),
  averageCost: z.number().optional(),
  marketPrice: z.number().optional(),
  marketValue: z.number(),
  unrealizedGainLoss: z.number().optional(),
  sector: z.string().optional(),
  assetType: z.string().optional(),
});

const columnAliases = {
  accountName: ["compte", "account", "account name", "nom du compte"],
  accountType: ["type de compte", "account type"],
  ticker: ["symbole", "ticker", "symbol", "titre", "security symbol"],
  securityName: ["nom", "description", "security name", "nom du titre"],
  currency: ["devise", "currency", "monnaie"],
  quantity: ["quantite", "quantité", "qte", "qté", "qt", "quantity", "qty"],
  averageCost: ["cout moyen", "coût moyen", "cot moyen", "average cost", "avg cost"],
  marketPrice: ["prix", "prix actuel", "market price", "last price", "cours"],
  marketValue: [
    "valeur marchande",
    "market value",
    "valeur au marche",
    "valeur au marché",
    "valeur au march",
    "valeur des titres",
  ],
  totalValue: ["valeur totale", "total value"],
  unrealizedGainLoss: [
    "gain/perte",
    "unrealized gain/loss",
    "gain non realise",
    "profits non realises",
    "profits non réalisés",
    "profits non raliss",
  ],
  cashValue: ["encaisse", "cash", "cash value", "solde"],
  sector: ["secteur", "sector"],
  assetType: ["type actif", "asset type", "categorie", "catégorie"],
  tradeDate: ["date", "date de transaction", "date de la transaction", "trade date"],
  settlementDate: [
    "date de reglement",
    "date de règlement",
    "date d'inscription",
    "settlement date",
  ],
  transactionType: [
    "type",
    "operation",
    "opération",
    "transaction",
    "activité",
    "categorie",
    "catégorie",
    "catgorie",
  ],
  accountNumber: [
    "numero de compte",
    "numéro de compte",
    "numro de carte",
    "numero de carte",
    "account number",
  ],
  amount: ["montant", "amount", "net amount", "montant net"],
  debit: ["debit", "débit", "dbit"],
  credit: ["credit", "crédit", "crdit"],
  fees: ["frais", "commission", "fees"],
} as const;

export function parseDisnatCsv(fileText: string) {
  const delimiter = detectDelimiter(fileText);
  const lines = fileText
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);
  const headerIndex = lines.findIndex((line) => isDisnatHeaderLine(line, delimiter));
  const parseableLines =
    headerIndex >= 0
      ? lines
          .slice(headerIndex)
          .filter((line) => line.includes(delimiter) && line.split(delimiter).length >= 3)
      : lines;
  const rawResult = Papa.parse<string[]>(parseableLines.join("\n"), {
    delimiter,
    header: false,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  const headerCells = (rawResult.data[0] ?? []).map((header, index) =>
    header.trim() || `Colonne ${index + 1}`,
  );
  const rows = rawResult.data
    .slice(1)
    .filter((cells) => !isHeaderCells(cells))
    .map((cells) => rowFromCells(headerCells, cells))
    .filter((row) =>
    Object.values(row).some((value) => String(value ?? "").trim().length > 0),
  );

  const importKind = detectImportKind(headerCells, rows);

  return {
    importKind,
    headers: headerCells,
    rows,
    errors: rawResult.errors.map((error) => ({
      row: error.row,
      message: error.message,
    })),
  };
}

export function normalizeDisnatRows(
  rows: ParsedDisnatRow[],
): PortfolioSnapshotInput {
  const warnings: string[] = [];
  const positions: NormalizedDisnatPosition[] = [];
  const transactions: NormalizedDisnatTransaction[] = [];
  const cashByAccount = new Map<string, NormalizedDisnatAccount>();
  const importKind = detectImportKind(Object.keys(rows[0] ?? {}), rows);

  rows.forEach((row, index) => {
    const ticker = readText(row, columnAliases.ticker);
    const accountName =
      readText(row, columnAliases.accountName) ||
      readText(row, ["nom", "name"]) ||
      "Compte Disnat";
    const currency = inferCurrency(row);
    const marketValue = readMoney(row, columnAliases.marketValue);
    const totalValue = readMoney(row, columnAliases.totalValue);
    const cashValue = readMoney(row, columnAliases.cashValue);
    const transaction = normalizeTransaction(row);

    if (isSummaryOrHeaderLabel(accountName)) {
      return;
    }

    if (transaction) {
      transactions.push(transaction);
      return;
    }

    if (!ticker && (cashValue !== undefined || marketValue !== undefined || totalValue !== undefined)) {
      upsertAccount(cashByAccount, {
        accountName,
        accountType: readText(row, columnAliases.accountType) || undefined,
        currency,
        cashValue: cashValue ?? Math.max((totalValue ?? 0) - (marketValue ?? 0), 0),
        marketValue: marketValue ?? Math.max((totalValue ?? 0) - (cashValue ?? 0), 0),
        totalValue: totalValue ?? (cashValue ?? 0) + (marketValue ?? 0),
      });
      return;
    }

    if (!ticker || marketValue === undefined) {
      if (importKind !== "TRANSACTIONS") {
        warnings.push(
          `Ligne ${index + 2}: ticker ou valeur marchande manquant, ligne ignorée.`,
        );
      }
      return;
    }

    const candidate = {
      accountName,
      accountType: readText(row, columnAliases.accountType) || undefined,
      ticker: ticker.toUpperCase(),
      securityName: readText(row, columnAliases.securityName) || undefined,
      currency,
      quantity: readMoney(row, columnAliases.quantity) ?? 0,
      averageCost: readMoney(row, columnAliases.averageCost),
      marketPrice: readMoney(row, columnAliases.marketPrice),
      marketValue,
      unrealizedGainLoss: readMoney(row, columnAliases.unrealizedGainLoss),
      sector: readText(row, columnAliases.sector) || undefined,
      assetType: readText(row, columnAliases.assetType) || undefined,
    };

    const parsed = normalizedPositionSchema.safeParse(candidate);
    if (!parsed.success) {
      warnings.push(`Ligne ${index + 2}: format invalide pour ${ticker}.`);
      return;
    }

    positions.push(parsed.data);
    upsertAccount(cashByAccount, {
      accountName,
      accountType: parsed.data.accountType,
      currency,
      cashValue: 0,
      marketValue,
      totalValue: marketValue,
    });
  });

  const totalMarketValue = positions.reduce(
    (sum, position) => sum + position.marketValue,
    0,
  );

  return {
    importKind,
    accounts: Array.from(cashByAccount.values()).map((account) => ({
      ...account,
      totalValue: account.cashValue + account.marketValue,
    })),
    positions: positions.map((position) => ({
      ...position,
      weightPct:
        totalMarketValue > 0 ? (position.marketValue / totalMarketValue) * 100 : 0,
    })),
    transactions,
    warnings,
  };
}

export function buildPortfolioSnapshot(
  normalizedRows: ParsedDisnatRow[],
): PortfolioSnapshotInput {
  return normalizeDisnatRows(normalizedRows);
}

function upsertAccount(
  map: Map<string, NormalizedDisnatAccount>,
  account: NormalizedDisnatAccount,
) {
  const key = `${account.accountName}-${account.currency}`;
  const current = map.get(key);

  map.set(key, {
    accountName: account.accountName,
    accountType: current?.accountType ?? account.accountType,
    currency: account.currency,
    cashValue: (current?.cashValue ?? 0) + account.cashValue,
    marketValue: (current?.marketValue ?? 0) + account.marketValue,
    totalValue: (current?.totalValue ?? 0) + account.totalValue,
  });
}

function readText(
  row: ParsedDisnatRow,
  aliases: readonly string[],
): string | undefined {
  const value = readRaw(row, aliases);
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function readMoney(
  row: ParsedDisnatRow,
  aliases: readonly string[],
): number | undefined {
  const raw = readRaw(row, aliases);
  if (raw === null || raw === undefined || raw === "") {
    return undefined;
  }

  const normalized = String(raw)
    .replace(/\s/g, "")
    .replace(/\$/g, "")
    .replace(/CAD|USD/gi, "")
    .replace(/\(([^)]+)\)/, "-$1")
    .replace(/,/g, ".");

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : undefined;
}

function normalizeTransaction(
  row: ParsedDisnatRow,
): NormalizedDisnatTransaction | null {
  const transactionType = readText(row, columnAliases.transactionType);
  const tradeDate = readDate(row, columnAliases.tradeDate);
  const settlementDate = readDate(row, columnAliases.settlementDate);
  const amount = readTransactionAmount(row);
  const ticker = readText(row, columnAliases.ticker);
  const securityName = readText(row, columnAliases.securityName);

  if (!transactionType && !tradeDate && amount === undefined) {
    return null;
  }

  return {
    accountName: readText(row, columnAliases.accountName) || undefined,
    accountNumber: readText(row, columnAliases.accountNumber) || undefined,
    tradeDate,
    settlementDate,
    transactionType,
    ticker: ticker ? ticker.toUpperCase() : undefined,
    securityName: securityName || undefined,
    currency: readText(row, columnAliases.currency)?.toUpperCase() || "CAD",
    quantity: readMoney(row, columnAliases.quantity),
    price: readMoney(row, columnAliases.marketPrice),
    amount,
    fees: readMoney(row, columnAliases.fees),
    rawJson: row,
  };
}

function inferCurrency(row: ParsedDisnatRow) {
  const explicitCurrency = readText(row, columnAliases.currency);
  if (explicitCurrency) {
    return explicitCurrency.toUpperCase();
  }

  const ticker = readText(row, columnAliases.ticker)?.toUpperCase();
  if (ticker?.endsWith("-U")) {
    return "USD";
  }
  if (ticker?.endsWith("-C")) {
    return "CAD";
  }

  return "CAD";
}

function readTransactionAmount(row: ParsedDisnatRow) {
  const explicitAmount = readMoney(row, columnAliases.amount);
  if (explicitAmount !== undefined) {
    return explicitAmount;
  }

  const debit = readMoney(row, columnAliases.debit);
  const credit = readMoney(row, columnAliases.credit);

  if (debit === undefined && credit === undefined) {
    return undefined;
  }

  return (credit ?? 0) - (debit ?? 0);
}

function readDate(row: ParsedDisnatRow, aliases: readonly string[]) {
  const raw = readRaw(row, aliases);
  if (!raw) {
    return undefined;
  }

  const value = String(raw).trim();
  const isoLike = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const frenchLike = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  const date = isoLike
    ? new Date(
        Number(isoLike[1]),
        Number(isoLike[2]) - 1,
        Number(isoLike[3]),
      )
    : frenchLike
      ? new Date(
          Number(frenchLike[3]),
          Number(frenchLike[2]) - 1,
          Number(frenchLike[1]),
        )
      : new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function readRaw(row: ParsedDisnatRow, aliases: readonly string[]) {
  const entries = Object.entries(row);
  const found = entries.find(([key]) =>
    aliases.some((alias) => normalizeHeader(key) === normalizeHeader(alias)),
  );

  return found?.[1];
}

function detectImportKind(
  headers: string[],
  rows: ParsedDisnatRow[],
): CsvImportKind {
  const normalizedHeaders = headers.map(normalizeHeader);
  const hasTransactionColumns = [
    "date",
    "date de transaction",
    "operation",
    "opération",
    "transaction",
    "montant",
    "amount",
    "debit",
    "dbit",
    "credit",
    "crdit",
    "description",
  ].some((header) => normalizedHeaders.includes(normalizeHeader(header)));
  const hasPositionColumns = ["symbole", "ticker", "quantite", "quantité"].some(
    (header) => normalizedHeaders.includes(normalizeHeader(header)),
  );
  const hasPortfolioColumns = [
    "encaisse ($)",
    "valeur des titres ($)",
    "valeur totale ($)",
  ].some((header) => normalizedHeaders.includes(normalizeHeader(header)));
  const rowKinds = rows.map((row) => ({
    transaction: normalizeTransaction(row) !== null,
    position:
      !!readText(row, columnAliases.ticker) &&
      readMoney(row, columnAliases.marketValue) !== undefined,
    portfolio:
      readMoney(row, columnAliases.cashValue) !== undefined ||
      readMoney(row, columnAliases.totalValue) !== undefined,
  }));
  const hasTransactionRows = rowKinds.some((kind) => kind.transaction);
  const hasPositionRows = rowKinds.some((kind) => kind.position);
  const hasPortfolioRows = rowKinds.some((kind) => kind.portfolio);
  const typeCount = [
    hasTransactionColumns || hasTransactionRows,
    hasPositionColumns || hasPositionRows,
    hasPortfolioColumns || hasPortfolioRows,
  ].filter(Boolean).length;

  if (typeCount > 1) {
    return "MIXED";
  }
  if (hasTransactionColumns || hasTransactionRows) {
    return "TRANSACTIONS";
  }
  if (hasPositionColumns || hasPositionRows) {
    return "POSITIONS";
  }
  if (hasPortfolioColumns || hasPortfolioRows) {
    return "PORTFOLIO";
  }

  return "UNKNOWN";
}

function detectDelimiter(fileText: string) {
  const candidates = [";", "\t", ","];
  const sample = fileText.split(/\r\n|\n|\r/).slice(0, 30);

  return candidates.toSorted(
    (a, b) =>
      countDelimiter(sample, b) - countDelimiter(sample, a),
  )[0];
}

function countDelimiter(lines: string[], delimiter: string) {
  return lines.reduce(
    (count, line) => count + Math.max(line.split(delimiter).length - 1, 0),
    0,
  );
}

function isDisnatHeaderLine(line: string, delimiter: string) {
  const normalizedCells = line.split(delimiter).map(normalizeHeader);
  const expected = [
    "nom",
    "compte",
    "devise",
    "encaisse ($)",
    "valeur des titres ($)",
    "valeur totale ($)",
    "symbole",
    "ticker",
  ];

  return expected.filter((header) => normalizedCells.includes(header)).length >= 3;
}

function isHeaderCells(cells: string[]) {
  const normalizedCells = cells.map(normalizeHeader);
  return (
    normalizedCells.includes("nom") &&
    normalizedCells.includes("compte") &&
    normalizedCells.includes("devise")
  );
}

function rowFromCells(headers: string[], cells: string[]) {
  return headers.reduce<ParsedDisnatRow>((row, header, index) => {
    row[header] = cells[index]?.trim() ?? "";
    return row;
  }, {});
}

function isSummaryOrHeaderLabel(value: string) {
  const normalized = normalizeHeader(value);
  return (
    normalized === "nom" ||
    normalized.startsWith("total des actifs") ||
    normalized.startsWith("vue d'ensemble") ||
    normalized.startsWith("vue densemble")
  );
}

function normalizeHeader(header: string) {
  return header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/[?$%()]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
