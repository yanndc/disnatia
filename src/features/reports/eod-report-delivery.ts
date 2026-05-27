import { prisma } from "@/lib/db/prisma";

export async function wasEodReportSentForSession(
  sessionDate: string,
): Promise<boolean> {
  const row = await prisma.eodReportDelivery.findUnique({
    where: { sessionDate },
    select: { sessionDate: true },
  });
  return row !== null;
}

export async function markEodReportSent(
  sessionDate: string,
  recipient: string,
): Promise<void> {
  await prisma.eodReportDelivery.upsert({
    where: { sessionDate },
    create: { sessionDate, recipient },
    update: { recipient, sentAt: new Date() },
  });
}
