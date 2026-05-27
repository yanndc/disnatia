import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  wasEodReportSentForSession,
} from "@/features/reports/eod-report-delivery";
import {
  eodReportSessionDate,
  runEodReportJob,
} from "@/features/reports/send-eod-report";
import {
  shouldSendEodReport,
} from "@/lib/market/equity-session";

function verifyCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

function missingEnvReason(): string | null {
  if (!process.env.CRON_SECRET?.trim()) return "CRON_SECRET manquant";
  if (!process.env.RESEND_API_KEY?.trim()) return "RESEND_API_KEY manquant";
  if (!process.env.EOD_REPORT_FROM?.trim()) return "EOD_REPORT_FROM manquant";
  if (!process.env.EOD_REPORT_TO?.trim()) return "EOD_REPORT_TO manquant";
  return null;
}

export async function POST(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const envReason = missingEnvReason();
  if (envReason) {
    return NextResponse.json({ skipped: true, reason: envReason });
  }

  const now = new Date();
  const force =
    process.env.NODE_ENV === "development" &&
    request.nextUrl.searchParams.get("force") === "1";

  if (!force && !shouldSendEodReport(now)) {
    return NextResponse.json({
      skipped: true,
      reason: "hors_fenetre_envoi",
    });
  }

  const sessionDate = eodReportSessionDate(now);

  if (
    !force &&
    (await wasEodReportSentForSession(sessionDate))
  ) {
    return NextResponse.json({
      skipped: true,
      reason: "already_sent",
      sessionDate,
    });
  }

  try {
    const result = await runEodReportJob(now);
    if ("skipped" in result) {
      return NextResponse.json(result);
    }
    return NextResponse.json(result);
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Échec envoi rapport EOD";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
