CREATE TABLE "portfolio_holdings" (
    "id" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT,
    "accountType" TEXT,
    "ticker" TEXT NOT NULL,
    "securityName" TEXT,
    "currency" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "averageCost" DOUBLE PRECISION,
    "snapshotPrice" DOUBLE PRECISION,
    "snapshotValue" DOUBLE PRECISION NOT NULL,
    "unrealizedGainLoss" DOUBLE PRECISION,
    "sector" TEXT,
    "assetType" TEXT,
    "asOf" TIMESTAMP(3) NOT NULL,
    "sourceImportId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_holdings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portfolio_account_states" (
    "id" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT,
    "accountType" TEXT,
    "currency" TEXT NOT NULL,
    "cashValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marketValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "asOf" TIMESTAMP(3) NOT NULL,
    "sourceImportId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_account_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portfolio_holdings_accountKey_ticker_currency_key" ON "portfolio_holdings"("accountKey", "ticker", "currency");
CREATE INDEX "portfolio_holdings_ticker_idx" ON "portfolio_holdings"("ticker");
CREATE INDEX "portfolio_holdings_accountKey_idx" ON "portfolio_holdings"("accountKey");
CREATE UNIQUE INDEX "portfolio_account_states_accountKey_currency_key" ON "portfolio_account_states"("accountKey", "currency");
CREATE INDEX "portfolio_account_states_accountKey_idx" ON "portfolio_account_states"("accountKey");
