import { prisma } from "@/lib/db/prisma";
import { getUsdCadRateNear } from "@/lib/fx/latest-usd-cad-rate";
import { loadHoldingsForDashboard } from "./holdings-display-query";
import { formatAccountNumber } from "@/lib/utils";

/** Écart accepté entre la valeur recalculée et la référence du fichier Disnat (%). */
export const DRIFT_OK_PCT = 0.5;
export const DRIFT_WARN_PCT = 2;

export type DriftTone = "ok" | "warning" | "error";

export function driftTone(deltaPct: number | null): DriftTone {
  if (deltaPct === null || !Number.isFinite(deltaPct)) return "warning";
  const abs = Math.abs(deltaPct);
  if (abs <= DRIFT_OK_PCT) return "ok";
  if (abs <= DRIFT_WARN_PCT) return "warning";
  return "error";
}

export type DisnatAccountDrift = {
  accountKey: string;
  label: string;
  owner: string | null;
  currency: string;
  /** Total du dernier export portefeuille Disnat (référence fichier). */
  disnatCad: number;
  /** Total recalculé : titres projetés (cours live si dispo) + encaisse du fichier. */
  liveCad: number;
  deltaCad: number;
  deltaPct: number | null;
  tone: DriftTone;
};

export type DisnatDriftSummary = {
  referenceAsOf: string | null;
  global: {
    disnatCad: number;
    liveCad: number;
    deltaCad: number;
    deltaPct: number | null;
    tone: DriftTone;
  };
  accounts: DisnatAccountDrift[];
};

function toCad(value: number, currency: string, usdToCad: number | null): number {
  const cur = currency.trim().toUpperCase();
  if ((cur === "USD" || cur === "US") && usdToCad !== null) return value * usdToCad;
  return value;
}

/**
 * Conciliation « valeur recalculée vs fichier Disnat », par compte.
 * Sert de preuve que les imports de transactions reproduisent bien les états Disnat.
 */
export async function getDisnatDriftSummary(): Promise<DisnatDriftSummary> {
  const [states, holdings, quotes, fxRow] = await Promise.all([
    prisma.portfolioAccountState.findMany(),
    loadHoldingsForDashboard(),
    prisma.portfolioLiveQuote.findMany().catch(() => []),
    getUsdCadRateNear(null).catch(() => null),
  ]);
  const usdToCad = fxRow?.usdToCad ?? null;
  const quoteMap = new Map(
    quotes.map((quote) => [`${quote.ticker.toUpperCase()}|${quote.currency.toUpperCase()}`, quote.price]),
  );

  const positionsByAccount = new Map<string, number>();
  for (const holding of holdings) {
    const quote = quoteMap.get(`${holding.ticker.toUpperCase()}|${holding.currency.toUpperCase()}`);
    const price = quote ?? holding.snapshotPrice ?? null;
    const valueNative =
      price !== null && Number.isFinite(price) && price > 0 && Math.abs(holding.quantity) > 0
        ? Math.abs(holding.quantity) * price
        : Math.abs(holding.snapshotValue);
    const valueCad = toCad(valueNative, holding.currency, usdToCad);
    positionsByAccount.set(
      holding.accountKey,
      (positionsByAccount.get(holding.accountKey) ?? 0) + valueCad,
    );
  }

  const accounts: DisnatAccountDrift[] = states.map((state) => {
    const disnatCad = toCad(state.totalValue, state.currency, usdToCad);
    const cashCad = toCad(state.cashValue, state.currency, usdToCad);
    const liveCad = (positionsByAccount.get(state.accountKey) ?? 0) + cashCad;
    const deltaCad = Math.round((liveCad - disnatCad) * 100) / 100;
    const deltaPct = disnatCad > 0 ? Math.round((deltaCad / disnatCad) * 10_000) / 100 : null;
    const number = formatAccountNumber(state.accountNumber);
    return {
      accountKey: state.accountKey,
      label: `${state.accountType ?? state.accountName}${number ? ` ${number}` : ""}`,
      owner: state.owner ?? null,
      currency: state.currency,
      disnatCad: Math.round(disnatCad * 100) / 100,
      liveCad: Math.round(liveCad * 100) / 100,
      deltaCad,
      deltaPct,
      tone: driftTone(deltaPct),
    };
  });

  const disnatCad = accounts.reduce((sum, account) => sum + account.disnatCad, 0);
  const liveCad = accounts.reduce((sum, account) => sum + account.liveCad, 0);
  const deltaCad = Math.round((liveCad - disnatCad) * 100) / 100;
  const deltaPct = disnatCad > 0 ? Math.round((deltaCad / disnatCad) * 10_000) / 100 : null;
  const referenceAsOf = states.length
    ? new Date(Math.max(...states.map((state) => state.asOf.getTime()))).toISOString().slice(0, 10)
    : null;

  return {
    referenceAsOf,
    global: {
      disnatCad: Math.round(disnatCad * 100) / 100,
      liveCad: Math.round(liveCad * 100) / 100,
      deltaCad,
      deltaPct,
      tone: driftTone(deltaPct),
    },
    accounts: accounts.sort(
      (a, b) => Math.abs(b.deltaCad) - Math.abs(a.deltaCad),
    ),
  };
}
