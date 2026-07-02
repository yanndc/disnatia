import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

type RouteParams = { params: Promise<{ id: string }> };

const patchScopeSchema = z
  .object({
    label: z.string().min(1).max(120).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((d) => d.label !== undefined || d.isActive !== undefined, {
    message: "Aucun champ à modifier.",
  });

export async function PATCH(request: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Identifiant manquant." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const parsed = patchScopeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Données invalides.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const existing = await prisma.portfolio.findUnique({
    where: { id },
    select: { id: true, kind: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Portefeuille introuvable." }, { status: 404 });
  }

  if (existing.kind !== "CUSTOM") {
    return NextResponse.json(
      { error: "Seuls les portefeuilles personnalisés peuvent être modifiés." },
      { status: 403 },
    );
  }

  try {
    const d = parsed.data;
    const updated = await prisma.portfolio.update({
      where: { id },
      data: {
        displayName: d.label?.trim(),
        isActive: d.isActive,
      },
      select: {
        id: true,
        portfolioKey: true,
        displayName: true,
        kind: true,
        isActive: true,
      },
    });

    return NextResponse.json({
      ok: true,
      scope: {
        id: updated.id,
        portfolioKey: updated.portfolioKey,
        label: updated.displayName,
        kind: updated.kind,
        isActive: updated.isActive,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Mise à jour du portefeuille impossible." }, { status: 500 });
  }
}