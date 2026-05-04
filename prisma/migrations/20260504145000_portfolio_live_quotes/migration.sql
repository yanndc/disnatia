-- CreateTable
CREATE TABLE "portfolio_live_quotes" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "yahooSymbol" TEXT,

    CONSTRAINT "portfolio_live_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_live_quotes_ticker_currency_key" ON "portfolio_live_quotes"("ticker", "currency");
