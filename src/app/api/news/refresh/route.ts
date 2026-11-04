import { NextResponse } from "next/server";
import { runNewsIngestion } from "@/features/news/ingest-news";

export const maxDuration = 300;

/** Lance l'ingestion à la demande depuis l'admin (même protection que le reste de l'app). */
export async function POST() {
  try {
    const result = await runNewsIngestion();
    return NextResponse.json(result);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Échec de l'ingestion";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "Utilise POST pour lancer une ingestion." },
    { status: 405 },
  );
}

