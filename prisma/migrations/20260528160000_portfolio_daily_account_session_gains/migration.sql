-- CreateTable
CREATE TABLE "portfolio_daily_account_session_gains" (
    "id" TEXT NOT NULL,
    "sessionDate" DATE NOT NULL,
    "accountKey" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "gainNative" DOUBLE PRECISION NOT NULL,
    "priorNative" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'holdings_closes',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_daily_account_session_gains_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portfolio_daily_account_session_gains_sessionDate_accountKey_key" ON "portfolio_daily_account_session_gains"("sessionDate", "accountKey");
CREATE INDEX "portfolio_daily_account_session_gains_sessionDate_idx" ON "portfolio_daily_account_session_gains"("sessionDate");
CREATE INDEX "portfolio_daily_account_session_gains_accountKey_idx" ON "portfolio_daily_account_session_gains"("accountKey");
