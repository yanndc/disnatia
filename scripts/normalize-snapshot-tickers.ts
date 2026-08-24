import { prisma } from "@/lib/db/prisma";
import { normalizeDisnatTickerForPortfolio } from "@/lib/market/disnat-ticker";

async function normalizeSnapshots() {
  console.log("🔄 Normalizing all snapshot tickers...\n");

  const allPositions = await prisma.portfolioPosition.findMany({
    select: {
      id: true,
      ticker: true,
      currency: true,
      quantity: true,
      accountNumber: true,
      import: { select: { importedAt: true } }
    }
  });

  console.log(`Found ${allPositions.length} positions to process\n`);

  // Calculate normalized ticker for each position
  const updates = allPositions.map((pos) => {
    const normalized = normalizeDisnatTickerForPortfolio(
      pos.ticker || "",
      pos.currency || ""
    );
    return {
      id: pos.id,
      original: pos.ticker,
      normalized,
      changed: normalized !== pos.ticker
    };
  });

  const changed = updates.filter((u) => u.changed);
  console.log(`Will change ${changed.length} out of ${updates.length} tickers\n`);

  if (changed.length > 0) {
    console.log("Sample of changes:");
    changed.slice(0, 10).forEach((u) => {
      console.log(`  ${u.original} → ${u.normalized}`);
    });
    console.log("");
  }

  // Check for potential duplicates
  console.log("🔍 Checking for duplicates after normalization...\n");

  const newTickerMap = new Map();
  for (const pos of allPositions) {
    const normalized = normalizeDisnatTickerForPortfolio(
      pos.ticker || "",
      pos.currency || ""
    );
    const key = `${pos.accountNumber}|${normalized}|${pos.import.importedAt.toISOString().split("T")[0]}`;
    if (!newTickerMap.has(key)) newTickerMap.set(key, []);
    newTickerMap.get(key).push(pos);
  }

  const duplicates = [...newTickerMap.values()].filter((arr) => arr.length > 1);
  if (duplicates.length > 0) {
    console.log(`⚠️ Will create ${duplicates.length} duplicate groups after normalization\n`);
    duplicates.slice(0, 3).forEach((group) => {
      console.log(`  Account ${group[0].accountNumber}:`);
      group.forEach((pos) => {
        console.log(`    ${pos.ticker} (${pos.quantity})`);
      });
    });
  } else {
    console.log("✅ No duplicates will be created\n");
  }

  // Apply updates
  console.log("💾 Applying updates...\n");

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < updates.length; i += 100) {
    const batch = updates.slice(i, i + 100);

    for (const update of batch) {
      try {
        await prisma.portfolioPosition.update({
          where: { id: update.id },
          data: { ticker: update.normalized }
        });
        successCount++;
      } catch (error) {
        errorCount++;
        if (errorCount <= 3) {
          console.log(`Error updating ${update.original}: ${error}`);
        }
      }
    }

    console.log(`  Processed ${Math.min(i + 100, updates.length)}/${updates.length}`);
  }

  console.log(
    `\n✅ Updated ${successCount} positions${errorCount > 0 ? ` (${errorCount} errors)` : ""}`
  );

  // Verify by comparing snapshots to holdings
  console.log("\n🔍 Verifying against holdings...\n");

  const snapshots = await prisma.portfolioPosition.findMany({
    distinct: ["accountNumber", "ticker"],
    orderBy: [{ import: { importedAt: "desc" } }],
    select: {
      accountNumber: true,
      ticker: true,
      quantity: true,
      currency: true
    }
  });

  const holdings = await prisma.portfolioHolding.findMany();

  let matches = 0;
  let mismatches = 0;

  for (const snap of snapshots) {
    const holding = holdings.find(
      (h) => h.accountNumber === snap.accountNumber && h.ticker === snap.ticker
    );
    if (holding && Math.abs(holding.quantity - snap.quantity) < 0.01) {
      matches++;
    } else if (snap.quantity > 0.01) {
      mismatches++;
    }
  }

  console.log(`Matching snapshots ↔ holdings: ${matches}`);
  console.log(`Mismatched: ${mismatches}`);
}

normalizeSnapshots()
  .catch(console.error)
  .finally(() => process.exit());
