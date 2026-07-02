-- Owner / Portfolio dimension (fondation sans changement UI)
CREATE TYPE "PortfolioKind" AS ENUM ('PERSONAL', 'HOUSEHOLD', 'CUSTOM');
CREATE TYPE "OwnerMappingSource" AS ENUM ('MANUAL', 'BACKFILL', 'IMPORT');

CREATE TABLE "owners" (
  "id" TEXT NOT NULL,
  "ownerKey" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "owners_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owners_ownerKey_key" ON "owners"("ownerKey");
CREATE INDEX "owners_displayName_idx" ON "owners"("displayName");

CREATE TABLE "portfolios" (
  "id" TEXT NOT NULL,
  "portfolioKey" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "kind" "PortfolioKind" NOT NULL DEFAULT 'CUSTOM',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portfolios_portfolioKey_key" ON "portfolios"("portfolioKey");
CREATE INDEX "portfolios_displayName_idx" ON "portfolios"("displayName");

CREATE TABLE "portfolio_owner_memberships" (
  "id" TEXT NOT NULL,
  "portfolioId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "weightPct" DOUBLE PRECISION NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portfolio_owner_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portfolio_owner_memberships_portfolioId_ownerId_key"
  ON "portfolio_owner_memberships"("portfolioId", "ownerId");
CREATE INDEX "portfolio_owner_memberships_ownerId_idx"
  ON "portfolio_owner_memberships"("ownerId");

ALTER TABLE "portfolio_owner_memberships"
  ADD CONSTRAINT "portfolio_owner_memberships_portfolioId_fkey"
  FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "portfolio_owner_memberships"
  ADD CONSTRAINT "portfolio_owner_memberships_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "owners"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "portfolio_owner_memberships"
  ADD CONSTRAINT "portfolio_owner_memberships_weightPct_positive"
  CHECK ("weightPct" > 0);

CREATE TABLE "portfolio_account_owners" (
  "id" TEXT NOT NULL,
  "accountKey" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "source" "OwnerMappingSource" NOT NULL DEFAULT 'BACKFILL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portfolio_account_owners_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portfolio_account_owners_accountKey_key"
  ON "portfolio_account_owners"("accountKey");
CREATE INDEX "portfolio_account_owners_ownerId_idx"
  ON "portfolio_account_owners"("ownerId");

ALTER TABLE "portfolio_account_owners"
  ADD CONSTRAINT "portfolio_account_owners_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "owners"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "external_portfolio_account_owners" (
  "id" TEXT NOT NULL,
  "externalAccountId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "source" "OwnerMappingSource" NOT NULL DEFAULT 'BACKFILL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_portfolio_account_owners_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_portfolio_account_owners_externalAccountId_key"
  ON "external_portfolio_account_owners"("externalAccountId");
CREATE INDEX "external_portfolio_account_owners_ownerId_idx"
  ON "external_portfolio_account_owners"("ownerId");

ALTER TABLE "external_portfolio_account_owners"
  ADD CONSTRAINT "external_portfolio_account_owners_externalAccountId_fkey"
  FOREIGN KEY ("externalAccountId") REFERENCES "external_portfolio_accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "external_portfolio_account_owners"
  ADD CONSTRAINT "external_portfolio_account_owners_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "owners"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "non_financial_asset_owner_shares" (
  "id" TEXT NOT NULL,
  "nonFinancialAssetId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "sharePct" DOUBLE PRECISION NOT NULL,
  "source" "OwnerMappingSource" NOT NULL DEFAULT 'BACKFILL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "non_financial_asset_owner_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "non_financial_asset_owner_shares_nonFinancialAssetId_ownerId_key"
  ON "non_financial_asset_owner_shares"("nonFinancialAssetId", "ownerId");
CREATE INDEX "non_financial_asset_owner_shares_ownerId_idx"
  ON "non_financial_asset_owner_shares"("ownerId");

ALTER TABLE "non_financial_asset_owner_shares"
  ADD CONSTRAINT "non_financial_asset_owner_shares_nonFinancialAssetId_fkey"
  FOREIGN KEY ("nonFinancialAssetId") REFERENCES "non_financial_assets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "non_financial_asset_owner_shares"
  ADD CONSTRAINT "non_financial_asset_owner_shares_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "owners"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "non_financial_asset_owner_shares"
  ADD CONSTRAINT "non_financial_asset_owner_shares_sharePct_positive"
  CHECK ("sharePct" > 0);
