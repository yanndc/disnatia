import { NextResponse } from "next/server";
import { buildImportSession } from "@/features/portfolio/import-session-queries";

export const dynamic = "force-dynamic";

/** Tout ce qu'il faut à la session d'import guidée : comptes, couverture, règles apprises. */
export async function GET() {
  try {
    const payload = await buildImportSession();
    return NextResponse.json(payload);
  } catch (error) {
    console.error("Session d'import indisponible", error);
    return NextResponse.json(
      { error: "Impossible de charger l'état des comptes." },
      { status: 500 },
    );
  }
}
