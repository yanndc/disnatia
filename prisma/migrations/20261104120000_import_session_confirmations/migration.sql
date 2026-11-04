-- Session d'import guidée Disnat :
-- 1) attestations « aucune transaction depuis » par compte (comptes dormants)
-- 2) règles d'attribution fichier → compte (les exports transactions n'ont pas de numéro de compte)

CREATE TABLE "portfolio_account_confirmations" (
  "id" TEXT NOT NULL,
  "accountKey" TEXT NOT NULL,
  "dataAsOf" DATE NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "note" TEXT,
  "totalValue" DOUBLE PRECISION,
  "cashValue" DOUBLE PRECISION,
  "marketValue" DOUBLE PRECISION,
  CONSTRAINT "portfolio_account_confirmations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "portfolio_account_confirmations_accountKey_dataAsOf_idx"
  ON "portfolio_account_confirmations"("accountKey", "dataAsOf");

CREATE INDEX "portfolio_account_confirmations_confirmedAt_idx"
  ON "portfolio_account_confirmations"("confirmedAt");

CREATE TABLE "portfolio_import_attribution_rules" (
  "id" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "accountKey" TEXT NOT NULL,
  "sampleFileName" TEXT NOT NULL,
  "hits" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portfolio_import_attribution_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portfolio_import_attribution_rules_signature_key"
  ON "portfolio_import_attribution_rules"("signature");

CREATE INDEX "portfolio_import_attribution_rules_accountKey_idx"
  ON "portfolio_import_attribution_rules"("accountKey");
