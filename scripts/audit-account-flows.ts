import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import { netExternalFlowsCad } from "@/features/portfolio/performance-cash-flows";

const KEYS = ["5KFZEZ2|CAD", "5L3APY0|CAD"];

async function main() {
  const payload = await getPerformanceIndicatorPayload();

  for (const key of KEYS) {
    console.log(`\n=== ${key} — toutes les transactions ===`);
    const txs = await prisma.portfolioTransactionLine.findMany({
      where: { accountKey: key },
      select: {
        tradeDate: true,
        settlementDate: true,
        txCategory: true,
        transactionType: true,
        amount: true,
        quantity: true,
        ticker: true,
      },
      orderBy: [{ settlementDate: "asc" }, { tradeDate: "asc" }],
    });

    let withDate = 0;
    let withoutDate = 0;
    for (const t of txs) {
      const d = t.tradeDate ?? t.settlementDate;
      if (d) withDate++;
      else withoutDate++;
      if (
        t.txCategory === "CONTRIBUTION" ||
        t.txCategory === "TRANSFER_IN" ||
        t.txCategory === "TRANSFER_OUT" ||
        t.txCategory === "INTERNAL_TRANSFER" ||
        t.txCategory === "JOURNAL"
      ) {
        console.log(
          `  ${d?.toISOString().slice(0, 10) ?? "SANS DATE"} | ${t.txCategory} | ${t.transactionType} | ${t.amount} | qty=${t.quantity}`,
        );
      }
    }
    console.log(`Total: ${txs.length} (avec date: ${withDate}, sans date: ${withoutDate})`);

    const flowsInPayload = payload.cashFlows.filter((f) => f.accountKey === key);
    console.log(`Flux dans payload.cashFlows: ${flowsInPayload.length}`);
    for (const f of flowsInPayload.slice(0, 15)) {
      console.log(`  ${f.tradeDate} ${f.txCategory} ${Math.round(f.amountCad)}`);
    }

    const ytdFlows = netExternalFlowsCad(payload.cashFlows, [key], "2026-01-01", "2026-06-12");
    const yearFlows = netExternalFlowsCad(
      payload.cashFlows,
      [key],
      "2025-06-12",
      "2026-06-12",
    );
    console.log(`netExternalFlows YTD: ${Math.round(ytdFlows)}`);
    console.log(`netExternalFlows 1an: ${Math.round(yearFlows)}`);

    const noTrade = txs.filter((t) => !t.tradeDate && t.settlementDate).length;
    const withTrade = txs.filter((t) => t.tradeDate).length;
    console.log(`tradeDate null mais settlement: ${noTrade} | tradeDate set: ${withTrade}`);

    const ytdContrib = txs
      .filter(
        (t) =>
          t.txCategory === "CONTRIBUTION" ||
          t.txCategory === "TRANSFER_IN" ||
          t.txCategory === "TRANSFER_OUT",
      )
      .filter((t) => {
        const d = t.tradeDate ?? t.settlementDate;
        return d && d >= new Date("2026-01-01") && d <= new Date("2026-06-12");
      })
      .reduce((s, t) => s + (t.amount ?? 0), 0);
    console.log(`Σ cotisations/transferts YTD (dates réelles): ${Math.round(ytdContrib)}`);

    const ytdInTxFlows = txs
      .filter((t) => t.tradeDate)
      .filter(
        (t) =>
          (t.txCategory === "CONTRIBUTION" ||
            t.txCategory === "TRANSFER_IN" ||
            t.txCategory === "TRANSFER_OUT") &&
          t.tradeDate! >= new Date("2026-01-01"),
      )
      .reduce((s, t) => s + (t.amount ?? 0), 0);
    console.log(`Σ YTD avec tradeDate seulement (ce que voit l'app): ${Math.round(ytdInTxFlows)}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
