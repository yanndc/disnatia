import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runNewsIngestion } from "@/features/news/ingest-news";

export const maxDuration = 300;

function verifyCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Ingestion du fil de nouvelles (RSS/Atom → base + scoring portefeuille).
 * Déclenché par `.github/workflows/news-refresh-cron.yml` (CRON_SECRET).
 */
export async function POST(request: NextRequest) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json({ skipped: true, reason: "CRON_SECRET manquant" });
  }
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const result = await runNewsIngestion();
    return NextResponse.json(result);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Échec de l'ingestion";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
