import { Resend } from "resend";

let resendClient: Resend | null = null;

function getResend(): Resend {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    throw new Error("RESEND_API_KEY manquant.");
  }
  if (!resendClient) {
    resendClient = new Resend(key);
  }
  return resendClient;
}

export function getEodReportFrom(): string {
  const from = process.env.EOD_REPORT_FROM?.trim();
  if (!from) {
    throw new Error("EOD_REPORT_FROM manquant.");
  }
  return from;
}

export function getEodReportTo(): string {
  const to = process.env.EOD_REPORT_TO?.trim();
  if (!to) {
    throw new Error("EOD_REPORT_TO manquant.");
  }
  return to;
}

export async function sendHtmlEmail(params: {
  subject: string;
  html: string;
}): Promise<{ id: string | undefined }> {
  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from: getEodReportFrom(),
    to: [getEodReportTo()],
    subject: params.subject,
    html: params.html,
  });
  if (error) {
    throw new Error(error.message);
  }
  return { id: data?.id };
}
