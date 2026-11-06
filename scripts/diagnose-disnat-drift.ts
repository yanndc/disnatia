/**
 * Diagnostic « Écart vs Disnat » : d'où vient chaque dollar d'écart entre la valeur
 * recalculée (positions projetées × cours + encaisse fichier) et le dernier import
 * portefeuille Disnat (`portfolio_account_states`).
 *
 * Usage : npx tsx scripts/diagnose-disnat-drift.ts
 */
import { prisma } from "@/lib/db/prisma";
import { getDisnatDriftSummary } from "@/features/portfolio/disnat-drift";
import { loadHoldingsForDashboard } from "@/features/portfolio/holdings-display-query";
import { getUsdCadRateNear } from "@/lib/fx/latest-usd-cad-rate";
import { isoDateFromDbTimestamp } from "@/features/portfolio/daily-close-key";

const fmt = (n: number) => n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)} %`;
const toCad = (value: number, currency: string, usdToCad: number | null) => {
  const cur = currency.trim().toUpperCase();
  return (cur === "USD" || cur === "US") && usdToCad !== null ? value * usdToCad : value;
};

async function main() {
  const [states, holdings, quotes, fxRow] = await Promise.all([
    prisma.portfolioAccountState.findMany({ orderBy: { accountKey: "asc" } }),
    loadHoldingsForDashboard(),
    prisma.portfolioLiveQuote.findMany(),
    getUsdCadRateNear(null).catch(() => null),
  ]);
  const usdToCad = fxRow?.usdToCad ?? null;
  const quoteMap = new Map(
    quotes.map((q) => [`${q.ticker.toUpperCase()}|${q.currency.toUpperCase()}`, q.price]),
  );

  console.log(`Taux USD→CAD retenu : ${usdToCad ?? "—"}`);
  console.log(`Cours live en base     : ${quotes.length}`);
  const quoteDates = quotes.map((q) => q.fetchedAt.getTime());
  console.log(
    `  dernier rafraîchissement des cours : ${
      quoteDates.length ? new Date(Math.max(...quoteDates)).toISOString() : "—"
    } (aujourd'hui : ${new Date().toISOString().slice(0, 10)})`,
  );
  console.log("");

  const lastPortfolioImport = await prisma.portfolioImport.findFirst({
    where: { status: "COMPLETED", accounts: { some: {} } },
    orderBy: [{ dataToDate: "desc" }, { importedAt: "desc" }],
    select: { id: true, importedAt: true, dataToDate: true, sourceFileName: true, importType: true },
  });
  const filePositions = lastPortfolioImport
    ? await prisma.portfolioPosition.findMany({
        where: { importId: lastPortfolioImport.id },
        select: {
          accountNumber: true,
          ticker: true,
          currency: true,
          quantity: true,
          marketPrice: true,
          marketValue: true,
        },
      })
    : [];

  if (lastPortfolioImport) {
    console.log(
      `Dernier import AVEC COMPTES (référence de la carte) : ${lastPortfolioImport.sourceFileName} [${
        lastPortfolioImport.importType
      }] — importé le ${isoDateFromDbTimestamp(
        lastPortfolioImport.importedAt,
      )}, données au ${
        lastPortfolioImport.dataToDate ? isoDateFromDbTimestamp(lastPortfolioImport.dataToDate) : "—"
      }`,
    );
  } else {
    console.log("Aucun import PORTEFEUILLE en base.");
  }
  console.log("");

  const byAccountHoldings = new Map<string, typeof holdings>();
  for (const h of holdings) {
    const list = byAccountHoldings.get(h.accountKey) ?? [];
    list.push(h);
    byAccountHoldings.set(h.accountKey, list);
  }

  const fileByAccount = new Map<string, typeof filePositions>();
  for (const p of filePositions) {
    const key = `${(p.accountNumber ?? "").replace(/\s/g, "").toUpperCase()}|${p.currency.toUpperCase()}`;
    const list = fileByAccount.get(key) ?? [];
    list.push(p);
    fileByAccount.set(key, list);
  }

  const summary = await getDisnatDriftSummary();
  console.log(
    `GLOBAL : recalculé ${fmt(summary.global.liveCad)} $ · référence ${fmt(
      summary.global.disnatCad,
    )} $ au ${summary.referenceAsOf ?? "—"} [source ${summary.source}] → ${fmt(
      summary.global.deltaCad,
    )} $ (${pct(summary.global.deltaPct ?? 0)}) — ${summary.global.tone}`,
  );
  for (const row of summary.accounts.slice(0, 6)) {
    console.log(
      `  ${row.label} · ${row.owner ?? "—"} [${row.source} ${row.referenceAsOf ?? "—"}] : recalculé ${fmt(
        row.liveCad,
      )} $ vs ${fmt(row.disnatCad)} $ → ${fmt(row.deltaCad)} $ ${
        row.deltaPct === null ? "" : `(${pct(row.deltaPct)})`
      }`,
    );
  }
  console.log("");


  // --- Derniers imports, tous types confondus
  const recentImports = await prisma.portfolioImport.findMany({
    orderBy: { importedAt: "desc" },
    take: 10,
    select: {
      id: true,
      importType: true,
      status: true,
      importedAt: true,
      dataFromDate: true,
      dataToDate: true,
      sourceFileName: true,
      rawRowCount: true,
      _count: { select: { accounts: true, positions: true, transactions: true } },
    },
  });
  console.log("");
  console.log("DERNIERS IMPORTS (base) :");
  for (const imp of recentImports) {
    console.log(
      `  ${imp.importedAt.toISOString().slice(0, 16).replace("T", " ")} · ${imp.importType}/${
        imp.status
      } · ${imp.sourceFileName} · dataTo=${imp.dataToDate ? imp.dataToDate.toISOString().slice(0, 10) : "—"}` +
        ` · ${imp._count.accounts} compte(s), ${imp._count.positions} position(s), ${imp._count.transactions} transaction(s)`,
    );
  }
  console.log("");

  // --- Envois du favori « Vue d'ensemble » (encaisse/total par client)
  const cashSnaps = await prisma.disnatClientCashSnapshot.findMany({
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  console.log("");
  console.log("DERNIERS SNAPSHOTS FAVORI (disnat_client_cash_snapshots) :");
  for (const s of cashSnaps) {
    console.log(
      `  créé ${s.createdAt.toISOString().slice(0, 16).replace("T", " ")} · ${s.clientCode} · asOf ${
        s.asOfDate.toISOString().slice(0, 10)
      } · encaisse ${fmt(s.cashCad)} $ · titres ${fmt(s.securitiesCad)} $ · total ${fmt(s.totalCad)} $ [${
        s.source
      }]`,
    );
  }

  // --- Attestations (session guidée / import)
  const confirmations = await prisma.portfolioAccountConfirmation.findMany({
    orderBy: { confirmedAt: "desc" },
    take: 8,
  });
  console.log("");
  console.log("DERNIÈRES ATTESTATIONS DE COMPTE :");
  for (const c of confirmations) {
    console.log(
      `  ${c.confirmedAt.toISOString().slice(0, 16).replace("T", " ")} · ${c.accountKey} · dataAsOf ${
        c.dataAsOf.toISOString().slice(0, 10)
      } · total ${c.totalValue ?? "—"} · source ${c.source}`,
    );
  }

  // --- Comparaison à la référence la PLUS RÉCENTE disponible : le favori « Vue d'ensemble »
  // (disnat_client_cash_snapshots), qui donne titres + encaisse par client.
  const latestByClient = new Map<string, (typeof cashSnaps)[number]>();
  for (const s of cashSnaps) {
    const current = latestByClient.get(s.clientCode);
    if (!current || s.asOfDate > current.asOfDate) latestByClient.set(s.clientCode, s);
  }
  if (latestByClient.size > 0) {
    console.log("");
    console.log("ÉCART VS FAVORI (référence la plus récente, titres + encaisse officiels) :");
    let sumLive = 0;
    let sumRef = 0;
    for (const [clientCode, snap] of [...latestByClient.entries()].sort()) {
      const prefix = clientCode.toUpperCase();
      const clientStates = states.filter((s) => s.accountKey.startsWith(`${prefix}`));
      const positionsLive = clientStates.reduce((sum, s) => {
        const hs = byAccountHoldings.get(s.accountKey) ?? [];
        return (
          sum +
          hs.reduce((acc, h) => {
            const q = quoteMap.get(`${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`);
            const price = q ?? h.snapshotPrice ?? null;
            const native =
              price !== null && Number.isFinite(price) && price > 0 && Math.abs(h.quantity) > 0
                ? Math.abs(h.quantity) * price
                : Math.abs(h.snapshotValue);
            return acc + toCad(native, h.currency, usdToCad);
          }, 0)
        );
      }, 0);
      const cashFavori = snap.cashCad;
      const liveCad = positionsLive + cashFavori;
      const delta = liveCad - snap.totalCad;
      sumLive += liveCad;
      sumRef += snap.totalCad;
      console.log(
        `  ${clientCode} au ${snap.asOfDate.toISOString().slice(0, 10)} : recalculé ${fmt(
          liveCad,
        )} $ vs favori ${fmt(snap.totalCad)} $ → ${fmt(delta)} $ (${pct(
          (delta / snap.totalCad) * 100,
        )}) · titres recalculés ${fmt(positionsLive)} $ vs ${fmt(snap.securitiesCad)} $`,
      );
    }
    const delta = sumLive - sumRef;
    console.log(
      `  TOTAL : recalculé ${fmt(sumLive)} $ vs favori ${fmt(sumRef)} $ → ${fmt(delta)} $ (${pct(
        (delta / sumRef) * 100,
      )})`,
    );
  }

  // --- Contre-épreuve : mêmes positions, mais valorisées aux cours de clôture de la DATE
  // de la référence fichier. Si l'écart tombe à ~0, la projection est juste et l'écart
  // affiché n'est que la variation de marché entre le fichier et aujourd'hui.
  const refDate = states.length
    ? new Date(Math.max(...states.map((s) => s.asOf.getTime())))
    : null;
  if (refDate) {
    const refIso = isoDateFromDbTimestamp(refDate);
    const [refHoldings, refPrices] = await Promise.all([
      prisma.portfolioDailyHolding.findMany({ where: { holdingDate: refDate } }),
      prisma.portfolioDailyPrice.findMany({ where: { priceDate: refDate } }),
    ]);
    const refPriceMap = new Map(
      refPrices.map((p) => [`${p.ticker.toUpperCase()}|${p.currency.toUpperCase()}`, p.closePrice]),
    );
    const byAccount = new Map<string, { value: number; missing: string[]; qty: number }>();
    for (const h of refHoldings) {
      const price = refPriceMap.get(`${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`);
      const entry = byAccount.get(h.accountKey) ?? { value: 0, missing: [], qty: 0 };
      if (price === undefined) {
        entry.missing.push(`${h.ticker}|${h.currency}`);
      } else if (Math.abs(h.quantity) > 0) {
        entry.value += toCad(Math.abs(h.quantity) * price, h.currency, usdToCad);
        entry.qty += 1;
      }
      byAccount.set(h.accountKey, entry);
    }

    console.log("");
    console.log(
      `CONTRE-ÉPREUVE au ${refIso} (positions reconstruites × clôtures du jour de la référence) :`,
    );
    for (const state of states) {
      const entry = byAccount.get(state.accountKey) ?? { value: 0, missing: [], qty: 0 };
      const disnatCad = toCad(state.totalValue, state.currency, usdToCad);
      const cashCad = toCad(state.cashValue, state.currency, usdToCad);
      const titlesCad = toCad(state.marketValue, state.currency, usdToCad);
      if (disnatCad === 0) continue;
      const rebuilt = entry.value + cashCad;
      const delta = rebuilt - disnatCad;
      console.log(
        `  ${state.accountKey} : recalculé ${fmt(rebuilt)} $ vs fichier ${fmt(
          disnatCad,
        )} $ → ${fmt(delta)} $ (${pct((delta / disnatCad) * 100)})` +
          ` · titres ${entry.qty} ligne(s), sans clôture: ${entry.missing.length ? entry.missing.join(",") : "aucune"}` +
          ` · titres fichier ${fmt(titlesCad)} $`,
      );
    }
    console.log("");
  }

  for (const state of states) {
    const hs = byAccountHoldings.get(state.accountKey) ?? [];
    const disnatCad = toCad(state.totalValue, state.currency, usdToCad);
    const cashCad = toCad(state.cashValue, state.currency, usdToCad);
    const positionsCad = hs.reduce((sum, h) => {
      const q = quoteMap.get(`${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`);
      const price = q ?? h.snapshotPrice ?? null;
      const native =
        price !== null && Number.isFinite(price) && price > 0 && Math.abs(h.quantity) > 0
          ? Math.abs(h.quantity) * price
          : Math.abs(h.snapshotValue);
      return sum + toCad(native, h.currency, usdToCad);
    }, 0);
    const liveCad = positionsCad + cashCad;
    const delta = liveCad - disnatCad;

    console.log("──────────────────────────────────────────────────────────────");
    console.log(
      `${state.accountKey} · ${state.accountType ?? state.accountName} · ${state.owner ?? "—"}`,
    );
    console.log(
      `  référence fichier : ${fmt(disnatCad)} $ (titres ${fmt(
        toCad(state.marketValue, state.currency, usdToCad),
      )} + encaisse ${fmt(cashCad)} $) au ${isoDateFromDbTimestamp(state.asOf)}`,
    );
    console.log(`  recalculé         : ${fmt(liveCad)} $ (positions ${fmt(positionsCad)} $)`);
    console.log(
      `  écart             : ${fmt(delta)} $ ${disnatCad > 0 ? `(${pct((delta / disnatCad) * 100)})` : ""}`,
    );

    const noLive = hs.filter(
      (h) => !quoteMap.has(`${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`),
    );
    console.log(
      `  positions projetées : ${hs.length} ligne(s)${
        noLive.length
          ? ` · ${noLive.length} sans cours live (${noLive.map((h) => h.ticker).join(", ")})`
          : " · toutes avec cours live"
      }`,
    );

    const fileRows = fileByAccount.get(state.accountKey) ?? [];
    const projectedTickers = new Set(hs.map((h) => h.ticker.toUpperCase()));
    const onlyInFile = fileRows.filter((p) => !projectedTickers.has(p.ticker.toUpperCase()));
    if (onlyInFile.length > 0) {
      const missingValue = onlyInFile.reduce((s, p) => s + p.marketValue, 0);
      console.log(
        `  ⚠ ${onlyInFile.length} titre(s) du fichier absents de la projection (${fmt(
          missingValue,
        )} $ natifs) : ${onlyInFile.map((p) => `${p.ticker}×${p.quantity}`).join(", ")}`,
      );
    }
  }

  // --- Couverture à la date du rapport (ce que la table de conciliation appelle « 7/12 »)
  const lastHoldingDate = await prisma.portfolioDailyHolding.findFirst({
    orderBy: { holdingDate: "desc" },
    select: { holdingDate: true },
  });
  if (lastHoldingDate) {
    const dayIso = isoDateFromDbTimestamp(lastHoldingDate.holdingDate);
    const dayHoldings = await prisma.portfolioDailyHolding.findMany({
      where: { holdingDate: lastHoldingDate.holdingDate },
      select: { accountKey: true },
    });
    const withHistory = new Set(dayHoldings.map((h) => h.accountKey));
    const invested = states.filter((s) => s.totalValue > 0);
    const covered = invested.filter((s) => withHistory.has(s.accountKey));
    console.log("");
    console.log(
      `Couverture reconstruction au ${dayIso} : ${covered.length}/${invested.length} comptes non vides ont des positions ce jour-là`,
    );
    const uncovered = invested.filter((s) => !withHistory.has(s.accountKey));
    if (uncovered.length > 0) {
      console.log(`  sans position reconstruite : ${uncovered.map((s) => s.accountKey).join(", ")}`);
    }
  }

  console.log("");
  console.log("Fraîcheur des références fichier :");
  for (const state of [...states].sort((a, b) => a.asOf.getTime() - b.asOf.getTime())) {
    console.log(`  ${isoDateFromDbTimestamp(state.asOf)} · ${state.accountKey}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
