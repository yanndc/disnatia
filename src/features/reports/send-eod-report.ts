import { render } from "@react-email/render";
import { EodReportEmail } from "@/emails/eod-report-email";
import { refreshLiveQuotesForLatestImport } from "@/features/portfolio/refresh-live-quotes";
import { sendHtmlEmail, getEodReportTo } from "@/lib/email/resend-client";
import {
  isoDateInToronto,
  referenceTradingSessionDay,
} from "@/lib/market/equity-session";
import { buildEodReportData } from "./eod-report-data";
import { markEodReportSent } from "./eod-report-delivery";

export type RunEodReportResult =
  | { sent: true; sessionDate: string; emailId: string | undefined }
  | { skipped: true; reason: string };

export async function runEodReportJob(now = new Date()): Promise<RunEodReportResult> {
  await refreshLiveQuotesForLatestImport({ recomputeSessionGains: true });

  const data = await buildEodReportData(now);
  const html = await render(EodReportEmail({ data }));
  const subject = `DisnatIA — Rapport ${data.sessionDate}`;

  const recipient = getEodReportTo();
  const { id } = await sendHtmlEmail({ subject, html });

  await markEodReportSent(data.sessionDate, recipient);

  return { sent: true, sessionDate: data.sessionDate, emailId: id };
}

export function eodReportSessionDate(now = new Date()): string {
  return isoDateInToronto(referenceTradingSessionDay(now));
}
