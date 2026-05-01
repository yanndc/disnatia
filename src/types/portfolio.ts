export type ParsedDisnatRow = Record<string, string | number | null>;

export type NormalizedDisnatPosition = {
  accountName: string;
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
  accountType?: string;
  currency: string;
  cashValue: number;
  marketValue: number;
  totalValue: number;
};

export type PortfolioSnapshotInput = {
  accounts: NormalizedDisnatAccount[];
  positions: NormalizedDisnatPosition[];
  warnings: string[];
};
