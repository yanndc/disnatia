import Papa from "papaparse";
import { z } from "zod";
import type {
  NormalizedDisnatAccount,
  NormalizedDisnatPosition,
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
  quantity: ["quantite", "quantité", "quantity", "qty"],
  averageCost: ["cout moyen", "coût moyen", "average cost", "avg cost"],
  marketPrice: ["prix", "market price", "last price", "cours"],
  marketValue: ["valeur marchande", "market value", "valeur au marche"],
  unrealizedGainLoss: ["gain/perte", "unrealized gain/loss", "gain non realise"],
  cashValue: ["encaisse", "cash", "cash value", "solde"],
  sector: ["secteur", "sector"],
  assetType: ["type actif", "asset type", "categorie", "catégorie"],
} as const;

export function parseDisnatCsv(fileText: string) {
  const result = Papa.parse<ParsedDisnatRow>(fileText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (header) => header.trim(),
  });

  const rows = result.data.filter((row) =>
    Object.values(row).some((value) => String(value ?? "").trim().length > 0),
  );

  return {
    headers: result.meta.fields ?? [],
    rows,
    errors: result.errors.map((error) => ({
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
  const cashByAccount = new Map<string, NormalizedDisnatAccount>();

  rows.forEach((row, index) => {
    const ticker = readText(row, columnAliases.ticker);
    const accountName = readText(row, columnAliases.accountName) || "Compte Disnat";
    const currency = (readText(row, columnAliases.currency) || "CAD").toUpperCase();
    const marketValue = readMoney(row, columnAliases.marketValue);
    const cashValue = readMoney(row, columnAliases.cashValue);

    if (!ticker && cashValue !== undefined) {
      upsertAccount(cashByAccount, {
        accountName,
        accountType: readText(row, columnAliases.accountType) || undefined,
        currency,
        cashValue,
        marketValue: 0,
        totalValue: cashValue,
      });
      return;
    }

    if (!ticker || marketValue === undefined) {
      warnings.push(
        `Ligne ${index + 2}: ticker ou valeur marchande manquant, ligne ignorée.`,
      );
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
    accounts: Array.from(cashByAccount.values()).map((account) => ({
      ...account,
      totalValue: account.cashValue + account.marketValue,
    })),
    positions: positions.map((position) => ({
      ...position,
      weightPct:
        totalMarketValue > 0 ? (position.marketValue / totalMarketValue) * 100 : 0,
    })),
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

function readRaw(row: ParsedDisnatRow, aliases: readonly string[]) {
  const entries = Object.entries(row);
  const found = entries.find(([key]) =>
    aliases.some((alias) => normalizeHeader(key) === normalizeHeader(alias)),
  );

  return found?.[1];
}

function normalizeHeader(header: string) {
  return header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
