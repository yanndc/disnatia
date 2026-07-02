-- Actifs non-boursiers (ex. maison) pour patrimoine net
CREATE TYPE "NonFinancialAssetType" AS ENUM ('REAL_ESTATE', 'VEHICLE', 'PRIVATE_BUSINESS', 'OTHER');

CREATE TABLE "non_financial_assets" (
    "id" TEXT NOT NULL,
    "assetKey" TEXT NOT NULL,
    "assetType" "NonFinancialAssetType" NOT NULL DEFAULT 'REAL_ESTATE',
    "displayLabel" TEXT NOT NULL,
    "owner" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "non_financial_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "non_financial_asset_snapshots" (
    "id" TEXT NOT NULL,
    "nonFinancialAssetId" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "marketValue" DOUBLE PRECISION NOT NULL,
    "mortgageBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netEquity" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "non_financial_asset_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "non_financial_assets_assetKey_key" ON "non_financial_assets"("assetKey");
CREATE INDEX "non_financial_assets_owner_idx" ON "non_financial_assets"("owner");
CREATE INDEX "non_financial_assets_assetType_idx" ON "non_financial_assets"("assetType");
CREATE INDEX "non_financial_assets_isActive_idx" ON "non_financial_assets"("isActive");

CREATE UNIQUE INDEX "non_financial_asset_snapshots_nonFinancialAssetId_asOfDate_key"
  ON "non_financial_asset_snapshots"("nonFinancialAssetId", "asOfDate");
CREATE INDEX "non_financial_asset_snapshots_nonFinancialAssetId_idx"
  ON "non_financial_asset_snapshots"("nonFinancialAssetId");
CREATE INDEX "non_financial_asset_snapshots_asOfDate_idx"
  ON "non_financial_asset_snapshots"("asOfDate");

ALTER TABLE "non_financial_asset_snapshots"
  ADD CONSTRAINT "non_financial_asset_snapshots_nonFinancialAssetId_fkey"
  FOREIGN KEY ("nonFinancialAssetId") REFERENCES "non_financial_assets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "non_financial_asset_snapshots"
  ADD CONSTRAINT "non_financial_asset_snapshots_marketValue_non_negative"
  CHECK ("marketValue" >= 0);

ALTER TABLE "non_financial_asset_snapshots"
  ADD CONSTRAINT "non_financial_asset_snapshots_mortgageBalance_non_negative"
  CHECK ("mortgageBalance" >= 0);

ALTER TABLE "non_financial_asset_snapshots"
  ADD CONSTRAINT "non_financial_asset_snapshots_netEquity_consistent"
  CHECK (ABS("netEquity" - ("marketValue" - "mortgageBalance")) < 0.0001);
