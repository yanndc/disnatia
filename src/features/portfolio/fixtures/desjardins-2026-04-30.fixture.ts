import type { EnrichedPosition } from "@/features/portfolio/live-enrichment";
import type {
  PerformanceAccountRef,
  PerformanceIndicatorPayload,
} from "@/features/portfolio/performance-indicator-types";

/**
 * Référence Disnat — vue d'ensemble « Total des actifs », au 30 avril 2026.
 * Variation = P&L titres du jour (CAD), hors liquidités.
 */
export const DESJARDINS_2026_04_30 = {
  asOf: "2026-04-30",
  usdToCad: 1.3779,
  yann: {
    accountNumber: "5KFZE",
    owner: "Yann De Champlain",
    variationCad: 1_010.37,
    titresCad: 169_178.56,
    cashCad: 537.94,
    totalCad: 169_716.51,
  },
  valerie: {
    accountNumber: "5L3AP",
    owner: "Valerie Degrandpre",
    variationCad: 360.8,
    titresCad: 68_902.47,
    cashCad: 126.85,
    totalCad: 69_029.32,
  },
  consolidated: {
    variationCad: 1_371.17,
    titresCad: 238_081.03,
    cashCad: 664.79,
    totalCad: 238_745.82,
  },
} as const;

const REF = DESJARDINS_2026_04_30;

export function desjardinsAccountKey(accountNumber: string): string {
  return `${accountNumber}|CAD`;
}

function positionRow(
  accountKey: string,
  accountName: string,
  dayGain: number,
  titresEnd: number,
): EnrichedPosition {
  const prior = titresEnd - dayGain;
  return {
    id: `${accountKey}-${titresEnd}`,
    accountKey,
    accountName,
    ticker: "BENCH",
    currency: "CAD",
    quantity: 1,
    marketValue: titresEnd,
    marketPrice: titresEnd,
    bookValue: prior,
    displayPrice: titresEnd,
    displayMarketValue: titresEnd,
    disnatMarketValue: titresEnd,
    disnatMarketPrice: titresEnd,
    quoteFetchedAt: new Date(`${REF.asOf}T20:00:00Z`),
    usesLiveQuote: true,
    quoteChangePerShare: dayGain,
    displayDayGainLoss: dayGain,
    quoteSessionChangePct: prior > 0 ? (dayGain / prior) * 100 : null,
    importId: null,
    createdAt: new Date(`${REF.asOf}T16:00:00Z`),
    updatedAt: new Date(`${REF.asOf}T20:00:00Z`),
  } as unknown as EnrichedPosition;
}

/** Positions synthétiques : Σ displayDayGainLoss = variation Disnat par titulaire. */
export function desjardinsPositionsByAccountKey(): Map<string, EnrichedPosition[]> {
  const yannKey = desjardinsAccountKey(REF.yann.accountNumber);
  const valKey = desjardinsAccountKey(REF.valerie.accountNumber);

  return new Map([
    [
      yannKey,
      [
        positionRow(yannKey, REF.yann.owner, 510.18, 70_000),
        positionRow(yannKey, REF.yann.owner, 500.19, 99_178.56),
      ],
    ],
    [
      valKey,
      [
        positionRow(valKey, REF.valerie.owner, 180.4, 30_000),
        positionRow(valKey, REF.valerie.owner, 180.4, 38_902.47),
      ],
    ],
  ]);
}

function accountRef(
  accountNumber: string,
  owner: string,
): PerformanceAccountRef {
  const key = desjardinsAccountKey(accountNumber);
  return {
    accountKey: key,
    label: `CELI · ${accountNumber}`,
    owner,
    accountType: "CELI",
    currency: "CAD",
    isExternal: false,
  };
}

function currentAccount(
  titresCad: number,
  cashCad: number,
  variationCad: number,
) {
  return {
    totalCad: titresCad + cashCad,
    positionsCad: titresCad,
    cashCad,
    dayGainCad: variationCad,
    dayPriorCad: titresCad - variationCad,
  };
}

export function desjardinsPerformancePayload(
  options: { marketOpen?: boolean } = {},
): PerformanceIndicatorPayload {
  const { marketOpen = true } = options;
  const yannKey = desjardinsAccountKey(REF.yann.accountNumber);
  const valKey = desjardinsAccountKey(REF.valerie.accountNumber);

  const accounts = [
    accountRef(REF.yann.accountNumber, REF.yann.owner),
    accountRef(REF.valerie.accountNumber, REF.valerie.owner),
  ];

  const currentByAccount = {
    [yannKey]: currentAccount(
      REF.yann.titresCad,
      REF.yann.cashCad,
      REF.yann.variationCad,
    ),
    [valKey]: currentAccount(
      REF.valerie.titresCad,
      REF.valerie.cashCad,
      REF.valerie.variationCad,
    ),
  };

  const sessionGainCad = REF.yann.variationCad + REF.valerie.variationCad;
  const sessionPriorCad = REF.consolidated.titresCad - sessionGainCad;

  return {
    accounts,
    currentByAccount,
    snapshots: [],
    historyPoints: [],
    dailyTotalsCad: [],
    sessionGainsByDate: marketOpen
      ? []
      : [{ date: REF.asOf, gainCad: sessionGainCad, priorCad: sessionPriorCad }],
    sessionDataHealth: {
      ok: true,
      message: null,
      persistedDays: marketOpen ? 0 : 1,
      firstDate: marketOpen ? null : REF.asOf,
      lastDate: marketOpen ? null : REF.asOf,
    },
    cashFlows: [],
    holdings: [],
    enrichedHoldings: [],
    dailyCloses: {},
    usdToCad: REF.usdToCad,
    usdToCadDate: REF.asOf,
    availableYears: [2026],
    quotesAsOf: `${REF.asOf}T20:00:00.000Z`,
    asOfNow: marketOpen ? `${REF.asOf}T15:00:00` : `${REF.asOf}T22:00:00`,
  };
}

export function sumAccountVariationsCad(
  payload: PerformanceIndicatorPayload,
): number {
  let total = 0;
  for (const acc of payload.accounts) {
    if (acc.isExternal) continue;
    const gain = payload.currentByAccount[acc.accountKey]?.dayGainCad;
    if (gain != null) total += gain;
  }
  return Math.round(total * 100) / 100;
}

export function ownerVariationCad(
  payload: PerformanceIndicatorPayload,
  owner: string,
): number {
  let total = 0;
  for (const acc of payload.accounts) {
    if (acc.owner !== owner || acc.isExternal) continue;
    const gain = payload.currentByAccount[acc.accountKey]?.dayGainCad;
    if (gain != null) total += gain;
  }
  return Math.round(total * 100) / 100;
}
