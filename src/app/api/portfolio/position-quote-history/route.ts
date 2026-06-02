import { NextResponse } from "next/server";
import { getPositionQuoteHistory } from "@/features/portfolio/position-quote-history-query";

/**
 * GET /api/portfolio/position-quote-history?ticker=&currency=&days=60
 * Lecture seule : clôtures persistées + cours live en base (aucun backfill Yahoo).
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get("ticker")?.trim() ?? "";
    const currency = searchParams.get("currency")?.trim() ?? "";
    const days = Number(searchParams.get("days") ?? "60");
    if (!ticker || !currency) {
      return NextResponse.json(
        { error: "Paramètres requis : ticker, currency." },
        { status: 400 },
      );
    }
    const payload = await getPositionQuoteHistory(ticker, currency, days);
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur inconnue" },
      { status: 500 },
    );
  }
}
