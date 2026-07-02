import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { listNonFinancialAssetsWithLatest } from "@/features/portfolio/non-financial-assets-queries";
import { sanitizePortfolioOwner } from "@/lib/portfolio/sanitize-portfolio-owner";

const numNonNeg = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? 0 : Number(v)),
  z.number().finite().nonnegative(),
);

const createBodySchema = z.object({
  assetType: z.enum(["REAL_ESTATE", "VEHICLE", "PRIVATE_BUSINESS", "OTHER"]).optional(),
  displayLabel: z.string().min(1).max(240),
  currency: z.enum(["CAD", "USD"]).optional(),
  owner: z.string().max(200).optional().nullable(),
  initialSnapshot: z.object({
    asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    marketValue: numNonNeg,
    mortgageBalance: numNonNeg,
    notes: z.string().max(2000).optional().nullable(),
  }),
});

function eq(marketValue: number, mortgageBalance: number): number {
  return Number((marketValue - mortgageBalance).toFixed(2));
}

export async function GET() {
  try {
    const assets = await listNonFinancialAssetsWithLatest();
    return NextResponse.json({
      assets: assets.map((a) => ({
        ...a,
        latestSnapshot: a.latestSnapshot
          ? {
              asOfDate: a.latestSnapshot.asOfDate.toISOString().slice(0, 10),
              marketValue: a.latestSnapshot.marketValue,
              mortgageBalance: a.latestSnapshot.mortgageBalance,
              netEquity: a.latestSnapshot.netEquity,
            }
          : null,
      })),
    });
  } catch {
    return NextResponse.json({ error: "Impossible de charger les actifs non-boursiers." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const parsed = createBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Données invalides.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { displayLabel, currency, assetType, owner: ownerRaw, initialSnapshot } = parsed.data;
  const owner = sanitizePortfolioOwner(ownerRaw);
  const asOfDate = new Date(`${initialSnapshot.asOfDate}T12:00:00.000Z`);
  if (Number.isNaN(asOfDate.getTime())) {
    return NextResponse.json({ error: "Date snapshot invalide." }, { status: 422 });
  }

  if (initialSnapshot.mortgageBalance > initialSnapshot.marketValue) {
    return NextResponse.json(
      { error: "L'hypothèque ne peut pas dépasser la valeur marchande." },
      { status: 422 },
    );
  }

  const id = randomUUID();
  const assetKey = `asset:${id}`;

  try {
    const asset = await prisma.nonFinancialAsset.create({
      data: {
        id,
        assetKey,
        assetType: assetType ?? "REAL_ESTATE",
        displayLabel: displayLabel.trim(),
        owner,
        currency: currency ?? "CAD",
        snapshots: {
          create: {
            asOfDate,
            marketValue: initialSnapshot.marketValue,
            mortgageBalance: initialSnapshot.mortgageBalance,
            netEquity: eq(initialSnapshot.marketValue, initialSnapshot.mortgageBalance),
            notes: initialSnapshot.notes?.trim() || null,
          },
        },
      },
      include: {
        snapshots: { orderBy: { asOfDate: "desc" }, take: 1 },
      },
    });

    return NextResponse.json({
      ok: true,
      asset: {
        id: asset.id,
        assetKey: asset.assetKey,
        assetType: asset.assetType,
        displayLabel: asset.displayLabel,
        owner: asset.owner,
        currency: asset.currency,
        latestSnapshot: asset.snapshots[0]
          ? {
              asOfDate: asset.snapshots[0].asOfDate.toISOString().slice(0, 10),
              marketValue: asset.snapshots[0].marketValue,
              mortgageBalance: asset.snapshots[0].mortgageBalance,
              netEquity: asset.snapshots[0].netEquity,
            }
          : null,
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Erreur lors de la création de l'actif." }, { status: 500 });
  }
}
