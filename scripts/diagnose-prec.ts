/**
 * Diagnostic Préc. — reconstitue le calcul avec les données BD.
 * Usage: npx tsx scripts/diagnose-prec.ts
 */
import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computePeriodResult,
  computeTitresPeriodGain,
  titresCadAtOrBefore,
  resolvePeriodBounds,
} from "@/features/portfolio/performance-indicator-logic";
import { defaultPerformanceFilters } from "@/features/portfolio/performance-indicator-logic";
import {
  isoDateInToronto,
  priorSessionDateIso,
  previousTradingDayIso,
} from "@/lib/market/equity-session";
import { netExternalFlowsCad } from "@/features/portfolio/performance-cash-flows";
import { isoDateFromDbDate } from "@/features/portfolio/daily-close-key";

const fmt = (n: number) =>
  n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });

async function main() {
  const now = new Date();
  const today = isoDateInToronto(now);
  const d1 = priorSessionDateIso(now);
  const d0 = previousTradingDayIso(d1, 1);

  console.log("=== Dates Préc. (Toronto, maintenant) ===");
  console.log("Aujourd'hui (T):", today);
  console.log("Séance mesurée (D1):", d1);
  console.log("Clôture référence (D0):", d0);

  const payload = await getPerformanceIndicatorPayload();
  const filters = defaultPerformanceFilters(payload);
  const accountKeys = payload.accounts
    .filter((a) => !a.isExternal)
    .map((a) => a.accountKey);

  const bounds = resolvePeriodBounds("yesterday", now, 2026, null);
  console.log("\n=== Bornes code (yesterday) ===");
  console.log(bounds);

  const startHit = titresCadAtOrBefore(accountKeys, payload, bounds.baselineLookup!);
  const calc = computeTitresPeriodGain(accountKeys, payload, {
    start: bounds.start!,
    end: bounds.end,
    baselineLookup: bounds.baselineLookup,
  });
  const prec = computePeriodResult(payload, filters, "yesterday");

  console.log("\n=== Résultat affiché (Préc.) ===");
  console.log("gainCad:", prec.gainCad, "gainPct:", prec.gainPct?.toFixed(2) + "%");
  console.log("baselineCad:", prec.baselineCad, "method:", prec.method);
  console.log("note:", prec.note);

  console.log("\n=== Décomposition computeTitresPeriodGain ===");
  console.log("V_debut (D0):", startHit?.valueCad, "coverage:", startHit?.asOf);
  console.log("V_fin implicite:", calc.gainCad != null && startHit ? startHit.valueCad + (calc.gainCad ?? 0) + netExternalFlowsCad(payload.cashFlows, accountKeys, bounds.start!, bounds.end) : "?");

  const flows = netExternalFlowsCad(
    payload.cashFlows,
    accountKeys,
    bounds.start!,
    bounds.end,
  );
  console.log("Flux nets F sur D1:", fmt(flows));
  if (startHit && calc.gainCad != null) {
    const vFin = startHit.valueCad + calc.gainCad + flows;
    console.log("V_fin (D1) reconstruit:", fmt(vFin));
    console.log("Formule: V_fin - V_debut - F =", fmt(vFin), "-", fmt(startHit.valueCad), "-", fmt(flows), "=", fmt(calc.gainCad));
    const denom = startHit.valueCad + flows;
    console.log("% =", fmt(calc.gainCad), "/", fmt(denom), "=", ((calc.gainCad / denom) * 100).toFixed(2) + "%");
  }

  const positionsCadNow = accountKeys.reduce(
    (s, k) => s + (payload.currentByAccount[k]?.positionsCad ?? 0),
    0,
  );
  console.log("\n=== Comparaison (diagnostic gonflement) ===");
  console.log("Positions live actuelles (Σ):", fmt(positionsCadNow));
  console.log("Δ live vs V_debut:", fmt(positionsCadNow - (startHit?.valueCad ?? 0)));

  const sessionSum = (payload.sessionGainsByAccount[accountKeys[0]!] ?? [])
    .concat(...accountKeys.slice(1).map((k) => payload.sessionGainsByAccount[k] ?? []))
    .filter((g) => g.date === d1)
    .reduce((s, g) => s + g.gainCad, 0);
  let sessionSumAll = 0;
  for (const k of accountKeys) {
    for (const g of payload.sessionGainsByAccount[k] ?? []) {
      if (g.date === d1) sessionSumAll += g.gainCad;
    }
  }
  console.log("Σ session_gains persistés (D1):", fmt(sessionSumAll));

  console.log("\n=== V(D) par compte (historyPoints) ===");
  for (const key of accountKeys.slice(0, 20)) {
    const d0v = titresCadAtOrBefore([key], payload, d0);
    const d1v = titresCadAtOrBefore([key], payload, d1);
    const cur = payload.currentByAccount[key];
    console.log(
      key.slice(0, 24),
      "| D0:", d0v?.valueCad != null ? fmt(d0v.valueCad) : "—",
      "asOf:", d0v?.asOf ?? "—",
      "| D1:", d1v?.valueCad != null ? fmt(d1v.valueCad) : "—",
      "asOf:", d1v?.asOf ?? "—",
      "| live:", cur ? fmt(cur.positionsCad) : "—",
      "| Δ D1-D0:", d0v && d1v ? fmt(d1v.valueCad - d0v.valueCad) : "—",
    );
  }
  if (accountKeys.length > 20) {
    console.log(`… +${accountKeys.length - 20} comptes`);
  }

  const [holdingsD0, holdingsD1, pricesAround] = await Promise.all([
    prisma.portfolioDailyHolding.count({
      where: { holdingDate: new Date(`${d0}T12:00:00.000Z`), quantity: { gt: 0 } },
    }),
    prisma.portfolioDailyHolding.count({
      where: { holdingDate: new Date(`${d1}T12:00:00.000Z`), quantity: { gt: 0 } },
    }),
    prisma.portfolioDailyPrice.count({
      where: {
        priceDate: {
          gte: new Date(`${d0}T12:00:00.000Z`),
          lte: new Date(`${d1}T12:00:00.000Z`),
        },
      },
    }),
  ]);
  console.log("\n=== Couverture BD brute ===");
  console.log("Lignes holdings D0:", holdingsD0, "| D1:", holdingsD1, "| prices D0→D1:", pricesAround);
  console.log("historyPoints:", payload.historyPoints.length);
  console.log("sessionDataHealth:", payload.sessionDataHealth);

  const topHoldingsD1 = await prisma.portfolioDailyHolding.findMany({
    where: {
      holdingDate: new Date(`${d1}T12:00:00.000Z`),
      quantity: { gt: 0 },
    },
    select: {
      accountKey: true,
      ticker: true,
      currency: true,
      quantity: true,
    },
    take: 15,
    orderBy: { quantity: "desc" },
  });

  console.log("\n=== Échantillon holdings D1 (top qty) ===");
  for (const h of topHoldingsD1) {
    const price = await prisma.portfolioDailyPrice.findFirst({
      where: {
        ticker: h.ticker,
        currency: h.currency,
        priceDate: new Date(`${d1}T12:00:00.000Z`),
      },
      select: { closePrice: true },
    });
    const val = price ? h.quantity * price.closePrice : null;
    console.log(
      h.ticker,
      h.currency,
      "qty", h.quantity,
      "close", price?.closePrice ?? "MISSING",
      "val native", val != null ? fmt(val) : "—",
    );
  }

  const dupCheck = await prisma.$queryRaw<
    { account_key: string; ticker: string; currency: string; cnt: bigint }[]
  >`
    SELECT account_key, ticker, currency, COUNT(*)::bigint AS cnt
    FROM portfolio_daily_holdings
    WHERE holding_date = ${new Date(`${d1}T12:00:00.000Z`)}::date
      AND quantity > 0
    GROUP BY account_key, ticker, currency
    HAVING COUNT(*) > 1
    LIMIT 10
  `;
  if (dupCheck.length > 0) {
    console.log("\n⚠ Doublons holdings D1:", dupCheck);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
