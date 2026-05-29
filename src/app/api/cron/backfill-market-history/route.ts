import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { backfillMarketHistory } from "@/features/portfolio/backfill-market-history";
import { shouldSendEodReport } from "@/lib/market/equity-session";
import {
  checkSessionDataIntegrity,
  notifySessionIntegrityFailure,
} from "@/features/portfolio/session-data-integrity";

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

  const now = new Date();
  const force =
    process.env.NODE_ENV === "development" &&
    request.nextUrl.searchParams.get("force") === "1";

  if (!force && !shouldSendEodReport(now)) {
    return NextResponse.json({
      skipped: true,
      reason: "hors_fenetre_backfill",
    });
  }

  try {
    const result = await backfillMarketHistory({
      force: false,
      recomputeDailyValues: true,
      recomputeDailyValuesDays: 60,
      recomputeSessionGains: true,
      recomputeSessionGainsDays: 60,
      ensureDailyHoldings: true,
    });
    const integrity = await checkSessionDataIntegrity();
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
    return NextResponse.json(result);
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : "Échec du backfill historique de marché.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
