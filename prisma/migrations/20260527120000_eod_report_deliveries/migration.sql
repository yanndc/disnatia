-- CreateTable
CREATE TABLE "eod_report_deliveries" (
    "sessionDate" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipient" TEXT NOT NULL,

    CONSTRAINT "eod_report_deliveries_pkey" PRIMARY KEY ("sessionDate")
);
