import { NextResponse } from "next/server";
import {
  buildPortfolioSnapshot,
  computeSnapshotTemporalBounds,
  parseDisnatCsv,
  validateDisnatInvestmentExportFile,
} from "@/lib/csv/disnat";
import { importFileToParseText } from "@/lib/csv/import-file-text";
import { prisma } from "@/lib/db/prisma";
import { getImportHistory } from "@/features/portfolio/queries";
import { refreshLiveQuotesForLatestImport } from "@/features/portfolio/refresh-live-quotes";
import { upsertPortfolioStateFromSnapshot } from "@/features/portfolio/upsert-portfolio-state";
import { Prisma } from "@/generated/prisma/client";

export async function GET() {
  try {
    const imports = await getImportHistory();
    return NextResponse.json({ imports });
  } catch {
    return NextResponse.json({ imports: [] });
  }
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Aucun fichier reçu." },
      { status: 400 },
    );
  }

  let fileText: string;
  try {
    fileText = await importFileToParseText(file);
  } catch (cause) {
    return NextResponse.json(
      {
        error:
          cause instanceof Error
            ? cause.message
            : "Impossible de lire le fichier.",
      },
      { status: 400 },
    );
  }
  const parsed = parseDisnatCsv(fileText);
  const disnatCheck = validateDisnatInvestmentExportFile({
    rawText: fileText,
    headers: parsed.headers,
    importKind: parsed.importKind,
  });

  if (!disnatCheck.ok) {
    return NextResponse.json(
      {
        error: disnatCheck.message,
        details: parsed.errors.map((error) => error.message),
      },
      { status: 422 },
    );
  }

  const snapshot = buildPortfolioSnapshot(parsed.rows);

  if (
    snapshot.positions.length === 0 &&
    snapshot.accounts.length === 0 &&
    snapshot.transactions.length === 0
  ) {
    return NextResponse.json(
      {
        error:
          "Le fichier a été lu, mais aucune position ou encaisse exploitable n'a été détectée.",
        details: [...parsed.errors.map((error) => error.message), ...snapshot.warnings],
      },
      { status: 422 },
    );
  }

  const savedImport = await prisma.$transaction(async (tx) => {
    const temporal = computeSnapshotTemporalBounds(snapshot);
    const portfolioImport = await tx.portfolioImport.create({
      data: {
        sourceFileName: file.name,
        status: "COMPLETED",
        importType: snapshot.importKind,
        rawHeaderJson: parsed.headers,
        rawRowCount: parsed.rows.length,
        notes: snapshot.warnings.length > 0 ? snapshot.warnings.join("\n") : null,
        dataFromDate: temporal.dataFrom ?? undefined,
        dataToDate: temporal.dataTo ?? undefined,
      },
    });

    const accountIdByKey = new Map<string, string>();
    function accountRowKey(input: {
      accountName: string;
      currency: string;
      accountNumber?: string | null;
    }) {
      const n = input.accountNumber?.replace(/\s/g, "") ?? "";
      if (n) {
        return `${n}|${input.currency}`;
      }
      return `name:${input.accountName}|${input.currency}`;
    }

    for (const account of snapshot.accounts) {
      const created = await tx.portfolioAccount.create({
        data: {
          importId: portfolioImport.id,
          accountName: account.accountName,
          accountNumber: account.accountNumber ?? null,
          accountType: account.accountType,
          currency: account.currency,
          cashValue: account.cashValue,
          marketValue: account.marketValue,
          totalValue: account.totalValue,
        },
      });
      accountIdByKey.set(accountRowKey(account), created.id);
    }

    if (snapshot.positions.length > 0) {
      await tx.portfolioPosition.createMany({
        data: snapshot.positions.map((position) => ({
          importId: portfolioImport.id,
          accountId:
            accountIdByKey.get(accountRowKey(position)) ??
            null,
          accountNumber: position.accountNumber ?? null,
          ticker: position.ticker,
          securityName: position.securityName,
          currency: position.currency,
          quantity: position.quantity,
          averageCost: position.averageCost,
          marketPrice: position.marketPrice,
          marketValue: position.marketValue,
          unrealizedGainLoss: position.unrealizedGainLoss,
          weightPct: position.weightPct,
          sector: position.sector,
          assetType: position.assetType,
        })),
      });
    }

    if (snapshot.transactions.length > 0) {
      await tx.portfolioTransactionLine.createMany({
        data: snapshot.transactions.map((transaction) => ({
          importId: portfolioImport.id,
          accountName: transaction.accountName,
          accountNumber: transaction.accountNumber,
          tradeDate: transaction.tradeDate,
          settlementDate: transaction.settlementDate,
          transactionType: transaction.transactionType,
          ticker: transaction.ticker,
          securityName: transaction.securityName,
          currency: transaction.currency,
          quantity: transaction.quantity,
          price: transaction.price,
          amount: transaction.amount,
          fees: transaction.fees,
          rawJson: transaction.rawJson as Prisma.InputJsonValue,
        })),
      });
    }

    return portfolioImport;
  });

  // Mise à jour des tables d'état courant synthétisé (PortfolioHolding / PortfolioAccountState)
  if (snapshot.positions.length > 0 || snapshot.accounts.length > 0) {
    const temporal = computeSnapshotTemporalBounds(snapshot);
    const asOf = temporal.dataTo ?? savedImport.importedAt;
    void upsertPortfolioStateFromSnapshot(snapshot, savedImport.id, asOf).catch(() => {});
  }

  if (snapshot.positions.length > 0) {
    void refreshLiveQuotesForLatestImport().catch(() => {});
  }

  return NextResponse.json({
    import: savedImport,
    parsed: {
      headers: parsed.headers,
      importKind: snapshot.importKind,
      rowCount: parsed.rows.length,
      previewRows: parsed.rows.slice(0, 20),
      warnings: snapshot.warnings,
      errors: parsed.errors,
    },
  });
}
