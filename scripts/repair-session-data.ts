/**
 * Répare holdings / valeurs / gains pour la séance attendue (prod ou local).
 * Usage : npx tsx scripts/repair-session-data.ts
 */
import {
  checkSessionDataIntegrity,
  repairSessionDataForExpectedSession,
} from "@/features/portfolio/session-data-integrity";

async function main() {
  console.log("Réparation des données de séance…");
  await repairSessionDataForExpectedSession(new Date(), 60);
  const check = await checkSessionDataIntegrity();
  console.log(JSON.stringify(check, null, 2));
  if (!check.ok) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("@/lib/db/prisma");
    await prisma.$disconnect();
  });
