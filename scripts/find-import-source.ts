import { prisma } from "@/lib/db/prisma";

async function findImportSource() {
  // Les IDs des transactions suspectes (anciennes avec cmt3eldg, cmt3em5t)
  const suspiciousIds = [
    "cmt3eldgc0n9a04jxszhr71ij",
    "cmt3em5tv0nbi04jx1wvvnla2",
    "cmt3eldgc0n9604jxh4p3bry1",
    "cmt3em5tv0nbf04jx89t24qq1",
    "cmt3eldgc0n9204jx01s8l3yx",
    "cmt3em5tv0nbc04jxauhdeiya"
  ];

  console.log("Finding imports that created these suspicious transactions...\n");

  for (const txId of suspiciousIds.slice(0, 2)) {
    const tx = await prisma.portfolioTransactionLine.findUnique({
      where: { id: txId }
    });

    if (tx) {
      const imp = await prisma.portfolioImport.findUnique({
        where: { id: tx.importId }
      });

      console.log(`TX ID: ${txId}`);
      console.log(`  Quantity: ${tx.quantity}, Amount: $${tx.amount}`);
      console.log(`  Import ID: ${tx.importId}`);
      console.log(`  Import Date: ${imp?.importedAt.toISOString().split("T")[0]}`);
      console.log(`  Data From: ${imp?.dataFromDate?.toISOString().split("T")[0]} to ${imp?.dataToDate?.toISOString().split("T")[0]}`);
      console.log("");
    }
  }

  // Compare with the "real" ones
  const realIds = [
    "cmot147xy003alsmnsjew5eeg",
    "cmosovh9v00h1jomndwssvf2t",
    "cmpyi6jx800010ai8w10419w3",
    "cmpyi7izp001w0ai8kvdrk7h9",
    "cmsxm5caw00hb04l49rkmxolp",
    "cmsxm5s6u00j704l4gl42btph"
  ];

  console.log("\nCompare with the real transactions:\n");
  for (const txId of realIds.slice(0, 2)) {
    const tx = await prisma.portfolioTransactionLine.findUnique({
      where: { id: txId }
    });

    if (tx) {
      const imp = await prisma.portfolioImport.findUnique({
        where: { id: tx.importId }
      });

      console.log(`TX ID: ${txId}`);
      console.log(`  Quantity: ${tx.quantity}, Amount: $${tx.amount}`);
      console.log(`  Import ID: ${tx.importId}`);
      console.log(`  Import Date: ${imp?.importedAt.toISOString().split("T")[0]}`);
      console.log(`  Data From: ${imp?.dataFromDate?.toISOString().split("T")[0]} to ${imp?.dataToDate?.toISOString().split("T")[0]}`);
      console.log("");
    }
  }
}

findImportSource()
  .catch(console.error)
  .finally(() => process.exit());
