-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant', 'system', 'tool');

-- CreateTable
CREATE TABLE "portfolio_imports" (
    "id" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ImportStatus" NOT NULL DEFAULT 'COMPLETED',
    "rawHeaderJson" JSONB NOT NULL,
    "rawRowCount" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "portfolio_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_accounts" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountType" TEXT,
    "currency" TEXT NOT NULL,
    "cashValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marketValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "portfolio_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_positions" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "accountId" TEXT,
    "ticker" TEXT NOT NULL,
    "securityName" TEXT,
    "currency" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "averageCost" DOUBLE PRECISION,
    "marketPrice" DOUBLE PRECISION,
    "marketValue" DOUBLE PRECISION NOT NULL,
    "unrealizedGainLoss" DOUBLE PRECISION,
    "weightPct" DOUBLE PRECISION,
    "sector" TEXT,
    "assetType" TEXT,

    CONSTRAINT "portfolio_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Conversation portefeuille',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataJson" JSONB,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portfolio_accounts_importId_idx" ON "portfolio_accounts"("importId");

-- CreateIndex
CREATE INDEX "portfolio_positions_importId_idx" ON "portfolio_positions"("importId");

-- CreateIndex
CREATE INDEX "portfolio_positions_ticker_idx" ON "portfolio_positions"("ticker");

-- CreateIndex
CREATE INDEX "chat_messages_sessionId_idx" ON "chat_messages"("sessionId");

-- AddForeignKey
ALTER TABLE "portfolio_accounts" ADD CONSTRAINT "portfolio_accounts_importId_fkey" FOREIGN KEY ("importId") REFERENCES "portfolio_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_positions" ADD CONSTRAINT "portfolio_positions_importId_fkey" FOREIGN KEY ("importId") REFERENCES "portfolio_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_positions" ADD CONSTRAINT "portfolio_positions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "portfolio_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
