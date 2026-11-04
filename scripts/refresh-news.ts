import { prisma } from "../src/lib/db/prisma";
import { runNewsIngestion } from "../src/features/news/ingest-news";

/**
 * Ingestion manuelle du fil de nouvelles (même tâche que `/api/cron/refresh-news`).
 * Utile en local et pour amorcer la base avant la première visite de `/nouvelles`.
 */
async function main() {
  const result = await runNewsIngestion();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main()
  .catch((cause) => {
    console.error("[refresh-news] échec", cause);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
