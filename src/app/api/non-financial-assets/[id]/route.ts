import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sanitizePortfolioOwner } from "@/lib/portfolio/sanitize-portfolio-owner";
import { replaceNonFinancialAssetOwnerShares } from "@/lib/portfolio/owner-dimension-write";

type RouteParams = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  displayLabel: z.string().min(1).max(240).optional(),
  owner: z.union([z.string().max(200), z.literal(""), z.null()]).optional(),
  coOwners: z
    .array(
      z.object({
        owner: z.string().max(200),
        sharePct: z.number().finite().gt(0).lte(100),
      }),
    )
    .max(4)
    .optional(),
  currency: z.enum(["CAD", "USD"]).optional(),
  assetType: z.enum(["REAL_ESTATE", "VEHICLE", "PRIVATE_BUSINESS", "OTHER"]).optional(),
  isActive: z.boolean().optional(),
});

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function PATCH(request: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Identifiant manquant." }, { status: 400 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Données invalides.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const d = parsed.data;

  const existing = await prisma.nonFinancialAsset.findUnique({
    where: { id },
    select: { owner: true, metadata: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Actif introuvable." }, { status: 404 });
  }

  const ownerValue =
    d.owner === undefined
      ? undefined
      : d.owner === null || String(d.owner).trim() === ""
        ? null
        : sanitizePortfolioOwner(String(d.owner));

  const finalOwner = ownerValue === undefined ? sanitizePortfolioOwner(existing.owner) : ownerValue;
  const coOwners = (d.coOwners ?? [])
    .map((x) => ({
      owner: sanitizePortfolioOwner(x.owner),
      sharePct: x.sharePct,
    }))
    .filter((x): x is { owner: string; sharePct: number } => Boolean(x.owner));

  if (d.coOwners !== undefined) {
    if (coOwners.length > 0 && !finalOwner) {
      return NextResponse.json(
        { error: "Le copropriétaire 1 est requis si un copropriétaire 2 est fourni." },
        { status: 422 },
      );
    }
    const coOwnersTotal = coOwners.reduce((s, x) => s + x.sharePct, 0);
    if (coOwnersTotal >= 100) {
      return NextResponse.json(
        { error: "La somme des parts de copropriétaires doit rester inférieure à 100%." },
        { status: 422 },
      );
    }
  }

  const ownerShares =
    d.coOwners !== undefined && finalOwner && coOwners.length > 0
      ? [
          { owner: finalOwner, sharePct: Number((100 - coOwners.reduce((s, x) => s + x.sharePct, 0)).toFixed(6)) },
          ...coOwners,
        ]
      : null;

  const ownerSharesForDimension =
    d.coOwners !== undefined
      ? finalOwner && coOwners.length > 0
        ? [
            { owner: finalOwner, sharePct: Number((100 - coOwners.reduce((s, x) => s + x.sharePct, 0)).toFixed(6)) },
            ...coOwners,
          ]
        : finalOwner
          ? [{ owner: finalOwner, sharePct: 100 }]
          : []
      : null;

  const baseMetadata = asRecord(existing.metadata);
  const mergedMetadata: Prisma.NonFinancialAssetUpdateInput["metadata"] | undefined =
    d.coOwners !== undefined
      ? (() => {
          const next = baseMetadata ? { ...baseMetadata } : {};
          if (ownerShares && ownerShares.length > 0) {
            next.ownerShares = ownerShares;
            return next as Prisma.InputJsonValue;
          }
          delete next.ownerShares;
          return Object.keys(next).length > 0 ? (next as Prisma.InputJsonValue) : Prisma.DbNull;
        })()
      : undefined;

  try {
    await prisma.nonFinancialAsset.update({
      where: { id },
      data: {
        displayLabel: d.displayLabel?.trim(),
        owner: ownerValue,
        currency: d.currency,
        assetType: d.assetType,
        isActive: d.isActive,
        metadata: mergedMetadata,
      },
    });

    if (d.owner !== undefined || d.coOwners !== undefined) {
      await replaceNonFinancialAssetOwnerShares(
        id,
        ownerSharesForDimension ?? [],
        "MANUAL",
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Mise à jour impossible." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Identifiant manquant." }, { status: 400 });
  }

  try {
    await prisma.nonFinancialAsset.deleteMany({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Suppression impossible." }, { status: 500 });
  }
}
