import { NextResponse } from "next/server";
import { getTransactionLinesForProjectedHolding } from "@/features/portfolio/project-transaction-holdings";

/**
 * GET /api/portfolio/position-transactions?accountKey=&ticker=&currency=
 * Opérations importées reliées à une ligne titre projetée (même logique que la projection).
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const accountKey = searchParams.get("accountKey")?.trim() ?? "";
    const ticker = searchParams.get("ticker")?.trim() ?? "";
    const currency = searchParams.get("currency")?.trim() ?? "";
    if (!accountKey || !ticker || !currency) {
      return NextResponse.json(
        { error: "Paramètres requis : accountKey, ticker, currency." },
        { status: 400 },
      );
    }
    const rows = await getTransactionLinesForProjectedHolding({
      accountKey,
      ticker,
      currency,
    });
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur inconnue" },
      { status: 500 },
    );
  }
}
