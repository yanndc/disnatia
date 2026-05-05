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

/**
 * Taux USD→CAD le plus récent dont la date est ≤ au jour de référence (état Disnat).
 * Sinon repli sur le dernier taux en base.
 */
export async function getUsdCadRateNear(refDate: Date | null): Promise<{
  rateDate: Date;
  usdToCad: number;
} | null> {
  const model = prisma.usdCadDailyRate;
  if (!model?.findFirst) return null;

  if (refDate) {
    const endOfRefDay = new Date(
      Date.UTC(
        refDate.getUTCFullYear(),
        refDate.getUTCMonth(),
        refDate.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );
    const row = await model.findFirst({
      where: { rateDate: { lte: endOfRefDay } },
      orderBy: { rateDate: "desc" },
    });
    if (row) return { rateDate: row.rateDate, usdToCad: row.usdToCad };
  }

  return getLatestUsdCadRate();
}
