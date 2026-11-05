-- Encaisse officielle par client Disnat, capturée via le favori « Vue d'ensemble »
-- (ligne « Total des actifs »). Alimente l'encaisse aux bornes des calculs de rendement.
CREATE TABLE "disnat_client_cash_snapshots" (
    "id" TEXT NOT NULL,
    "clientCode" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "cashCad" DOUBLE PRECISION NOT NULL,
    "securitiesCad" DOUBLE PRECISION NOT NULL,
    "totalCad" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'BOOKMARKLET',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disnat_client_cash_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "disnat_client_cash_snapshots_clientCode_asOfDate_key" ON "disnat_client_cash_snapshots"("clientCode", "asOfDate");
CREATE INDEX "disnat_client_cash_snapshots_asOfDate_idx" ON "disnat_client_cash_snapshots"("asOfDate");
