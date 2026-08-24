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

function applyAccountScope<T extends { accountKey: string }>(rows: T[], allowed: Set<string>): T[] {
  return rows.filter((r) => allowed.has(r.accountKey));
}

export async function GET(request: Request) {
  const apiStartTime = Date.now();
  try {
    const search = new URL(request.url).searchParams;
    const sessionDateRaw = search.get("sessionDate")?.trim() ?? "";
    const accountKeysRaw = search.get("accountKeys")?.trim() ?? "";

    console.log(`[api] session-ticker-report request: sessionDate=${sessionDateRaw}, accountKeys=${accountKeysRaw}`);

    const accountKeys = accountKeysRaw
      ? accountKeysRaw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : undefined;

    const payloadStartTime = Date.now();
    let payload = await getPerformanceIndicatorPayload({ accountKeysFilter: accountKeys });
    const payloadEndTime = Date.now();
    console.log(`[api] getPerformanceIndicatorPayload took ${payloadEndTime - payloadStartTime}ms`);
    const now = parsePayloadClock(payload.asOfNow);
    const maxSessionDate = referenceTradingSessionDayIso(now);
    const minSessionDate = previousTradingDayIso(
      maxSessionDate,
      SESSION_TICKER_MAX_LOOKBACK_DAYS,
    );

    const sessionDate = sessionDateRaw || maxSessionDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
      return NextResponse.json(
        { error: "Paramètre sessionDate invalide (YYYY-MM-DD)." },
        { status: 400 },
      );
    }

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

    const apiEndTime = Date.now();
    console.log(`[api] session-ticker-report completed in ${apiEndTime - apiStartTime}ms`);
    return NextResponse.json({
      ok: true,
      view,
      maxSessionDate,
      minSessionDate,
      sessionDataHealth: payload.sessionDataHealth,
      previousSessionDate: priorReferenceSessionDateIso(now),
    });
  } catch (cause) {
    const apiErrorTime = Date.now();
    console.log(`[api] session-ticker-report failed after ${apiErrorTime - apiStartTime}ms`, cause);
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
