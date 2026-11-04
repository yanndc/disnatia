import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { expectedCoverageSessionIso } from "@/features/portfolio/account-coverage";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ");

const bodySchema = z.object({
  accountKeys: z.array(z.string().min(1)).min(1).max(50),
  /** Dernier jour couvert par l'attestation (défaut : dernière séance attendue). */
  dataAsOf: isoDate.optional(),
  note: z.string().max(500).optional().nullable(),
});

/**
 * Attestation « aucune transaction depuis » pour un ou plusieurs comptes dormants.
 *
 * N'écrit **aucun** montant : `PortfolioAccountState` reste la référence du dernier
 * export portefeuille. On enregistre la date de confirmation et une copie des montants
 * attestés, à titre de preuve.
 */
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Données invalides.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { accountKeys, note } = parsed.data;
  const dataAsOfIso = parsed.data.dataAsOf ?? expectedCoverageSessionIso();
  const dataAsOf = new Date(`${dataAsOfIso}T00:00:00.000Z`);
  if (Number.isNaN(dataAsOf.getTime())) {
    return NextResponse.json({ error: "Date d'attestation invalide." }, { status: 422 });
  }

  const states = await prisma.portfolioAccountState.findMany({
    where: { accountKey: { in: accountKeys } },
    select: {
      accountKey: true,
      totalValue: true,
      cashValue: true,
      marketValue: true,
    },
  });

  if (states.length === 0) {
    return NextResponse.json(
      { error: "Aucun compte reconnu pour ces clés." },
      { status: 404 },
    );
  }

  const unknown = accountKeys.filter(
    (key) => !states.some((state) => state.accountKey === key),
  );

  const saved: { accountKey: string; dataAsOf: string; created: boolean }[] = [];
  for (const state of states) {
    const existing = await prisma.portfolioAccountConfirmation.findFirst({
      where: { accountKey: state.accountKey, dataAsOf },
      select: { id: true },
    });

    if (existing) {
      await prisma.portfolioAccountConfirmation.update({
        where: { id: existing.id },
        data: {
          confirmedAt: new Date(),
          source: "MANUAL",
          note: note?.trim() || null,
          totalValue: state.totalValue,
          cashValue: state.cashValue,
          marketValue: state.marketValue,
        },
      });
      saved.push({ accountKey: state.accountKey, dataAsOf: dataAsOfIso, created: false });
      continue;
    }

    await prisma.portfolioAccountConfirmation.create({
      data: {
        accountKey: state.accountKey,
        dataAsOf,
        source: "MANUAL",
        note: note?.trim() || null,
        totalValue: state.totalValue,
        cashValue: state.cashValue,
        marketValue: state.marketValue,
      },
    });
    saved.push({ accountKey: state.accountKey, dataAsOf: dataAsOfIso, created: true });
  }

  return NextResponse.json({
    ok: true,
    dataAsOf: dataAsOfIso,
    confirmations: saved,
    unknownAccountKeys: unknown,
  });
}
