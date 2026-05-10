import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const bodySchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalValue: z.number().finite().nonnegative(),
  notes: z.string().max(2000).optional().nullable(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: RouteParams) {
  const { id: externalAccountId } = await ctx.params;
  if (!externalAccountId) {
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

  const account = await prisma.externalPortfolioAccount.findUnique({
    where: { id: externalAccountId },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
  }

  const asOfDate = new Date(`${parsed.data.asOfDate}T12:00:00.000Z`);
  if (Number.isNaN(asOfDate.getTime())) {
    return NextResponse.json({ error: "Date invalide." }, { status: 422 });
  }

  try {
    const snap = await prisma.externalAccountSnapshot.upsert({
      where: {
        externalAccountId_asOfDate: {
          externalAccountId,
          asOfDate,
        },
      },
      create: {
        externalAccountId,
        asOfDate,
        totalValue: parsed.data.totalValue,
        notes: parsed.data.notes?.trim() || null,
      },
      update: {
        totalValue: parsed.data.totalValue,
        notes: parsed.data.notes?.trim() || null,
      },
    });

    return NextResponse.json({
      ok: true,
      snapshot: {
        id: snap.id,
        asOfDate: snap.asOfDate.toISOString().slice(0, 10),
        totalValue: snap.totalValue,
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Enregistrement impossible." }, { status: 500 });
  }
}
