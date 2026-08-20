import Papa from "papaparse";
import { z } from "zod";
import { categorizeTxType } from "@/lib/csv/tx-category";
import { normalizeDisnatTickerForPortfolio, standardizeDisnatTickerMarketDots } from "@/lib/market/disnat-ticker";
import { sanitizePortfolioOwner } from "@/lib/portfolio/sanitize-portfolio-owner";
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
  accountNumber: z.string().optional(),
  accountType: z.string().optional(),
  ticker: z.string().min(1),
  securityName: z.string().optional(),
  currency: z.string().min(3).max(3),
  quantity: z.number(),
  averageCost: z.number().optional(),
  marketPrice: z.number().optional(),
  marketValue: z.number(),
  unrealizedGainLoss: z.number().optional(),
  loanValue: z.number().optional(),
  sector: z.string().optional(),
  assetType: z.string().optional(),
});

const columnAliases = {
  /** Éviter « nom » et « compte » seuls : sur les exports titres, « Nom » est souvent le libellé du titre. */
  accountName: ["nom du compte", "account name", "designation du compte", "portfolio name", "account"],
  /** Inclut « Type » seul (exports titre / portefeuille) en plus de « Type de compte ». */
  accountType: ["type de compte", "account type", "type"],
  accountNumber: [
    "compte",
    "numero de compte",
    "numéro de compte",
    "numro de carte",
    "numero de carte",
    "account number",
    "no compte",
    "no. compte",
    "no de compte",
    "compte #",
    "# compte",
  ],
  ticker: ["symbole", "ticker", "symbol", "titre", "security symbol"],
  securityName: ["nom", "description", "security name", "nom du titre"],
  currency: ["devise du compte", "devise", "currency", "monnaie"],
  priceDevise: ["devise du prix", "price currency"],
  market: ["marche", "marché", "market", "bourse"],
  assetClass: ["classe d'actif", "classe dactif", "asset class", "type de titre"],
  quantity: ["quantite", "quantité", "qte", "qté", "qt", "quantity", "qty"],
  averageCost: ["cout moyen", "coût moyen", "cot moyen", "average cost", "avg cost"],
  marketPrice: ["prix", "prix actuel", "market price", "last price", "cours"],
  marketValue: [
    "valeur marchande",
    "market value",
    "valeur au marche",
    "valeur au marché",
    "valeur au march",
    "valeur au marche $",
    "valeur au marché $",
    "valeur des titres",
  ],
  totalValue: ["valeur totale", "total value"],
  unrealizedGainLoss: [
    "gain/perte",
    "unrealized gain/loss",
    "gain non realise",
    "profits non realises",
    "profits non réalisés ($)",
    "profits non réalisés",
    "profits non raliss",
  ],
  loanValue: [
    "valeur d'emprunt",
    "valeur demprunt",
    "valeur d emprunt",
    "loan value",
    "marge disponible valeur emprunt",
  ],
  cashValue: ["encaisse", "cash", "cash value", "solde"],
  sector: ["secteur", "sector"],
  assetType: ["type actif", "asset type", "categorie", "catégorie"],
  tradeDate: [
    "date",
    "date de transaction",
    "date de la transaction",
    "trade date",
    "date doperation",
    "date d'operation",
    "date opération",
    "date operation",
    "dt transaction",
    "date valeur",
  ],
  settlementDate: [
    "date de reglement",
    "date de règlement",
    "date d'inscription",
    "settlement date",
  ],
  transactionType: [
    "type de transaction",
    "type d'opération",
    "type d'operation",
    "type dopération",
    "type doperation",
    "type",
    "operation",
    "opération",
    "transaction",
    "activité",
    "categorie",
    "catégorie",
    "catgorie",
  ],
  amount: ["montant de l'opération", "montant de l'operation", "montant", "amount", "net amount", "montant net"],
  debit: ["debit", "débit", "dbit"],
  credit: ["credit", "crédit", "crdit"],
  fees: ["frais", "commission", "fees"],
} as const;

/**
 * Excel exporte parfois une première ligne `sep=;` (ou fusionnée avec l'en-tête).
 * Sans ce nettoyage, la première colonne devient `sep=` et toutes les données sont décalées.
 */
