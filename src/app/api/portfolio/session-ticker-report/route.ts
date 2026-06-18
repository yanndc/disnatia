import { NextResponse } from "next/server";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  buildSessionTickerViewForDate,
  parsePayloadClock,
  SessionTickerDataError,
  SESSION_TICKER_MAX_LOOKBACK_DAYS,
} from "@/features/portfolio/session-ticker-report-queries";
import {
  previousTradingDayIso,
  priorReferenceSessionDateIso,
  referenceTradingSessionDayIso,
} from "@/lib/market/equity-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const sessionDate =
      new URL(request.url).searchParams.get("sessionDate")?.trim() ?? "";

    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
      return NextResponse.json(
        { error: "Paramètre sessionDate requis (YYYY-MM-DD)." },
        { status: 400 },
      );
    }

    const payload = await getPerformanceIndicatorPayload();
    const now = parsePayloadClock(payload.asOfNow);
    const maxSessionDate = referenceTradingSessionDayIso(now);
    const minSessionDate = previousTradingDayIso(
      maxSessionDate,
      SESSION_TICKER_MAX_LOOKBACK_DAYS,
    );

    if (sessionDate > maxSessionDate || sessionDate < minSessionDate) {
      return NextResponse.json(
        { error: "Date hors de la plage navigable." },
        { status: 400 },
      );
    }

    const view = await buildSessionTickerViewForDate(payload, sessionDate, now, {
      repairHoldingsIfMissing: true,
      nowForRepair: new Date(),
    });

    return NextResponse.json({
      ok: true,
      view,
      maxSessionDate,
      minSessionDate,
      sessionDataHealth: payload.sessionDataHealth,
      previousSessionDate: priorReferenceSessionDateIso(now),
    });
  } catch (cause) {
    if (cause instanceof SessionTickerDataError) {
      return NextResponse.json(
        {
          ok: false,
          code: cause.code,
          message: cause.message,
          diagnostics: cause.diagnostics,
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        message:
          cause instanceof Error
            ? cause.message
            : "Impossible de charger le rapport titres par séance.",
      },
      { status: 500 },
    );
  }
}
