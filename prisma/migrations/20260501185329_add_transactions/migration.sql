-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('PORTFOLIO', 'POSITIONS', 'TRANSACTIONS', 'MIXED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "portfolio_imports" ADD COLUMN     "importType" "ImportType" NOT NULL DEFAULT 'PORTFOLIO';

-- CreateTable
CREATE TABLE "portfolio_transaction_lines" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "accountName" TEXT,
    "accountNumber" TEXT,
    "tradeDate" TIMESTAMP(3),
    "settlementDate" TIMESTAMP(3),
    "transactionType" TEXT,
    "ticker" TEXT,
    "securityName" TEXT,
    "currency" TEXT,
    "quantity" DOUBLE PRECISION,
    "price" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "fees" DOUBLE PRECISION,
    "rawJson" JSONB NOT NULL,

    CONSTRAINT "portfolio_transaction_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portfolio_transaction_lines_importId_idx" ON "portfolio_transaction_lines"("importId");

-- CreateIndex
CREATE INDEX "portfolio_transaction_lines_ticker_idx" ON "portfolio_transaction_lines"("ticker");

-- CreateIndex
CREATE INDEX "portfolio_transaction_lines_tradeDate_idx" ON "portfolio_transaction_lines"("tradeDate");

-- AddForeignKey
ALTER TABLE "portfolio_transaction_lines" ADD CONSTRAINT "portfolio_transaction_lines_importId_fkey" FOREIGN KEY ("importId") REFERENCES "portfolio_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
