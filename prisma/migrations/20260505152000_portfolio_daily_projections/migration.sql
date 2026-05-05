CREATE TABLE "portfolio_daily_prices" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "priceDate" DATE NOT NULL,
    "closePrice" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'yahoo',
    "yahooSymbol" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_daily_prices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portfolio_daily_holdings" (
    "id" TEXT NOT NULL,
    "holdingDate" DATE NOT NULL,
    "accountKey" TEXT NOT NULL,
    "accountName" TEXT,
    "accountNumber" TEXT,
    "ticker" TEXT NOT NULL,
    "securityName" TEXT,
    "currency" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "averageCost" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'transactions',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_daily_holdings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portfolio_daily_values" (
    "id" TEXT NOT NULL,
    "valueDate" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "positionsValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'projection',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_daily_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portfolio_daily_prices_ticker_currency_priceDate_key" ON "portfolio_daily_prices"("ticker", "currency", "priceDate");
CREATE INDEX "portfolio_daily_prices_priceDate_idx" ON "portfolio_daily_prices"("priceDate");
CREATE INDEX "portfolio_daily_prices_ticker_idx" ON "portfolio_daily_prices"("ticker");

CREATE UNIQUE INDEX "portfolio_daily_holdings_holdingDate_accountKey_ticker_currency_key" ON "portfolio_daily_holdings"("holdingDate", "accountKey", "ticker", "currency");
CREATE INDEX "portfolio_daily_holdings_holdingDate_idx" ON "portfolio_daily_holdings"("holdingDate");
CREATE INDEX "portfolio_daily_holdings_accountKey_idx" ON "portfolio_daily_holdings"("accountKey");
CREATE INDEX "portfolio_daily_holdings_ticker_idx" ON "portfolio_daily_holdings"("ticker");

CREATE UNIQUE INDEX "portfolio_daily_values_valueDate_currency_key" ON "portfolio_daily_values"("valueDate", "currency");
CREATE INDEX "portfolio_daily_values_valueDate_idx" ON "portfolio_daily_values"("valueDate");