function preprocessDisnatCsvText(rawText: string): string {
  const bomStripped = rawText.replace(/^\uFEFF/, "");
  const lines = bomStripped.split(/\r\n|\n|\r/);
  if (lines.length === 0) {
    return bomStripped;
  }
  const trimmed = (lines[0] ?? "").trim();
  if (/^sep\s*=/i.test(trimmed)) {
    let rest = trimmed.replace(/^sep\s*=\s*/i, "");
    rest = rest.replace(/^[;,|\t]+/, "").trim();
    if (rest.length > 0) {
      lines[0] = rest;
    } else {
      lines.shift();
    }
  }
  return lines.join("\n");
}

export function parseDisnatCsv(fileText: string) {
  const cleanedText = preprocessDisnatCsvText(fileText);
  const delimiter = detectDelimiter(cleanedText);
  const ownerMap = extractOwnerMap(cleanedText, delimiter);
  const lines = cleanedText
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

  const rawHeaderCells = (rawResult.data[0] ?? []).map((header, index) =>
    header.trim() || `Colonne ${index + 1}`,
  );
  const headerCells = disambiguateHeaders(rawHeaderCells);
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
    ownerMap,
    errors: rawResult.errors.map((error) => ({
      row: error.row,
      message: error.message,
    })),
  };
}

