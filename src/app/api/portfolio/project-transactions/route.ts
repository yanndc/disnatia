import { NextResponse } from "next/server";
import { projectHoldingsFromTransactions } from "@/features/portfolio/project-transaction-holdings";

/**
 * POST /api/portfolio/project-transactions
 * Reconstruit les positions courantes et l'historique journalier depuis les transactions importées.
 */
export async function POST() {
  try {
    const result = await projectHoldingsFromTransactions();
    return NextResponse.json({
      message: `Projection terminée : ${result.currentHoldingsProjected} positions courantes, ${result.dailyRowsProjected} lignes journalières.`,
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur inconnue" },
      { status: 500 },
    );
  }
}
