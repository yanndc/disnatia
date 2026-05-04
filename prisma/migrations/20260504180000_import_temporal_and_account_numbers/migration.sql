-- AlterTable
ALTER TABLE "portfolio_imports" ADD COLUMN "dataFromDate" TIMESTAMP(3),
ADD COLUMN "dataToDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "portfolio_accounts" ADD COLUMN "accountNumber" TEXT;

-- AlterTable
ALTER TABLE "portfolio_positions" ADD COLUMN "accountNumber" TEXT;

-- CreateIndex
CREATE INDEX "portfolio_accounts_accountNumber_idx" ON "portfolio_accounts"("accountNumber");

-- CreateIndex
CREATE INDEX "portfolio_positions_accountNumber_idx" ON "portfolio_positions"("accountNumber");
