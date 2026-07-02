import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sanitizePortfolioOwner } from "@/lib/portfolio/sanitize-portfolio-owner";
import { mergeExternalAccountMetadata } from "@/lib/portfolio/external-account-metadata";
import { syncExternalAccountOwnerMapping } from "@/lib/portfolio/owner-dimension-write";

const patchSchema = z.object({
  displayLabel: z.string().min(1).max(240).optional(),
  currency: z.enum(["CAD", "USD"]).optional(),
  portalUrl: z.union([z.string().url(), z.literal(""), z.null()]).optional(),
  sourceSummary: z.string().max(4000).nullable().optional(),
  transactionUpdateInstructions: z.string().max(8000).nullable().optional(),
  owner: z.union([z.string().max(200), z.literal(""), z.null()]).optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

function hasPatchFields(body: z.infer<typeof patchSchema>): boolean {
  return (
    body.displayLabel !== undefined ||
    body.currency !== undefined ||
    body.portalUrl !== undefined ||
    body.sourceSummary !== undefined ||
    body.transactionUpdateInstructions !== undefined ||
    body.owner !== undefined
  );
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

  if (!hasPatchFields(parsed.data)) {
    return NextResponse.json({ error: "Aucun champ à modifier." }, { status: 422 });
  }

  const existing = await prisma.externalPortfolioAccount.findUnique({
    where: { id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
  }

  const d = parsed.data;

  try {
    const metaPatch: {
      sourceSummary?: string | null;
      transactionUpdateInstructions?: string | null;
    } = {};
    if (d.sourceSummary !== undefined) metaPatch.sourceSummary = d.sourceSummary;
    if (d.transactionUpdateInstructions !== undefined) {
      metaPatch.transactionUpdateInstructions = d.transactionUpdateInstructions;
    }

    const data: Prisma.ExternalPortfolioAccountUpdateInput = {};
    if (d.displayLabel !== undefined) data.displayLabel = d.displayLabel.trim();
    if (d.currency !== undefined) data.currency = d.currency;
    if (d.portalUrl !== undefined) {
      data.portalUrl = d.portalUrl === null || d.portalUrl === "" ? null : d.portalUrl;
    }
    if (d.owner !== undefined) {
      data.owner =
        d.owner === null || String(d.owner).trim() === ""
          ? null
          : sanitizePortfolioOwner(String(d.owner));
    }
    if (Object.keys(metaPatch).length > 0) {
      const merged = mergeExternalAccountMetadata(existing.metadata, metaPatch);
      data.metadata = merged === null ? Prisma.DbNull : merged;
    }

    await prisma.externalPortfolioAccount.update({
      where: { id },
      data,
    });

    if (d.owner !== undefined) {
      await syncExternalAccountOwnerMapping(
        id,
        d.owner === null || String(d.owner).trim() === ""
          ? null
          : sanitizePortfolioOwner(String(d.owner)),
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
    await prisma.externalPortfolioAccount.deleteMany({
      where: { id },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Suppression impossible." }, { status: 500 });
  }
}
