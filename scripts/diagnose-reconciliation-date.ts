/**
 * Diagnostic d'une ligne de conciliation : détail par compte des points retenus
 * (import portefeuille vs reconstruction) pour une date de rapport donnée.
 *
 * Usage : npx tsx scripts/diagnose-reconciliation-date.ts 2026-08-21
 */
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  defaultPerformanceFilters,
  disnatTitresMaterialKeys,
  minAcceptableHistoryAsOf,
  resolveActiveAccountKeys,
  resolvePeriodBounds,
} from "@/features/portfolio/performance-indicator-logic";

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });

function reportDateNoon(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year!, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
}

function bestPoint(
  points: { accountKey: string; asOf: string; marketValueNative?: number | null; totalValueNative: number }[],
  accountKey: string,
  targetDate: string,
  minAsOf: string,
) {
  let best: { native: number; asOf: string; source: "import" | "reconstruit" } | null = null;
  for (const pt of points) {
    if (pt.accountKey !== accountKey) continue;
    if (pt.asOf > targetDate || pt.asOf < minAsOf) continue;
    if (!best || pt.asOf > best.asOf) {
      best = {
        native: pt.marketValueNative ?? pt.totalValueNative,
        asOf: pt.asOf,
        source: "import",
      };
    }
  }
  return best;
}

async function main() {
  const reportDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  console.log(`Date de rapport : ${reportDate}\n`);

  const payload = await getPerformanceIndicatorPayload({ refreshQuotes: false });
  const filters = defaultPerformanceFilters(payload);
  const filtersDay = { ...filters, preset: "disnat" as const, activePeriod: "day" as const };

  const earliest = [...new Set(payload.snapshots.map((s) => s.asOf))].sort()[0] ?? null;
  const bounds = resolvePeriodBounds("day", reportDateNoon(reportDate), filters.selectedYear, earliest);
  console.log("Bornes :", bounds);
  const minStartAsOf = minAcceptableHistoryAsOf(bounds.baselineLookup ?? bounds.end);
  const minEndAsOf = minAcceptableHistoryAsOf(bounds.end);
  console.log(`Fenêtre start ≥ ${minStartAsOf} · fin ≥ ${minEndAsOf}\n`);

  const keys = resolveActiveAccountKeys(
    payload.accounts,
    "disnat",
    [],
    [],
    null,
    null,
    payload.portfolioScopes ?? [],
  ).filter((k) => !payload.accounts.find((a) => a.accountKey === k)?.isExternal);
  const material = disnatTitresMaterialKeys(
    keys,
    payload,
    bounds.baselineLookup ?? bounds.end,
    bounds.end,
  );

  const importsAtDate = payload.snapshots.filter((s) => s.asOf === reportDate);
  console.log(
    `Imports portefeuille au ${reportDate} : ${importsAtDate.length} compte(s) — ` +
      importsAtDate.map((s) => `${s.accountKey}=${fmt(s.marketValueNative ?? s.totalValueNative)}`).join(", "),
  );
  console.log("");

  for (const accountKey of material) {
    const label = payload.accounts.find((a) => a.accountKey === accountKey)?.label ?? accountKey;
    const startImport = bestPoint(payload.snapshots, accountKey, bounds.baselineLookup ?? bounds.end, minStartAsOf);
    const startHistory = startImport
      ? null
      : bestPoint(payload.historyPoints, accountKey, bounds.baselineLookup ?? bounds.end, minStartAsOf);
    const endImport = bestPoint(payload.snapshots, accountKey, bounds.end, minEndAsOf);
    const endHistory = endImport
      ? null
      : bestPoint(payload.historyPoints, accountKey, bounds.end, minEndAsOf);

    const start = startImport ?? startHistory;
    const end = endImport ?? endHistory;
    const flows = (payload.cashFlows ?? [])
      .filter((f) => f.accountKey === accountKey && f.tradeDate >= bounds.start! && f.tradeDate <= bounds.end)
      .reduce((sum, f) => sum + f.amountCad, 0);

    console.log(`${label} (${accountKey})`);
    console.log(
      `  début : ${fmt(start?.native)} $ ${start?.asOf ?? "—"} [${startImport ? "import" : "reconstruit"}]` +
        ` · fin : ${fmt(end?.native)} $ ${end?.asOf ?? "—"} [${endImport ? "import" : "reconstruit"}]` +
        ` · flux ${fmt(flows)} $ → gain ${fmt((end?.native ?? 0) - (start?.native ?? 0) - flows)} $`,
    );

    // Points disponibles autour des bornes (pour repérer un trou ou un import partiel)
    const importPoints = payload.snapshots
      .filter((s) => s.accountKey === accountKey && s.asOf <= bounds.end)
      .slice(-3)
      .map((s) => `${s.asOf}:${fmt(s.marketValueNative ?? s.totalValueNative)}`);
    const historyPoints = payload.historyPoints
      .filter((s) => s.accountKey === accountKey && s.asOf <= bounds.end)
      .slice(-3)
      .map((s) => `${s.asOf}:${fmt(s.marketValueNative ?? s.totalValueNative)}`);
    console.log(`  derniers imports  : ${importPoints.join(" | ") || "aucun"}`);
    console.log(`  dernière reconstr.: ${historyPoints.join(" | ") || "aucune"}`);
  }

  const app = (await import("@/features/portfolio/performance-indicator-logic")).computePeriodResultWithSnapshots(
    { ...payload, asOfNow: reportDate },
    filtersDay,
    "day",
  );
  console.log(`\nApp (séance du ${reportDate}) : ${fmt(app.gainCad)} $ (${app.method})`);
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
