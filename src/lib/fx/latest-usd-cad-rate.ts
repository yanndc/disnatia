import { prisma } from "@/lib/db/prisma";

/** Dernier cours USD→CAD en base (CAD pour 1 USD). */
export async function getLatestUsdCadRate(): Promise<{
  rateDate: Date;
  usdToCad: number;
} | null> {
  const model = prisma.usdCadDailyRate;
  if (!model?.findFirst) return null;
  const row = await model.findFirst({
    orderBy: { rateDate: "desc" },
  });
  if (!row) return null;
  return { rateDate: row.rateDate, usdToCad: row.usdToCad };
}
