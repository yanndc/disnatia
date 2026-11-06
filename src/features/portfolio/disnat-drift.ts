import { prisma } from "@/lib/db/prisma";
import { getUsdCadRateNear } from "@/lib/fx/latest-usd-cad-rate";
import { loadHoldingsForDashboard } from "./holdings-display-query";
import { clientCodeFromAccountKey } from "./account-coverage";
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
  /** Total de la référence chez Disnat (export portefeuille ou favori « Vue d'ensemble »). */
  disnatCad: number;
  /** Total recalculé : titres projetés (cours live si dispo) + encaisse officielle. */
  liveCad: number;
  deltaCad: number;
  deltaPct: number | null;
  tone: DriftTone;
  /** Origine de la référence : export portefeuille CSV ou favori « Vue d'ensemble ». */
  source: DriftSource;
  /** Date de la référence utilisée pour ce compte / client. */
  referenceAsOf: string | null;
};

export type DriftSource = "csv" | "favori";

export type DisnatDriftSummary = {
  referenceAsOf: string | null;
  /** Référence réellement utilisée pour le total (la plus récente disponible). */
  source: DriftSource;
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

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Conciliation « valeur recalculée vs référence Disnat ».
 *
 * Deux sources de référence, la plus récente gagne :
 * 1. **Favori « Vue d'ensemble »** (`disnat_client_cash_snapshots`) : titres + encaisse
 *    officiels par client, envoyés depuis la page Disnat (souvent quotidiennement).
 * 2. **Export portefeuille CSV** (`portfolio_account_states`) : totaux par compte, mis à jour
 *    à chaque import de fichier portefeuille.
 *
 * Comparer un export vieux de plusieurs semaines aux cours du jour produit un « écart » qui
 * n'est que la variation de marché : c'est pourquoi le favori, plus frais, est prioritaire.
 */
export async function getDisnatDriftSummary(): Promise<DisnatDriftSummary> {
  const [states, holdings, quotes, fxRow, cashSnapshots] = await Promise.all([
    prisma.portfolioAccountState.findMany(),
    loadHoldingsForDashboard(),
    prisma.portfolioLiveQuote.findMany().catch(() => []),
    getUsdCadRateNear(null).catch(() => null),
    prisma.disnatClientCashSnapshot.findMany({ orderBy: { asOfDate: "desc" } }).catch(() => []),
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

  const round2 = (value: number) => Math.round(value * 100) / 100;
  const positionsFor = (accountKeys: string[]) =>
    accountKeys.reduce((sum, key) => sum + (positionsByAccount.get(key) ?? 0), 0);

  // États d'import portefeuille regroupés par client (pour savoir s'ils sont plus frais).
  const statesByClient = new Map<string, typeof states>();
  for (const state of states) {
    const clientCode = clientCodeFromAccountKey(state.accountKey);
    const list = statesByClient.get(clientCode) ?? [];
    list.push(state);
    statesByClient.set(clientCode, list);
  }

  const accounts: DisnatAccountDrift[] = [];
  /** Clients couverts par une référence favori plus fraîche que le CSV. */
  const coveredClients = new Set<string>();

  // 1) Référence favori « Vue d'ensemble » : titres + encaisse officiels, par client.
  //    `cashSnapshots` est trié par date décroissante → le premier vu est le plus récent.
  for (const snap of cashSnapshots) {
    const clientCode = snap.clientCode.toUpperCase();
    if (coveredClients.has(clientCode)) continue;
    const clientStates = statesByClient.get(clientCode) ?? [];
    if (clientStates.length === 0) continue;
    const csvAsOfMs = Math.max(...clientStates.map((state) => state.asOf.getTime()));
    if (csvAsOfMs >= snap.asOfDate.getTime()) continue; // l'export portefeuille est au moins aussi récent
    coveredClients.add(clientCode);

    const disnatCad = snap.totalCad;
    const liveCad = positionsFor(clientStates.map((state) => state.accountKey)) + snap.cashCad;
    const deltaCad = round2(liveCad - disnatCad);
    const deltaPct = disnatCad > 0 ? Math.round((deltaCad / disnatCad) * 10_000) / 100 : null;
    const owner =
      clientStates.find((state) => state.owner && state.owner.trim().length > 0)?.owner ?? null;
    accounts.push({
      accountKey: `${clientCode}|CLIENT`,
      label: `Client ${clientCode}`,
      owner,
      currency: "CAD",
      disnatCad: round2(disnatCad),
      liveCad: round2(liveCad),
      deltaCad,
      deltaPct,
      tone: driftTone(deltaPct),
      source: "favori",
      referenceAsOf: isoDay(snap.asOfDate),
    });
  }

  // 2) Repli : export portefeuille, compte par compte (clients sans favori récent).
  for (const state of states) {
    if (coveredClients.has(clientCodeFromAccountKey(state.accountKey))) continue;
    const disnatCad = toCad(state.totalValue, state.currency, usdToCad);
    const cashCad = toCad(state.cashValue, state.currency, usdToCad);
    const liveCad = (positionsByAccount.get(state.accountKey) ?? 0) + cashCad;
    const deltaCad = round2(liveCad - disnatCad);
    const deltaPct = disnatCad > 0 ? Math.round((deltaCad / disnatCad) * 10_000) / 100 : null;
    const number = formatAccountNumber(state.accountNumber);
    accounts.push({
      accountKey: state.accountKey,
      label: `${state.accountType ?? state.accountName}${number ? ` ${number}` : ""}`,
      owner: state.owner ?? null,
      currency: state.currency,
      disnatCad: round2(disnatCad),
      liveCad: round2(liveCad),
      deltaCad,
      deltaPct,
      tone: driftTone(deltaPct),
      source: "csv",
      referenceAsOf: isoDay(state.asOf),
    });
  }

  const disnatCad = accounts.reduce((sum, account) => sum + account.disnatCad, 0);
  const liveCad = accounts.reduce((sum, account) => sum + account.liveCad, 0);
  const deltaCad = round2(liveCad - disnatCad);
  const deltaPct = disnatCad > 0 ? Math.round((deltaCad / disnatCad) * 10_000) / 100 : null;
  const referenceDates = accounts
    .map((account) => account.referenceAsOf)
    .filter((value): value is string => Boolean(value));
  const referenceAsOf = referenceDates.length
    ? referenceDates.sort()[referenceDates.length - 1]!
    : null;
  const source: DriftSource =
    accounts.length > 0 && accounts.every((account) => account.source === "favori") ? "favori" : "csv";

  return {
    referenceAsOf,
    source,
    global: {
      disnatCad: round2(disnatCad),
      liveCad: round2(liveCad),
      deltaCad,
      deltaPct,
      tone: driftTone(deltaPct),
    },
    accounts: accounts.sort((a, b) => Math.abs(b.deltaCad) - Math.abs(a.deltaCad)),
  };
}
