import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const accounts = await prisma.portfolioAccountState.findMany({
    orderBy: [{ accountType: "asc" }, { currency: "asc" }],
    select: {
      accountKey: true,
      accountName: true,
      accountNumber: true,
      accountType: true,
      currency: true,
      totalValue: true,
    },
  });

  return NextResponse.json({ accounts });
}
