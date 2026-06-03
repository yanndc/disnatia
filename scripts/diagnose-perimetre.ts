import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import { loadHoldingsForDashboard } from "@/features/portfolio/holdings-display-query";
import { priorSessionCloseByPair } from "@/features/portfolio/daily-close-prices";
import { priorSessionDateIso } from "@/lib/market/equity-session";
import { normalizeCurrency } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });

async function main() {
  const payload = await getPerformanceIndicatorPayload();
  const holdings = await loadHoldingsForDashboard();
  const priorDay = priorSessionDateIso(new Date());
  const pairs = [
    ...new Map(
      holdings.map((h) => [
        `${h.ticker.toUpperCase()}|${normalizeCurrency(h.currency)}`,
        { ticker: h.ticker.toUpperCase(), currency: normalizeCurrency(h.currency) },
      ]),
    ).values(),
  ];
  const priorMap = await priorSessionCloseByPair(pairs);

  const disnatKeys = payload.accounts.filter((a) => !a.isExternal);
  const withTitres = disnatKeys.filter(
    (a) => (payload.currentByAccount[a.accountKey]?.positionsCad ?? 0) > 0,
  );
  const zeroTitres = disnatKeys.filter(
    (a) => (payload.currentByAccount[a.accountKey]?.positionsCad ?? 0) === 0,
  );

  console.log("Comptes Disnat:", disnatKeys.length, "| avec titres:", withTitres.length, "| à 0$:", zeroTitres.length);
  if (zeroTitres.length) {
    console.log("  Exclus du Σ séance (0 titre):", zeroTitres.map((a) => a.accountKey).join(", "));
  }

  const lines = holdings.filter((h) => h.quantity > 0);
  const noClose: string[] = [];
  for (const h of lines) {
    const pk = `${h.ticker.toUpperCase()}|${normalizeCurrency(h.currency)}`;
    if (!priorMap.has(pk)) noClose.push(`${h.ticker}|${h.currency} ${h.accountKey}`);
  }
  console.log("\nLignes titre qty>0:", lines.length);
  console.log("Sans clôture veille en BD:", noClose.length, noClose.length ? noClose.slice(0, 5) : "");

  const states = await prisma.portfolioAccountState.findMany();
  console.log("\nTaux implicite Disnat (import marketValue / somme snapshot positions même compte)?");
  for (const a of withTitres) {
    const st = states.find((s) => s.accountKey === a.accountKey);
    if (!st || st.currency !== "USD") continue;
    const accLines = lines.filter((h) => h.accountKey === a.accountKey);
    const sumMv = accLines.reduce((s, h) => s + h.snapshotValue, 0);
    if (sumMv > 0 && st.marketValue > 0) {
      console.log(" ", a.accountKey, "ratio state/importSum", (st.marketValue / sumMv).toFixed(4));
    }
  }
  console.log("\nNotre USD→CAD:", payload.usdToCad?.toFixed(4));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
