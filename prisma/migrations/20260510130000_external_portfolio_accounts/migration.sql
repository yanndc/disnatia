-- Comptes hors Disnat + snapshots de valeur manuels
CREATE TABLE "external_portfolio_accounts" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "portalUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_portfolio_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_account_snapshots" (
    "id" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "totalValue" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_account_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_portfolio_accounts_accountKey_key" ON "external_portfolio_accounts"("accountKey");

CREATE UNIQUE INDEX "external_account_snapshots_externalAccountId_asOfDate_key" ON "external_account_snapshots"("externalAccountId", "asOfDate");

CREATE INDEX "external_account_snapshots_externalAccountId_idx" ON "external_account_snapshots"("externalAccountId");

CREATE INDEX "external_account_snapshots_asOfDate_idx" ON "external_account_snapshots"("asOfDate");

CREATE INDEX "external_portfolio_accounts_provider_idx" ON "external_portfolio_accounts"("provider");

ALTER TABLE "external_account_snapshots" ADD CONSTRAINT "external_account_snapshots_externalAccountId_fkey" FOREIGN KEY ("externalAccountId") REFERENCES "external_portfolio_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
