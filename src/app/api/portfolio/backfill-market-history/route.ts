import { NextResponse } from "next/server";
import { backfillMarketHistory } from "@/features/portfolio/backfill-market-history";
import { checkSessionDataIntegrity } from "@/features/portfolio/session-data-integrity";

/**
 * POST /api/portfolio/backfill-market-history
 * Télécharge les clôtures Yahoo sur toute la période de détention de chaque titre
 * et recalcule les valeurs journalières agrégées (portfolio_daily_values).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      force?: boolean;
      recomputeDailyValues?: boolean;
    };

    const result = await backfillMarketHistory({
      force: body.force ?? false,
      recomputeDailyValues: body.recomputeDailyValues ?? true,
      ensureDailyHoldings: true,
    });
    const integrity = await checkSessionDataIntegrity();
    if (!integrity.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: "Integrite seance invalide apres backfill.",
          issues: integrity.issues,
          metrics: integrity.metrics,
        },
        { status: 500 },
      );
    }

    return NextResponse.json(result);
  } catch (cause) {
    return NextResponse.json(
      {
        ok: false,
        message:
          cause instanceof Error
            ? cause.message
            : "Échec du backfill historique de marché.",
      },
      { status: 500 },
    );
  }
}
