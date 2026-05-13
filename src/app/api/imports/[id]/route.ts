import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "ID manquant." }, { status: 400 });
  }

  const existing = await prisma.portfolioImport.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Import introuvable." }, { status: 404 });
  }

  /** Supprime l’import et toutes les données liées, y compris le fichier source (BYTEA). */
  await prisma.portfolioImport.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
