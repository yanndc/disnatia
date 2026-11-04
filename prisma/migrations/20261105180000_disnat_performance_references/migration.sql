-- Référence de rendement Disnat par client et période (onglet « Rendement de portefeuille »)
-- pour mesurer l'écart avec les TWR calculés par l'application.

CREATE TABLE "disnat_performance_references" (
  "id" TEXT NOT NULL,
  "clientCode" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "valuePct" DOUBLE PRECISION NOT NULL,
  "referenceDate" DATE NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "disnat_performance_references_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "disnat_performance_references_clientCode_period_referenceDate_key"
  ON "disnat_performance_references"("clientCode", "period", "referenceDate");
CREATE INDEX "disnat_performance_references_referenceDate_idx"
  ON "disnat_performance_references"("referenceDate");
