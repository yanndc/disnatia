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
  /** Valeur d'emprunt (marge) si la colonne est dans l’export Disnat */
  loanValue?: number;
  weightPct?: number;
  sector?: string;
  assetType?: string;
};

export type NormalizedDisnatAccount = {
  accountName: string;
  accountNumber?: string;
  accountType?: string;
  /** Propriétaire du compte extrait des sections d'en-tête du CSV portefeuille */
  owner?: string;
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
  /** Catégorie normalisée (correspond à l'enum Prisma TxCategory) */
  txCategory?: string;
  ticker?: string;
  securityName?: string;
  /** Marché d'exécution (CAN, USA, …) */
  market?: string;
  /** Devise du compte */
  currency?: string;
  /** Devise du prix (peut différer de la devise du compte) */
  priceDevise?: string;
  /** Classe d'actif Disnat brute */
  assetClass?: string;
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
  /**
   * True si le CSV contenait des lignes récap portefeuille avec encaisse / totaux par compte
   * (pas seulement des lignes « détail titres » sans encaisse).
   */
  snapshotIncludesCashFromPortfolioExport: boolean;
};
