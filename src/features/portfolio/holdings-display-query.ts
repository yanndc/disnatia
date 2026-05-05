import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { PROJECTED_HOLDINGS_SOURCE_ID } from "@/features/portfolio/project-transaction-holdings";

type HoldingOrder = Prisma.PortfolioHoldingOrderByWithRelationInput;

const defaultOrder: HoldingOrder[] = [{ snapshotValue: "desc" }];

/**
 * Lignes titres affichées : projection (transactions) uniquement dès qu’il existe un historique ;
 * sinon tous les holdings (base sans transactions).
 */
export async function loadHoldingsForDashboard() {
  const txCount = await prisma.portfolioTransactionLine.count();
  if (txCount > 0) {
    return prisma.portfolioHolding.findMany({
      where: { sourceImportId: PROJECTED_HOLDINGS_SOURCE_ID },
      orderBy: defaultOrder,
    });
  }
  return prisma.portfolioHolding.findMany({ orderBy: defaultOrder });
}
