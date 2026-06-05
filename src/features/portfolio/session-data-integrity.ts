import { prisma } from "@/lib/db/prisma";
import { sendHtmlEmail } from "@/lib/email/resend-client";
import {
  referenceTradingSessionDay,
  referenceTradingSessionDayIso,
  isoDateInToronto,
  previousTradingDay,
} from "@/lib/market/equity-session";
import { parseIsoDateLocal, isoDateFromDbDate } from "./daily-close-key";
import {
  ensureDailyHoldingsUpToDate,
  recomputeDailyPortfolioValues,
} from "./backfill-market-history";
import { recomputeAndPersistSessionGains } from "./performance-session-gains";
import { getUsdCadRateNear } from "@/lib/fx/latest-usd-cad-rate";

export type SessionIntegrityCheck = {
  ok: boolean;
  expectedSessionDate: string;
  issues: string[];
  metrics: {
    accountCount: number;
    accountsWithHoldingsCount: number;
    holdingsRows: number;
    pricesRows: number;
    valuesRows: number;
    sessionGainRows: number;
    maxHoldingDate: string | null;
    maxPriceDate: string | null;
    maxValueDate: string | null;
    maxSessionGainDate: string | null;
  };
};

function makeFailureMessage(check: SessionIntegrityCheck): string {
  return [
    `Integrite seance invalide (${check.expectedSessionDate})`,
    ...check.issues.map((issue) => `- ${issue}`),
  ].join("\n");
}

/** Résumé lisible pour l’UI après un backfill historique. */
export function formatSessionIntegrityForUser(check: SessionIntegrityCheck): string[] {
  const lines = [
    `Séance de référence : ${check.expectedSessionDate}`,
    `Comptes actifs : ${check.metrics.accountCount}`,
    `Comptes avec titres (séance) : ${check.metrics.accountsWithHoldingsCount}`,
    `Lignes holdings (séance) : ${check.metrics.holdingsRows}`,
    `Lignes clôtures (séance) : ${check.metrics.pricesRows}`,
    `Lignes valeurs jour (séance) : ${check.metrics.valuesRows}`,
    `Gains de séance persistés : ${check.metrics.sessionGainRows}`,
  ];
  if (check.metrics.maxHoldingDate) {
    lines.push(`Dernière date holdings : ${check.metrics.maxHoldingDate}`);
  }
  if (check.metrics.maxPriceDate) {
    lines.push(`Dernière date clôtures : ${check.metrics.maxPriceDate}`);
  }
  if (check.metrics.maxSessionGainDate) {
    lines.push(`Dernière date gains séance : ${check.metrics.maxSessionGainDate}`);
  }
  if (check.issues.length > 0) {
    lines.push("", "Problèmes :");
    for (const issue of check.issues) {
      lines.push(`• ${issue}`);
    }
    if (check.issues.some((i) => i.includes("holdings"))) {
      lines.push(
        "",
        "→ Lance d’abord « Recalcul portefeuille » si les holdings sont en retard.",
      );
    }
  }
  return lines;
}

