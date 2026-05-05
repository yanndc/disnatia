-- CreateTable
CREATE TABLE "usd_cad_daily_rates" (
    "id" TEXT NOT NULL,
    "rate_date" DATE NOT NULL,
    "usd_to_cad" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'frankfurter',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usd_cad_daily_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usd_cad_daily_rates_rate_date_key" ON "usd_cad_daily_rates"("rate_date");

-- CreateIndex
CREATE INDEX "usd_cad_daily_rates_rate_date_idx" ON "usd_cad_daily_rates"("rate_date");
