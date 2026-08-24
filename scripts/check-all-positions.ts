import { prisma } from "@/lib/db/prisma";

async function checkAllPositions() {
  console.log("🔍 Comparing all positions: Disnat snapshots vs Computed holdings\n");

  // Get latest snapshot per account+ticker
  const snapshots = await prisma.portfolioPosition.findMany({
    distinct: ["accountNumber", "ticker"],
    orderBy: [{ import: { importedAt: "desc" } }]
  });

  // Get all computed holdings
  const holdings = await prisma.portfolioHolding.findMany();

  // Build maps
  const snapshotMap = new Map();
  for (const snap of snapshots) {
    const key = `${snap.accountNumber}|${snap.ticker}`;
    if (!snapshotMap.has(key)) snapshotMap.set(key, snap);
  }

  const holdingMap = new Map();
  for (const holding of holdings) {
    const key = `${holding.accountNumber}|${holding.ticker}`;
    if (!holdingMap.has(key)) holdingMap.set(key, holding);
  }

  // Compare
  const discrepancies: Array<{ ticker: string; account: string; disnat: number; computed: number; diff: number }> = [];

  for (const [key, snap] of snapshotMap) {
    const holding = holdingMap.get(key);
    const computed = holding?.quantity ?? 0;
    if (Math.abs(snap.quantity - computed) > 0.01) {
      const [account, ticker] = key.split("|");
      discrepancies.push({
        ticker,
        account,
        disnat: snap.quantity,
        computed,
        diff: computed - snap.quantity
      });
    }
  }

  if (discrepancies.length === 0) {
    console.log("✅ All positions match Disnat! No discrepancies found.\n");
    return;
  }

  console.log(`⚠️ Found ${discrepancies.length} discrepancies:\n`);

  discrepancies.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  discrepancies.forEach(d => {
    const sign = d.diff > 0 ? "+" : "";
    console.log(`${d.ticker} (${d.account})`);
    console.log(`  Disnat:   ${d.disnat}`);
    console.log(`  Computed: ${d.computed}`);
    console.log(`  Diff:     ${sign}${d.diff}`);
    console.log("");
  });

  console.log(`\n💡 To fix these, you need to remove ${discrepancies.reduce((a, d) => a + Math.abs(d.diff), 0)} duplicate transactions.\n`);
}

checkAllPositions()
  .catch(console.error)
  .finally(() => process.exit());
