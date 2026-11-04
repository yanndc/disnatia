import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const bodySchema = z.object({
  /** Signature stable du fichier (voir `fileAttributionSignature`). */
  signature: z.string().min(3).max(500),
  accountKey: z.string().min(1).max(200),
  sampleFileName: z.string().min(1).max(300),
});

/**
 * Mémorise l'attribution « ce fichier = ce compte » validée par l'utilisateur.
 *
 * Les exports « Historique des transactions » n'ont pas de numéro de compte : sans cette
 * mémoire, chaque session redemanderait le même choix.
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

  const { signature, accountKey, sampleFileName } = parsed.data;

  const existing = await prisma.portfolioImportAttributionRule.findUnique({
    where: { signature },
    select: { id: true, accountKey: true, hits: true },
  });

  const rule = existing
    ? await prisma.portfolioImportAttributionRule.update({
        where: { id: existing.id },
        data: {
          accountKey,
          sampleFileName,
          hits: existing.accountKey === accountKey ? existing.hits + 1 : 1,
        },
      })
    : await prisma.portfolioImportAttributionRule.create({
        data: { signature, accountKey, sampleFileName, hits: 1 },
      });

  return NextResponse.json({
    ok: true,
    rule: {
      signature: rule.signature,
      accountKey: rule.accountKey,
      hits: rule.hits,
      sampleFileName: rule.sampleFileName,
    },
  });
}
