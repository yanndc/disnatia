-- CreateEnum
CREATE TYPE "TxCategory" AS ENUM ('BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'TAX_WITHHOLD', 'CONTRIBUTION', 'TRANSFER_IN', 'TRANSFER_OUT', 'INTERNAL_TRANSFER', 'REVERSAL', 'FEE', 'STOCK_SPLIT', 'STOCK_DIVIDEND', 'EXCHANGE', 'TERMINATION', 'JOURNAL', 'OTHER');

-- AlterTable
ALTER TABLE "portfolio_account_states" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "portfolio_holdings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "portfolio_transaction_lines" ADD COLUMN     "accountKey" TEXT,
ADD COLUMN     "assetClass" TEXT,
ADD COLUMN     "market" TEXT,
ADD COLUMN     "priceDevise" TEXT,
ADD COLUMN     "txCategory" "TxCategory";

-- CreateIndex
CREATE INDEX "portfolio_transaction_lines_accountKey_idx" ON "portfolio_transaction_lines"("accountKey");

-- CreateIndex
CREATE INDEX "portfolio_transaction_lines_txCategory_idx" ON "portfolio_transaction_lines"("txCategory");
