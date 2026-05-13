import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  buildPortfolioSnapshot,
  computeSnapshotTemporalBounds,
  parseDisnatCsv,
  validateDisnatInvestmentExportFile,
} from "@/lib/csv/disnat";
import {
  decodeCsvBuffer,
  isExcelLike,
  workbookBufferToPlainText,
} from "@/lib/csv/import-file-text";
import { prisma } from "@/lib/db/prisma";
import { getImportHistory } from "@/features/portfolio/queries";
import {
  PROJECTED_HOLDINGS_SOURCE_ID,
  projectHoldingsFromTransactions,
} from "@/features/portfolio/project-transaction-holdings";
import { refreshLiveQuotesForLatestImport } from "@/features/portfolio/refresh-live-quotes";
import { upsertPortfolioStateFromSnapshot } from "@/features/portfolio/upsert-portfolio-state";
import { Prisma } from "@/generated/prisma/client";
import type { TxCategory } from "@/generated/prisma/enums";
import {
  GLOBAL_TRANSACTION_DUPLICATE_SCOPE,
  txFingerprint,
} from "@/lib/csv/tx-fingerprint";

/** Réponse API : ne jamais sérialiser `sourceFileContent` (BYTEA). */
function portfolioImportForJson<T extends { sourceFileContent?: unknown }>(
  row: T,
): Omit<T, "sourceFileContent"> {
  const { sourceFileContent: _omit, ...rest } = row;
  return rest;
}

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
  const accountKey = formData.get("accountKey");
  const accountLabel = formData.get("accountLabel");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Aucun fichier reçu." },
      { status: 400 },
    );
  }

  let fileText: string;
  let sourceBuffer: Buffer;
  try {
    const arrayBuffer = await file.arrayBuffer();
    sourceBuffer = Buffer.from(arrayBuffer);
    fileText = isExcelLike(file.name, file.type)
      ? workbookBufferToPlainText(arrayBuffer)
      : decodeCsvBuffer(arrayBuffer);
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

  const snapshot = buildPortfolioSnapshot(parsed.rows, parsed.ownerMap);
  const fileSha = createHash("sha256").update(fileText).digest("hex");
  const fileShaTag = `fileSha:${fileSha}`;

  /** Portefeuille sans opérations : évite une 2ᵉ ligne de journal pour le même fichier binaire. */
  if (
    snapshot.transactions.length === 0 &&
    (snapshot.positions.length > 0 || snapshot.accounts.length > 0)
  ) {
    const duplicatePortfolio = await prisma.portfolioImport.findFirst({
      where: { notes: { contains: fileShaTag } },
      orderBy: { importedAt: "desc" },
      select: { id: true, importedAt: true },
    });
    if (duplicatePortfolio) {
      return NextResponse.json(
        {
          error:
            "Ce fichier portefeuille a déjà été importé (contenu identique). Supprime l’entrée dans l’historique si tu dois la réenregistrer.",
          duplicateImportId: duplicatePortfolio.id,
        },
        { status: 409 },
      );
    }
  }

  // Pour un fichier de transactions, un compte doit être sélectionné
  if (snapshot.importKind === "TRANSACTIONS" || snapshot.transactions.length > 0) {
    if (!accountKey || typeof accountKey !== "string") {
      // Vérifier si des comptes existent
      const knownAccountsCount = await prisma.portfolioAccountState.count();
      if (knownAccountsCount === 0) {
        return NextResponse.json(
          {
            error:
              "Aucun compte connu. Importez d'abord un fichier portefeuille (CSV exporté depuis Disnat) pour identifier vos comptes.",
          },
          { status: 422 },
        );
      }
      return NextResponse.json(
        { error: "Sélectionnez le compte auquel appartiennent ces transactions." },
        { status: 422 },
      );
    }

    const incomingGlobalFingerprints = new Set(
      snapshot.transactions.map((transaction) =>
        txFingerprint(GLOBAL_TRANSACTION_DUPLICATE_SCOPE, transaction),
      ),
    );

    if (incomingGlobalFingerprints.size > 0) {
      const existingTransactions = await prisma.portfolioTransactionLine.findMany({
        select: {
          accountKey: true,
          tradeDate: true,
          settlementDate: true,
          transactionType: true,
          ticker: true,
          amount: true,
          currency: true,
          quantity: true,
          price: true,
          securityName: true,
        },
      });

      const matchedAccounts = new Set<string>();
      const matchedGlobalFingerprints = new Set<string>();

      for (const transaction of existingTransactions) {
        const globalFingerprint = txFingerprint(
          GLOBAL_TRANSACTION_DUPLICATE_SCOPE,
          transaction,
        );
        if (!incomingGlobalFingerprints.has(globalFingerprint)) continue;

        matchedGlobalFingerprints.add(globalFingerprint);
        if (transaction.accountKey) {
          matchedAccounts.add(transaction.accountKey);
        }
      }

      if (matchedGlobalFingerprints.size === incomingGlobalFingerprints.size) {
        const accountHint =
          matchedAccounts.size > 0
            ? ` Comptes déjà associés : ${Array.from(matchedAccounts).join(", ")}.`
            : "";

        return NextResponse.json(
          {
            error:
              "Ce fichier de transactions semble déjà avoir été importé. Supprime l'import existant si tu veux le réassocier à un autre compte." +
              accountHint,
          },
          { status: 409 },
        );
      }
    }
  }

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

  const savedResult = await prisma.$transaction(async (tx) => {
    const temporal = computeSnapshotTemporalBounds(snapshot);
    const portfolioImport = await tx.portfolioImport.create({
      data: {
        sourceFileName: file.name,
        sourceFileContent: new Uint8Array(sourceBuffer),
        sourceFileKept: true,
        status: "COMPLETED",
        importType: snapshot.importKind,
        rawHeaderJson: parsed.headers,
        rawRowCount: parsed.rows.length,
        notes: [
        accountLabel ? `Compte : ${String(accountLabel)}` : null,
        snapshot.warnings.length > 0 ? snapshot.warnings.join("\n") : null,
        fileShaTag,
      ]
        .filter(Boolean)
        .join("\n") || fileShaTag,
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
          loanValue: position.loanValue ?? null,
          weightPct: position.weightPct,
          sector: position.sector,
          assetType: position.assetType,
        })),
      });
    }

    let txInserted = 0;
    if (snapshot.transactions.length > 0) {
      const ak = typeof accountKey === "string" ? accountKey : null;
      const result = await tx.portfolioTransactionLine.createMany({
        skipDuplicates: true,
        data: snapshot.transactions.map((transaction) => ({
          importId: portfolioImport.id,
          accountKey: ak,
          accountName: transaction.accountName,
          accountNumber: transaction.accountNumber,
          tradeDate: transaction.tradeDate,
          settlementDate: transaction.settlementDate,
          transactionType: transaction.transactionType,
          txCategory: (transaction.txCategory as TxCategory | undefined) ?? null,
          ticker: transaction.ticker,
          securityName: transaction.securityName,
          market: transaction.market ?? null,
          currency: transaction.currency,
          priceDevise: transaction.priceDevise ?? null,
          assetClass: transaction.assetClass ?? null,
          quantity: transaction.quantity,
          price: transaction.price,
          amount: transaction.amount,
          fees: transaction.fees,
          rawJson: transaction.rawJson as Prisma.InputJsonValue,
          fingerprint: ak ? txFingerprint(ak, transaction) : null,
        })),
      });
      txInserted = result.count;
    }

    return { portfolioImport, txInserted, txTotal: snapshot.transactions.length };
  });

  const { portfolioImport: savedImport, txInserted, txTotal } = savedResult;
  const txSkipped = txTotal - txInserted;

  if (snapshot.transactions.length > 0 && txInserted === 0) {
    await prisma.portfolioImport.delete({ where: { id: savedImport.id } });
    return NextResponse.json(
      {
        error:
          "Aucune nouvelle transaction : tout était déjà importé (ou doublons ignorés). La ligne de journal n’a pas été créée.",
      },
      { status: 409 },
    );
  }

  if (snapshot.positions.length > 0 || snapshot.accounts.length > 0) {
    const temporal = computeSnapshotTemporalBounds(snapshot);
    const asOf = temporal.dataTo ?? savedImport.importedAt;
    await upsertPortfolioStateFromSnapshot(snapshot, savedImport.id, asOf);

    await prisma.portfolioHolding.deleteMany({
      where: { NOT: { sourceImportId: PROJECTED_HOLDINGS_SOURCE_ID } },
    });

    if ((await prisma.portfolioTransactionLine.count()) > 0) {
      await projectHoldingsFromTransactions().catch((error) => {
        console.error("Projection après import portefeuille échouée", error);
      });
    }

    await refreshLiveQuotesForLatestImport().catch(() => {});
  }

  if (snapshot.transactions.length > 0) {
    await projectHoldingsFromTransactions().catch((error) => {
      console.error("Projection des positions depuis transactions échouée", error);
    });
    await refreshLiveQuotesForLatestImport().catch(() => {});
  }

  return NextResponse.json({
    import: portfolioImportForJson(savedImport),
    parsed: {
      headers: parsed.headers,
      importKind: snapshot.importKind,
      rowCount: parsed.rows.length,
      previewRows: parsed.rows.slice(0, 20),
      warnings: snapshot.warnings,
      errors: parsed.errors,
    },
    txInserted,
    txSkipped,
  });
}
