export type ParsedDisnatRow = Record<string, string | number | null>;

export type CsvImportKind =
  | "PORTFOLIO"
  | "POSITIONS"
  | "TRANSACTIONS"
  | "MIXED"
  | "UNKNOWN";

export type NormalizedDisnatPosition = {
  accountName: string;
  accountNumber?: string;
  accountType?: string;
  ticker: string;
  securityName?: string;
  currency: string;
  quantity: number;
  averageCost?: number;
  marketPrice?: number;
  marketValue: number;
  unrealizedGainLoss?: number;
  weightPct?: number;
  sector?: string;
  assetType?: string;
};

export type NormalizedDisnatAccount = {
  accountName: string;
  accountNumber?: string;
  accountType?: string;
  currency: string;
  cashValue: number;
  marketValue: number;
  totalValue: number;
};

export type NormalizedDisnatTransaction = {
  accountName?: string;
  accountNumber?: string;
  tradeDate?: Date;
  settlementDate?: Date;
  transactionType?: string;
  ticker?: string;
  securityName?: string;
  currency?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  fees?: number;
  rawJson: ParsedDisnatRow;
};

export type PortfolioSnapshotInput = {
  importKind: CsvImportKind;
  accounts: NormalizedDisnatAccount[];
  positions: NormalizedDisnatPosition[];
  transactions: NormalizedDisnatTransaction[];
  warnings: string[];
};
