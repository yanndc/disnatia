-- Propriétaire optionnel pour comptes externes (aligné sur PortfolioAccountState.owner)
ALTER TABLE "external_portfolio_accounts" ADD COLUMN IF NOT EXISTS "owner" TEXT;

CREATE INDEX IF NOT EXISTS "external_portfolio_accounts_owner_idx" ON "external_portfolio_accounts"("owner");