export function normalizeDisnatRows(
  rows: ParsedDisnatRow[],
  ownerMap?: Map<string, string>,
): PortfolioSnapshotInput {
  const warnings: string[] = [];
  const positions: NormalizedDisnatPosition[] = [];
  const transactions: NormalizedDisnatTransaction[] = [];
  const cashByAccount = new Map<string, NormalizedDisnatAccount>();
  let snapshotIncludesCashFromPortfolioExport = false;
  const importKind = detectImportKind(Object.keys(rows[0] ?? {}), rows);

  rows.forEach((row, index) => {
    const ticker = readText(row, columnAliases.ticker);
    const nomCell = readText(row, ["nom"]);
    const namedFromAlias = readText(row, columnAliases.accountName);
    /*
     * Synthèse portefeuille Disnat : une seule colonne « Nom » (CELI, REER, Comptant…), sans
     * « Nom du compte ». Sur détail titres, « Nom » est le titre : ne pas l’utiliser comme nom
     * de compte quand une ligne a un symbole.
     */
    const accountName =
      namedFromAlias || (!ticker ? nomCell : undefined) || "Compte Disnat";
    const accountNumber = readText(row, columnAliases.accountNumber) || undefined;
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
      if (!hasDisnatAccountNumber(accountNumber)) {
        warnings.push(
          `Ligne ${index + 2}: ligne sans numéro de compte (total consolidé ou export récap.) — ignorée pour les états par compte.`,
        );
        return;
      }
      const owner = resolveOwnerFromMap(ownerMap, accountNumber);
      snapshotIncludesCashFromPortfolioExport = true;
      const accountTypePortfolio =
        readText(row, columnAliases.accountType) ||
        (namedFromAlias ? undefined : nomCell) ||
        undefined;
      upsertAccount(cashByAccount, {
        accountName,
        accountNumber,
        accountType: accountTypePortfolio,
        owner,
        currency,
        cashValue: cashValue ?? Math.max((totalValue ?? 0) - (marketValue ?? 0), 0),
        marketValue: marketValue ?? Math.max((totalValue ?? 0) - (cashValue ?? 0), 0),
        totalValue: totalValue ?? (cashValue ?? 0) + (marketValue ?? 0),
      });
      return;
    }

    if (!ticker || marketValue === undefined) {
      if (importKind !== "TRANSACTIONS" && importKind !== "PORTFOLIO") {
        warnings.push(
          `Ligne ${index + 2}: ticker ou valeur marchande manquant, ligne ignorée.`,
        );
      }
      return;
    }

    const rawSecurityName = readText(row, columnAliases.securityName) || undefined;
    let rowAccountType = readText(row, columnAliases.accountType) || undefined;
    /*
     * Sur exports Disnat, « Nom » sert au titre ; l’ancien alias « nom » sur accountType
     * recopiait le nom de l’action dans le type de compte et cassait l’agrégation (upsertAccount).
     */
    if (
      rowAccountType &&
      rawSecurityName &&
      rowAccountType.trim().toLowerCase() === rawSecurityName.trim().toLowerCase()
    ) {
      rowAccountType = undefined;
    }

    const rawQuantity = readMoney(row, columnAliases.quantity);
    if (rawQuantity === undefined) {
      warnings.push(
        `Ligne ${index + 2}: quantité manquante pour ${ticker} — traitée comme 0, vérifier le fichier source.`,
      );
    }

    const candidate = {
      accountName,
      accountNumber,
      accountType: rowAccountType,
      ticker: normalizeDisnatTickerForPortfolio(ticker.toUpperCase(), currency),
      securityName: rawSecurityName,
      currency,
      quantity: rawQuantity ?? 0,
      averageCost: readMoney(row, columnAliases.averageCost),
      marketPrice: readMoney(row, columnAliases.marketPrice),
      marketValue,
      unrealizedGainLoss: readMoney(row, columnAliases.unrealizedGainLoss),
      loanValue: readMoney(row, columnAliases.loanValue),
      sector: readText(row, columnAliases.sector) || undefined,
      assetType: readText(row, columnAliases.assetType) || undefined,
    };

    const parsed = normalizedPositionSchema.safeParse(candidate);
    if (!parsed.success) {
      warnings.push(`Ligne ${index + 2}: format invalide pour ${ticker}.`);
      return;
    }

    const owner = resolveOwnerFromMap(ownerMap, accountNumber);
    positions.push(parsed.data);
    if (!hasDisnatAccountNumber(parsed.data.accountNumber)) {
      warnings.push(
        `Ligne ${index + 2}: ${parsed.data.ticker} sans numéro de compte — titre conservé pour l’import mais pas d’agrégation encaisse/totaux.`,
      );
      return;
    }
    upsertAccount(cashByAccount, {
      accountName,
      accountNumber: parsed.data.accountNumber,
      /* Type déjà filtré si identique au libellé du titre (voir rowAccountType ci-dessus). */
      accountType: parsed.data.accountType,
      owner,
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

  if (!snapshotIncludesCashFromPortfolioExport && positions.length > 0 && cashByAccount.size > 0) {
    warnings.push(
      "Export sans encaisse par compte (détail des titres) : les encaisses déjà en base sont conservées. Importe la vue portefeuille avec encaisse pour les mettre à jour.",
    );
  }

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
    snapshotIncludesCashFromPortfolioExport,
  };
}

export function buildPortfolioSnapshot(
  normalizedRows: ParsedDisnatRow[],
  ownerMap?: Map<string, string>,
): PortfolioSnapshotInput {
  return normalizeDisnatRows(normalizedRows, ownerMap);
}

/** Fenêtre temporelle déduite des lignes d’opérations (min / max des dates lues). */
export function computeSnapshotTemporalBounds(snapshot: PortfolioSnapshotInput): {
  dataFrom: Date | null;
  dataTo: Date | null;
} {
  const times: number[] = [];
  for (const t of snapshot.transactions) {
    if (t.tradeDate) {
      times.push(t.tradeDate.getTime());
    }
    if (t.settlementDate) {
      times.push(t.settlementDate.getTime());
    }
  }
  if (times.length === 0) {
    return { dataFrom: null, dataTo: null };
  }
  return {
    dataFrom: new Date(Math.min(...times)),
    dataTo: new Date(Math.max(...times)),
  };
}

function hasDisnatAccountNumber(accountNumber?: string | null): boolean {
  return Boolean(accountNumber?.replace(/\s/g, "").length);
}

function accountMergeKey(name: string, currency: string, accountNumber?: string) {
  const n = accountNumber?.replace(/\s/g, "") ?? "";
  if (n) {
    return `n:${n}|${currency}`;
  }
  return `name:${name}|${currency}`;
}

function upsertAccount(
  map: Map<string, NormalizedDisnatAccount>,
  account: NormalizedDisnatAccount,
) {
  const key = accountMergeKey(account.accountName, account.currency, account.accountNumber);
  const current = map.get(key);

  map.set(key, {
    accountName:
      current && current.accountName !== account.accountName
        ? `${current.accountName} · ${account.accountName}`.slice(0, 160)
        : account.accountName,
    accountNumber: account.accountNumber ?? current?.accountNumber,
    accountType: current?.accountType ?? account.accountType,
    owner: account.owner ?? current?.owner,
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

function isDisnatTypeLikePreviewHeader(header: string): boolean {
  const nh = normalizeHeaderForMatching(header);
  if (nh === "type") return true;
  for (const a of columnAliases.transactionType) {
    if (normalizeHeader(String(a)) === nh) return true;
  }
  for (const a of columnAliases.accountType) {
    if (normalizeHeader(String(a)) === nh) return true;
  }
  return false;
}

/**
 * Cellule d’aperçu : Disnat laisse souvent la colonne « Type » vide tout en mettant le libellé
 * dans « Activité », « Opération », « Type d’opération », etc. — ce que readText sait déjà lire.
 */
export function disnatPreviewCellDisplay(row: ParsedDisnatRow, header: string): string {
  const raw = String(row[header] ?? "").trim();
  if (raw.length > 0) {
    return String(row[header] ?? "");
  }
  if (isDisnatTypeLikePreviewHeader(header)) {
    const tx = readText(row, columnAliases.transactionType);
    if (tx) return tx;
    const acct = readText(row, columnAliases.accountType);
    if (acct) return acct;
  }
  return String(row[header] ?? "");
}

/** Normalise une chaîne monétaire (fr-ca, en-us, sortie Excel CSV) en nombre décimal JS. */
function normalizeMoneyString(raw: string): string {
  let s = raw.replace(/\s/g, "").replace(/\$/g, "").replace(/CAD|USD/gi, "");
  const paren = s.match(/^\(([^)]+)\)$/);
  if (paren) s = `-${paren[1]}`;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastDot > lastComma) {
      // US / Excel : 19,418.92
      return s.replace(/,/g, "");
    }
    // Europe : 19.418,92
    return s.replace(/\./g, "").replace(",", ".");
  }
  if (hasComma) {
    return s.replace(",", ".");
  }
  return s;
}

function readMoney(
  row: ParsedDisnatRow,
  aliases: readonly string[],
): number | undefined {
  const raw = readRaw(row, aliases);
  if (raw === null || raw === undefined || raw === "") {
    return undefined;
  }

  const normalized = normalizeMoneyString(String(raw));
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

  const rawMarket = readText(row, columnAliases.market);
  const rawAssetClass = readText(row, columnAliases.assetClass);
  const rawPriceDevise = readText(row, columnAliases.priceDevise);
  const accountCurrency = readText(row, columnAliases.currency)?.toUpperCase() || "CAD";
  const priceDeviseNorm =
    rawPriceDevise && rawPriceDevise !== "-" ? rawPriceDevise.toUpperCase() : undefined;
  const currencyForTicker = priceDeviseNorm ?? accountCurrency;

  return {
    accountName: readText(row, columnAliases.accountName) || undefined,
    accountNumber: readText(row, columnAliases.accountNumber) || undefined,
    tradeDate: tradeDate ?? settlementDate,
    settlementDate,
    transactionType,
    txCategory: categorizeTxType(transactionType),
    ticker: ticker
      ? normalizeDisnatTickerForPortfolio(ticker.toUpperCase(), currencyForTicker)
      : undefined,
    securityName: securityName || undefined,
    market: rawMarket && rawMarket !== "-" ? rawMarket : undefined,
    currency: accountCurrency,
    priceDevise: priceDeviseNorm,
    assetClass: rawAssetClass && rawAssetClass !== "-" ? rawAssetClass : undefined,
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

  const tickerRaw = readText(row, columnAliases.ticker);
  const tickerStd = tickerRaw
    ? standardizeDisnatTickerMarketDots(tickerRaw.toUpperCase())
    : null;
  if (tickerStd?.endsWith("-U")) {
    return "USD";
  }
  if (tickerStd?.endsWith("-C")) {
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

function excelSerialToDate(serial: number): Date | undefined {
  const rounded = Math.round(serial);
  if (rounded < 1 || rounded > 1_000_000) {
    return undefined;
  }
  const excelEpochUtc = Date.UTC(1899, 11, 30);
  const ms = excelEpochUtc + rounded * 86400000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function readDate(row: ParsedDisnatRow, aliases: readonly string[]) {
  const raw = readRaw(row, aliases);
  if (!raw) {
    return undefined;
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    const fromSerial = excelSerialToDate(raw);
    if (fromSerial) {
      return fromSerial;
    }
  }

  const value = String(raw).trim();
  const compactNum = Number.parseFloat(value.replace(",", "."));
  if (
    Number.isFinite(compactNum) &&
    compactNum > 25000 &&
    compactNum < 120000 &&
    !/[/-]/.test(value)
  ) {
    const fromSerial = excelSerialToDate(compactNum);
    if (fromSerial) {
      return fromSerial;
    }
  }

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
  const matches = entries.filter(([key]) =>
    aliases.some((alias) => headerKeyMatchesAlias(key, alias)),
  );
  for (const [, val] of matches) {
    if (val !== null && val !== undefined && String(val).trim() !== "") {
      return val;
    }
  }
  return matches[0]?.[1];
}

/** Colonnes Excel dupliquées → « Type », « Type (2) » : comparer comme « type ». */
function normalizeHeaderForMatching(header: string) {
  return normalizeHeader(header).replace(/\s*\(\d+\)\s*$/, "").trim();
}

function disambiguateHeaders(rawHeaders: string[]): string[] {
  const seen = new Map<string, number>();
  return rawHeaders.map((label) => {
    const n = seen.get(label) ?? 0;
    seen.set(label, n + 1);
    if (n === 0) return label;
    return `${label} (${n + 1})`;
  });
}

function headerKeyMatchesAlias(key: string, alias: string): boolean {
  return normalizeHeaderForMatching(key) === normalizeHeader(alias);
}

function detectImportKind(
  headers: string[],
  rows: ParsedDisnatRow[],
): CsvImportKind {
  const normalizedHeaders = headers.map(normalizeHeaderForMatching);
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
  const hasPositionColumns = ["symbole", "ticker", "quantite", "quantité", "qte"].some(
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

/**
 * Numéro de compte normalisé pour ownerMap / réconciliation (sans espaces, majuscules).
 */
function normalizedAccountNumberKey(accountNumber?: string | null): string | undefined {
  const k = accountNumber?.replace(/\s/g, "").toUpperCase();
  return k && k.length >= 4 ? k : undefined;
}

function resolveOwnerFromMap(
  ownerMap: Map<string, string> | undefined,
  accountNumber?: string | null,
): string | undefined {
  const key = normalizedAccountNumberKey(accountNumber);
  const raw = (key && ownerMap?.get(key)) || undefined;
  const cleaned = sanitizePortfolioOwner(raw);
  return cleaned ?? undefined;
}

/**
 * Extrait une map accountNumber → propriétaire depuis les sections du CSV portefeuille Disnat.
 * Utilise Papa Parse (comme le reste du fichier) pour respecter les guillemets ; détecte la colonne
 * « Compte » depuis la ligne d’en-tête ; accepte un nom de propriétaire en MAJUSCULES ou en casse mixte.
 */
export function extractOwnerMap(fileText: string, delimiter: string): Map<string, string> {
  const ownerMap = new Map<string, string>();
  const normalizedAcctHeaders = new Set(
    columnAliases.accountNumber.map((a) => normalizeHeader(String(a))),
  );

  const ignorePatterns =
    /^(portefeuille|total des actifs|vue d['\u2019]ensemble|nom|en date du|taux de change)/i;

  function findAccountColumnIndex(cells: string[]): number | null {
    const normalized = cells.map((c) => normalizeHeader(String(c ?? "")));
    for (let i = 0; i < normalized.length; i++) {
      const h = normalized[i];
      if (h && normalizedAcctHeaders.has(h)) return i;
    }
    return null;
  }

  function looksLikePortfolioHeaderRow(cells: string[]): boolean {
    const acctIdx = findAccountColumnIndex(cells);
    if (acctIdx === null) return false;
    const joined = cells.join(" ").toLowerCase();
    return (
      /\b(symbole|ticker)\b/u.test(joined) ||
      /\b(valeur des titres|valeur marchande|valeur au marche|valeur au marché|market value)\b/u.test(
        joined,
      ) ||
      /\b(encaisse|cash)\b/u.test(joined) ||
      /\b(devise|currency)\b/u.test(joined)
    );
  }

  function looksLikeOwnerSectionRow(firstCell: string, cells: string[]): boolean {
    const value = firstCell.trim();
    if (!value || value.length < 5 || ignorePatterns.test(value)) return false;
    if (/^(ACTIONS|OPÉRATIONS|OPERATIONS)\s+(CAD|USD)\s*$/i.test(value)) return false;
    if (/^(REER|CELI|RESP|TFSA|FNCR|NON[- ]?ENR\.?)\b/i.test(value)) return false;

    const norm = normalizeHeader(value);
    if (
      norm === "nom" ||
      norm === "symbole" ||
      norm === "devise" ||
      normalizedAcctHeaders.has(norm)
    ) {
      return false;
    }

    const trailingNonEmpty = cells.slice(1).filter((c) => String(c ?? "").trim()).length;
    if (trailingNonEmpty > 3) return false;

    const legacyAllCaps =
      /^[A-ZÀÂÄÉÈÊËÎÏÔÙÛÜÇŒÆ][A-ZÀÂÄÉÈÊËÎÏÔÙÛÜÇŒÆ\s\-']+$/.test(value);

    const titledPerson =
      /^[\p{L}][\p{L}\s\-'.]{3,}$/u.test(value) &&
      /\s/.test(value) &&
      value.split(/\s+/).filter((t) => t.replace(/\./g, "").length >= 2).length >= 2;

    return legacyAllCaps || titledPerson;
  }

  const preprocessed = preprocessDisnatCsvText(fileText);
  const parsed = Papa.parse<string[]>(preprocessed, {
    delimiter,
    header: false,
    skipEmptyLines: false,
  });

  let currentOwner: string | null = null;
  let accountColumnIdx: number | null = null;

  for (const row of parsed.data) {
    const cells = row.map((c) => String(c ?? "").trim());
    if (cells.every((c) => !c)) continue;

    const sectionHead = (cells[0] ?? "").trim();
    if (/^(ACTIONS|OPÉRATIONS|OPERATIONS)\s+(CAD|USD)\s*$/i.test(sectionHead)) {
      currentOwner = null;
      continue;
    }

    if (looksLikePortfolioHeaderRow(cells)) {
      accountColumnIdx = findAccountColumnIndex(cells);
      continue;
    }

    if (looksLikeOwnerSectionRow(cells[0] ?? "", cells)) {
      currentOwner = (cells[0] ?? "").trim();
      continue;
    }

    if (currentOwner !== null && accountColumnIdx !== null && cells.length > accountColumnIdx) {
      const rawAcct = cells[accountColumnIdx] ?? "";
      const accountNumber = normalizedAccountNumberKey(rawAcct);
      const effectiveOwner = sanitizePortfolioOwner(currentOwner);
      if (
        effectiveOwner &&
        accountNumber &&
        !/^(total|ensemble|encaisse|vue|nom|devise|symbole)$/i.test(accountNumber)
      ) {
        ownerMap.set(accountNumber, effectiveOwner);
      }
    }
  }

  return ownerMap;
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

function disnatTableHeaderMarkers(): string[] {
  return [
    "nom",
    "compte",
    "devise",
    "encaisse ($)",
    "valeur des titres ($)",
    "valeur totale ($)",
    "symbole",
    "ticker",
  ].map(normalizeHeader);
}

function headersLookLikeDisnatTable(headers: string[]): boolean {
  const normalizedCells = headers.map(normalizeHeaderForMatching);
  const expected = disnatTableHeaderMarkers();
  return expected.filter((marker) => normalizedCells.includes(marker)).length >= 3;
}

function disnatBrandingInPreamble(fileText: string): boolean {
  const head = fileText.slice(0, 5000).toLowerCase();
  return (
    /\bdisnat\b/.test(head) ||
    /\bdesjardins\b/.test(head) ||
    /\bdes\s*jardins\b/.test(head)
  );
}

function disnatInvestmentHeaderSignalScore(normalizedHeaders: string[]): number {
  let score = 0;

  for (const h of normalizedHeaders) {
    if (
      h.includes("valeur marchande") ||
      h.includes("market value") ||
      h.includes("valeur des titres") ||
      h.includes("valeur totale") ||
      h.includes("total value")
    ) {
      score += 2;
      continue;
    }
    if (
      h.includes("cout moyen") ||
      h.includes("average cost") ||
      h.includes("avg cost")
    ) {
      score += 2;
      continue;
    }
    if (
      (h.includes("gain") && (h.includes("perte") || h.includes("loss"))) ||
      h.includes("unrealized") ||
      h.includes("profits non")
    ) {
      score += 2;
      continue;
    }
    if (h.includes("encaisse") || h.includes("cash value")) {
      score += 2;
      continue;
    }
    if (h.includes("type de transaction") || h.includes("montant de l")) {
      score += 2;
      continue;
    }
    if (
      h.includes("date de reglement") ||
      h.includes("date dinscription") ||
      h.includes("settlement date") ||
      h.includes("trade date") ||
      h.includes("date de transaction")
    ) {
      score += 1;
      continue;
    }
    if (h.includes("devise du compte") || h.includes("classe d")) {
      score += 1;
      continue;
    }
    if (h.includes("numero de compte") || h.includes("account number")) {
      score += 1;
      continue;
    }
    if (h.includes("type de compte") || h.includes("account type")) {
      score += 1;
      continue;
    }
  }

  return score;
}

export type DisnatInvestmentCsvValidation =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Rejette les CSV génériques dont les colonnes (date, montant, type…) collent
 * au mapping alors que l’export ne ressemble pas à un relevé Disnat.
 */
export function validateDisnatInvestmentExportFile(input: {
  rawText: string;
  headers: string[];
  importKind: CsvImportKind;
}): DisnatInvestmentCsvValidation {
  const normalizedHeaders = input.headers.map(normalizeHeaderForMatching);
  const branding = disnatBrandingInPreamble(input.rawText);
  const tableLike = headersLookLikeDisnatTable(input.headers);
  const signals = disnatInvestmentHeaderSignalScore(normalizedHeaders);

  const fingerprintOk =
    tableLike || signals >= 3 || (branding && signals >= 2);

  if (!fingerprintOk) {
    return {
      ok: false,
      message:
        "Ce fichier ne ressemble pas à un export Disnat (positions, encaisses ou opérations). Utilise un fichier CSV ou Excel exporté depuis Disnat, avec des colonnes du type « Valeur marchande », « Encaisse », « Date de règlement », etc.",
    };
  }

  if (input.importKind === "UNKNOWN") {
    return {
      ok: false,
      message:
        "Le type d’export n’a pas été reconnu (positions, solde ou activité). Vérifie le fichier ou réessaie avec un export Disnat standard.",
    };
  }

  return { ok: true };
}

function isDisnatHeaderLine(line: string, delimiter: string) {
  const normalizedCells = line.split(delimiter).map(normalizeHeaderForMatching);
  const expected = disnatTableHeaderMarkers();

  return expected.filter((header) => normalizedCells.includes(header)).length >= 3;
}

function isHeaderCells(cells: string[]) {
  const normalizedCells = cells.map(normalizeHeaderForMatching);
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
    normalized.startsWith("vue densemble") ||
    normalized.startsWith("en date du") ||
    normalized.startsWith("taux de change")
  );
}

function normalizeHeader(header: string) {
  return header
    .replace(/[\u2018\u2019\u201A\u2032\u00B4]/g, "'")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/[?$%()]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
