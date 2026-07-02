import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const numNonNeg = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? 0 : Number(v)),
  z.number().finite().nonnegative(),
);

const bodySchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  marketValue: numNonNeg,
  mortgageBalance: numNonNeg,
  notes: z.string().max(2000).optional().nullable(),
});

type RouteParams = { params: Promise<{ id: string }> };

function eq(marketValue: number, mortgageBalance: number): number {
  return Number((marketValue - mortgageBalance).toFixed(2));
}

export async function POST(request: Request, ctx: RouteParams) {
  const { id: nonFinancialAssetId } = await ctx.params;
  if (!nonFinancialAssetId) {
    return NextResponse.json({ error: "Identifiant manquant." }, { status: 400 });
  }

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

  if (parsed.data.mortgageBalance > parsed.data.marketValue) {
    return NextResponse.json(
      { error: "L'hypothèque ne peut pas dépasser la valeur marchande." },
      { status: 422 },
    );
  }

  const asset = await prisma.nonFinancialAsset.findUnique({
    where: { id: nonFinancialAssetId },
    select: { id: true },
  });
  if (!asset) {
    return NextResponse.json({ error: "Actif introuvable." }, { status: 404 });
  }

  const asOfDate = new Date(`${parsed.data.asOfDate}T12:00:00.000Z`);
  if (Number.isNaN(asOfDate.getTime())) {
    return NextResponse.json({ error: "Date invalide." }, { status: 422 });
  }

  try {
    const snap = await prisma.nonFinancialAssetSnapshot.upsert({
      where: {
        nonFinancialAssetId_asOfDate: {
          nonFinancialAssetId,
          asOfDate,
        },
      },
      create: {
        nonFinancialAssetId,
        asOfDate,
        marketValue: parsed.data.marketValue,
        mortgageBalance: parsed.data.mortgageBalance,
        netEquity: eq(parsed.data.marketValue, parsed.data.mortgageBalance),
        notes: parsed.data.notes?.trim() || null,
      },
      update: {
        marketValue: parsed.data.marketValue,
        mortgageBalance: parsed.data.mortgageBalance,
        netEquity: eq(parsed.data.marketValue, parsed.data.mortgageBalance),
        notes: parsed.data.notes?.trim() || null,
      },
    });

    return NextResponse.json({
      ok: true,
      snapshot: {
        id: snap.id,
        asOfDate: snap.asOfDate.toISOString().slice(0, 10),
        marketValue: snap.marketValue,
        mortgageBalance: snap.mortgageBalance,
        netEquity: snap.netEquity,
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Enregistrement impossible." }, { status: 500 });
  }
}
