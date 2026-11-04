import { NextResponse } from "next/server";
import { z } from "zod";
import type { NewsCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

const CATEGORIES = [
  "MARKETS",
  "COMPANY",
  "ECONOMY",
  "REAL_ESTATE",
  "PERSONAL_FINANCE",
  "OTHER",
] as const satisfies readonly NewsCategory[];

const patchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  feedUrl: z.string().url().max(600).optional(),
  homepageUrl: z.union([z.string().url().max(600), z.literal(""), z.null()]).optional(),
  language: z.enum(["fr", "en"]).optional(),
  category: z.enum(CATEGORIES).optional(),
  weight: z.number().min(0.2).max(2).optional(),
  isActive: z.boolean().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Identifiant manquant." }, { status: 400 });
  }

  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Corps invalide." }, { status: 400 });
  }

  const body = parsed.data;
  try {
    const source = await prisma.newsSource.update({
      where: { id },
      data: {
        name: body.name?.trim(),
        feedUrl: body.feedUrl?.trim(),
        homepageUrl:
          body.homepageUrl === undefined ? undefined : body.homepageUrl?.trim() || null,
        language: body.language,
        category: body.category,
        weight: body.weight,
        isActive: body.isActive,
      },
      select: { id: true, isActive: true, weight: true, name: true },
    });
    return NextResponse.json({ ok: true, source });
  } catch {
    return NextResponse.json({ error: "Source introuvable." }, { status: 404 });
  }
}

/**
 * Supprime un flux ajouté à la main. Les flux du registre de code ne sont pas supprimables
 * (ils seraient recréés au prochain seed) : il faut les désactiver.
 */
export async function DELETE(_request: Request, ctx: RouteParams) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Identifiant manquant." }, { status: 400 });
  }

  const source = await prisma.newsSource.findUnique({
    where: { id },
    select: { isSeed: true, slug: true },
  });
  if (!source) {
    return NextResponse.json({ error: "Source introuvable." }, { status: 404 });
  }
  if (source.isSeed) {
    return NextResponse.json(
      {
        error:
          "Flux du registre DisnatIA : désactive-le plutôt, sinon il revient au prochain rafraîchissement.",
      },
      { status: 409 },
    );
  }

  try {
    await prisma.newsSource.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Suppression impossible.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