export async function checkSessionDataIntegrity(
  expectedSessionDate = referenceTradingSessionDayIso(new Date()),
): Promise<SessionIntegrityCheck> {
  const day = parseIsoDateLocal(expectedSessionDate);
  const [
    accountCount,
    accountsWithHoldings,
    holdingsRows,
    pricesRows,
    valuesRows,
    sessionGainRows,
    maxHoldingRow,
    maxPriceRow,
    maxValueRow,
    maxSessionGainRow,
  ] = await Promise.all([
    prisma.portfolioAccountState.count(),
    prisma.portfolioDailyHolding.groupBy({
      by: ["accountKey"],
      where: {
        holdingDate: day,
        quantity: { gt: 0 },
      },
    }),
    prisma.portfolioDailyHolding.count({
      where: {
        holdingDate: day,
        quantity: { gt: 0 },
      },
    }),
    prisma.portfolioDailyPrice.count({
      where: { priceDate: day },
    }),
    prisma.portfolioDailyValue.count({
      where: { valueDate: day },
    }),
    prisma.portfolioDailyAccountSessionGain.count({
      where: { sessionDate: day },
    }),
    prisma.portfolioDailyHolding.findFirst({
      orderBy: { holdingDate: "desc" },
      select: { holdingDate: true },
    }),
    prisma.portfolioDailyPrice.findFirst({
      orderBy: { priceDate: "desc" },
      select: { priceDate: true },
    }),
    prisma.portfolioDailyValue.findFirst({
      orderBy: { valueDate: "desc" },
      select: { valueDate: true },
    }),
    prisma.portfolioDailyAccountSessionGain.findFirst({
      orderBy: { sessionDate: "desc" },
      select: { sessionDate: true },
    }),
  ]);

  const maxHoldingDate = maxHoldingRow?.holdingDate
    ? isoDateFromDbDate(maxHoldingRow.holdingDate)
    : null;
  const maxPriceDate = maxPriceRow?.priceDate
    ? isoDateFromDbDate(maxPriceRow.priceDate)
    : null;
  const maxValueDate = maxValueRow?.valueDate
    ? isoDateFromDbDate(maxValueRow.valueDate)
    : null;
  const maxSessionGainDate = maxSessionGainRow?.sessionDate
    ? isoDateFromDbDate(maxSessionGainRow.sessionDate)
    : null;

  const accountsWithHoldingsCount = accountsWithHoldings.length;
  const issues: string[] = [];
  if (accountsWithHoldingsCount > 0 && holdingsRows === 0) {
    issues.push("Aucune ligne portfolio_daily_holdings pour la seance attendue.");
  }
  if (accountsWithHoldingsCount > 0 && pricesRows === 0) {
    issues.push("Aucune ligne portfolio_daily_prices pour la seance attendue.");
  }
  if (valuesRows === 0) {
    issues.push("Aucune ligne portfolio_daily_values pour la seance attendue.");
  }
  if (accountsWithHoldingsCount > 0 && sessionGainRows === 0) {
    issues.push("Aucune ligne portfolio_daily_account_session_gains pour la seance attendue.");
  }
  if (accountsWithHoldingsCount > 0 && sessionGainRows < accountsWithHoldingsCount) {
    issues.push(
      `Nombre de comptes avec gain de seance (${sessionGainRows}) inferieur aux comptes avec titres (${accountsWithHoldingsCount}).`,
    );
  }
  if (maxHoldingDate && maxHoldingDate < expectedSessionDate) {
    issues.push(
      `Derniere date holdings en retard (${maxHoldingDate} < ${expectedSessionDate}).`,
    );
  }
  if (maxPriceDate && maxPriceDate < expectedSessionDate) {
    issues.push(
      `Derniere date prices en retard (${maxPriceDate} < ${expectedSessionDate}).`,
    );
  }
  if (maxValueDate && maxValueDate < expectedSessionDate) {
    issues.push(
      `Derniere date values en retard (${maxValueDate} < ${expectedSessionDate}).`,
    );
  }
  if (maxSessionGainDate && maxSessionGainDate < expectedSessionDate) {
    issues.push(
      `Derniere date session_gains en retard (${maxSessionGainDate} < ${expectedSessionDate}).`,
    );
  }

  return {
    ok: issues.length === 0,
    expectedSessionDate,
    issues,
    metrics: {
      accountCount,
      accountsWithHoldingsCount,
      holdingsRows,
      pricesRows,
      valuesRows,
      sessionGainRows,
      maxHoldingDate,
      maxPriceDate,
      maxValueDate,
      maxSessionGainDate,
    },
  };
}

/** Aligne holdings, valeurs journalières et gains de séance sur la séance attendue. */
export async function repairSessionDataForExpectedSession(
  now = new Date(),
  trailingDays = 60,
): Promise<void> {
  await ensureDailyHoldingsUpToDate(now);

  const sessionEnd = referenceTradingSessionDayIso(now);
  const fromDate = isoDateInToronto(
    previousTradingDay(parseIsoDateLocal(sessionEnd), trailingDays),
  );
  await recomputeDailyPortfolioValues(fromDate, sessionEnd);

  const disnatAccountKeys = (
    await prisma.portfolioAccountState.findMany({ select: { accountKey: true } })
  ).map((row) => row.accountKey);
  if (disnatAccountKeys.length === 0) return;

  const fx = await getUsdCadRateNear(now);
  await recomputeAndPersistSessionGains(
    disnatAccountKeys,
    fromDate,
    sessionEnd,
    fx?.usdToCad ?? null,
  );
}

export async function assertSessionDataIntegrity(
  expectedSessionDate?: string,
): Promise<SessionIntegrityCheck> {
  const check = await checkSessionDataIntegrity(expectedSessionDate);
  if (!check.ok) {
    throw new Error(makeFailureMessage(check));
  }
  return check;
}

export async function notifySessionIntegrityFailure(
  context: string,
  check: SessionIntegrityCheck,
): Promise<void> {
  const html = `
    <h2>DisnatIA - Alerte integrite seance</h2>
    <p><strong>Contexte:</strong> ${context}</p>
    <p><strong>Seance attendue:</strong> ${check.expectedSessionDate}</p>
    <p><strong>Problemes:</strong></p>
    <ul>
      ${check.issues.map((issue) => `<li>${issue}</li>`).join("")}
    </ul>
    <p><strong>Metriques:</strong></p>
    <pre>${JSON.stringify(check.metrics, null, 2)}</pre>
  `;
  await sendHtmlEmail({
    subject: `DisnatIA ALERTE integrite seance ${check.expectedSessionDate}`,
    html,
  });
}
