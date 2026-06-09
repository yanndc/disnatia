import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";

async function main() {
  const p = await getPerformanceIndicatorPayload();
  for (const a of p.accounts) {
    console.log(a.accountKey, "|", a.owner, "|", a.currency, "| ext:", a.isExternal);
  }
}
main().catch(console.error);
