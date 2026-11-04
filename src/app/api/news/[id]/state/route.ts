import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const patchSchema = z
  .object({
    read: z.boolean().optional(),
    saved: z.boolean().optional(),
  })
  .refine((value) => value.read !== undefined || value.saved !== undefined, {
    message: "Fournir `read` et/ou `saved`.",
  });

type RouteParams = { params: Promise<{ id: string }> };

/** Marque un article comme lu / sauvegardé (mono-utilisateur : état porté par l'article). */
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
    return NextResponse.json({ error: "Corps invalide." }, { status: 400 });
  }

  const now = new Date();
  const data: { readAt?: Date | null; savedAt?: Date | null } = {};
  if (parsed.data.read !== undefined) data.readAt = parsed.data.read ? now : null;
  if (parsed.data.saved !== undefined) data.savedAt = parsed.data.saved ? now : null;

  try {
    const row = await prisma.newsItem.update({
      where: { id },
      data,
      select: { id: true, readAt: true, savedAt: true },
    });
    return NextResponse.json({
      ok: true,
      id: row.id,
      read: row.readAt !== null,
      saved: row.savedAt !== null,
    });
  } catch {
    return NextResponse.json({ error: "Article introuvable." }, { status: 404 });
  }
}
