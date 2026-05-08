import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { sanitizePortfolioOwner } from "@/lib/portfolio/sanitize-portfolio-owner";

export async function GET() {
  const accounts = await prisma.portfolioAccountState.findMany({
    orderBy: [{ accountType: "asc" }, { currency: "asc" }],
    select: {
      accountKey: true,
      accountName: true,
      accountNumber: true,
      accountType: true,
      owner: true,
      currency: true,
      totalValue: true,
    },
  });

  return NextResponse.json({
    accounts: accounts.map((a) => ({
      ...a,
      owner: sanitizePortfolioOwner(a.owner),
    })),
  });
}
