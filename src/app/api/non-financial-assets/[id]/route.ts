import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { sanitizePortfolioOwner } from "@/lib/portfolio/sanitize-portfolio-owner";

type RouteParams = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  displayLabel: z.string().min(1).max(240).optional(),
  owner: z.union([z.string().max(200), z.literal(""), z.null()]).optional(),
  currency: z.enum(["CAD", "USD"]).optional(),
  assetType: z.enum(["REAL_ESTATE", "VEHICLE", "PRIVATE_BUSINESS", "OTHER"]).optional(),
  isActive: z.boolean().optional(),
});

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
  try {
    await prisma.nonFinancialAsset.update({
      where: { id },
      data: {
        displayLabel: d.displayLabel?.trim(),
        owner:
          d.owner === undefined
            ? undefined
            : d.owner === null || String(d.owner).trim() === ""
              ? null
              : sanitizePortfolioOwner(String(d.owner)),
        currency: d.currency,
        assetType: d.assetType,
        isActive: d.isActive,
      },
    });
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
