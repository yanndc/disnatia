import { NextResponse } from "next/server";
import { backfillMarketHistory } from "@/features/portfolio/backfill-market-history";
import {
  checkSessionDataIntegrity,
  formatSessionIntegrityForUser,
} from "@/features/portfolio/session-data-integrity";

function summarizeBackfillResult(
  result: Awaited<ReturnType<typeof backfillMarketHistory>>,
  integrity: Awaited<ReturnType<typeof checkSessionDataIntegrity>>,
): string {
  const lines = [
    result.message ??
      `${result.tickersProcessed} titre(s) mis à jour, ${result.tickersSkipped} déjà couverts, ${result.pricesUpserted} clôtures enregistrées.`,
    `Valeurs journalières recalculées : ${result.dailyValuesUpserted}`,
    `Gains de séance recalculés : ${result.sessionGainsUpserted}`,
    "",
    integrity.ok
      ? "Intégrité séance : OK"
      : "Intégrité séance : incomplète (le backfill des clôtures a quand même tourné)",
    ...formatSessionIntegrityForUser(integrity).map((line) =>
      line.startsWith("•") || line.startsWith("→") ? line : `  ${line}`,
    ),
  ];
  return lines.join("\n");
}

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
      recomputeDailyValuesDays?: number;
      recomputeSessionGains?: boolean;
      recomputeSessionGainsDays?: number;
    };

    const result = await backfillMarketHistory({
      force: body.force ?? false,
      recomputeDailyValues: body.recomputeDailyValues ?? true,
      recomputeDailyValuesDays: body.recomputeDailyValuesDays,
      recomputeSessionGains: body.recomputeSessionGains ?? true,
      recomputeSessionGainsDays: body.recomputeSessionGainsDays ?? 90,
      ensureDailyHoldings: true,
    });
    const integrity = await checkSessionDataIntegrity();
    const summary = summarizeBackfillResult(result, integrity);

    return NextResponse.json({
      ...result,
      integrityOk: integrity.ok,
      integrity,
      summary,
      message: summary,
    });
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
