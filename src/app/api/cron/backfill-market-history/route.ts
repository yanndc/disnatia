import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { backfillMarketHistory } from "@/features/portfolio/backfill-market-history";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  checkSessionDataIntegrity,
  notifySessionIntegrityFailure,
  repairSessionDataForExpectedSession,
} from "@/features/portfolio/session-data-integrity";

export const maxDuration = 300;

function verifyCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json({ skipped: true, reason: "CRON_SECRET manquant" });
  }

  const force = request.nextUrl.searchParams.get("force") === "1";

  try {
    const result = await backfillMarketHistory({
      force,
      recomputeDailyValues: true,
      recomputeDailyValuesDays: 60,
      recomputeSessionGains: true,
      recomputeSessionGainsDays: 60,
      ensureDailyHoldings: true,
    });
    let integrity = await checkSessionDataIntegrity();
    if (!integrity.ok) {
      await repairSessionDataForExpectedSession();
      integrity = await checkSessionDataIntegrity();
    }
    if (!integrity.ok) {
      await notifySessionIntegrityFailure("cron:backfill-market-history", integrity).catch(
        () => {
          /* best effort; on renvoie quand meme l'echec */
        },
      );
      return NextResponse.json(
        {
          ok: false,
          error: "integrity_check_failed",
          message: "Integrite seance invalide apres backfill.",
          issues: integrity.issues,
          metrics: integrity.metrics,
        },
        { status: 500 },
      );
    }
    await getPerformanceIndicatorPayload({ includeCashLedger: true }).catch((cause) => {
      console.warn("[cron:backfill-market-history] performance snapshots", cause);
    });
    return NextResponse.json(result);
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "Échec du backfill historique de marché.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
