/**
 * Reconstruit la couche de faits performance (Phase A).
 * Usage : npx tsx scripts/rebuild-performance-facts.ts [--force-prices]
 */
import { prisma } from "@/lib/db/prisma";
import { rebuildPerformanceFacts } from "@/features/portfolio/rebuild-performance-facts";

async function main() {
  const forcePrices = process.argv.includes("--force-prices");
  console.log("Reconstruction des faits performance…\n");

  const result = await rebuildPerformanceFacts({ forcePrices });

  console.log("Période :", result.fromDate, "→", result.toDate);
  console.log("Clôtures upsertées :", result.pricesUpserted);
  console.log("Lignes session_gains :", result.sessionGainsRows);
  console.log("Santé :", result.health.ok ? "OK" : "ÉCHEC");
  if (result.health.message) console.log("→", result.health.message);
  if (result.missingFxDates.length > 0) {
    console.log("Dates FX manquantes :", result.missingFxDates.slice(0, 5).join(", "));
  }
  for (const msg of result.messages) console.log("•", msg);

  if (!result.ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
