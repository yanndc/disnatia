import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { PROJECTED_HOLDINGS_SOURCE_ID } from "@/features/portfolio/project-transaction-holdings";

type HoldingOrder = Prisma.PortfolioHoldingOrderByWithRelationInput;

const defaultOrder: HoldingOrder[] = [{ snapshotValue: "desc" }];

/**
 * Lignes titres sur tout le site (positions, vue d’ensemble, expositions…) : **uniquement**
 * la projection issue des transactions (`projectHoldingsFromTransactions`) enrichie des cours web.
 *
 * Les exports CSV « portefeuille » Disnat ne servent pas à remplir cette liste : ils alimentent
 * `portfolio_account_states` (comptes, propriétaires, totaux de référence) et les écarts de validation.
 */
export async function loadHoldingsForDashboard() {
  return prisma.portfolioHolding.findMany({
    where: { sourceImportId: PROJECTED_HOLDINGS_SOURCE_ID },
    orderBy: defaultOrder,
  });
}
