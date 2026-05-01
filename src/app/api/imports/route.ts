import { NextResponse } from "next/server";
import { parseDisnatCsv, buildPortfolioSnapshot } from "@/lib/csv/disnat";
import { prisma } from "@/lib/db/prisma";
import { getImportHistory } from "@/features/portfolio/queries";

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
      { error: "Aucun fichier CSV reçu." },
      { status: 400 },
    );
  }

  const fileText = await file.text();
  const parsed = parseDisnatCsv(fileText);
  const snapshot = buildPortfolioSnapshot(parsed.rows);

  if (snapshot.positions.length === 0 && snapshot.accounts.length === 0) {
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
    const portfolioImport = await tx.portfolioImport.create({
      data: {
        sourceFileName: file.name,
        status: "COMPLETED",
        rawHeaderJson: parsed.headers,
        rawRowCount: parsed.rows.length,
        notes: snapshot.warnings.length > 0 ? snapshot.warnings.join("\n") : null,
      },
    });

    const accountIdByKey = new Map<string, string>();
    for (const account of snapshot.accounts) {
      const created = await tx.portfolioAccount.create({
        data: {
          importId: portfolioImport.id,
          accountName: account.accountName,
          accountType: account.accountType,
          currency: account.currency,
          cashValue: account.cashValue,
          marketValue: account.marketValue,
          totalValue: account.totalValue,
        },
      });
      accountIdByKey.set(`${account.accountName}-${account.currency}`, created.id);
    }

    if (snapshot.positions.length > 0) {
      await tx.portfolioPosition.createMany({
        data: snapshot.positions.map((position) => ({
          importId: portfolioImport.id,
          accountId:
            accountIdByKey.get(`${position.accountName}-${position.currency}`) ??
            null,
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

    return portfolioImport;
  });

  return NextResponse.json({
    import: savedImport,
    parsed: {
      headers: parsed.headers,
      rowCount: parsed.rows.length,
      previewRows: parsed.rows.slice(0, 20),
      warnings: snapshot.warnings,
      errors: parsed.errors,
    },
  });
}
