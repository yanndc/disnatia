-- Colonnes type Disnat / intraday (Yahoo) et valeur d'emprunt (import).
ALTER TABLE "portfolio_live_quotes"
ADD COLUMN IF NOT EXISTS "change_amount" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "previous_close" DOUBLE PRECISION;

ALTER TABLE "portfolio_positions"
ADD COLUMN IF NOT EXISTS "loan_value" DOUBLE PRECISION;

ALTER TABLE "portfolio_holdings"
ADD COLUMN IF NOT EXISTS "loan_value" DOUBLE PRECISION;
