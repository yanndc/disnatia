import type { EnrichedPosition } from "@/features/portfolio/live-enrichment";
import type {
  PerformanceAccountRef,
  PerformanceIndicatorPayload,
} from "@/features/portfolio/performance-indicator-types";

/**
 * Référence Disnat — vue d'ensemble « Total des actifs », au 30 avril 2024.
 * Variation = P&L titres du jour (CAD), hors liquidités.
 */
export const DESJARDINS_2024_04_30 = {
  asOf: "2024-04-30",
  usdToCad: 1.3779,
  yann: {
    accountNumber: "5KFZE19",
    owner: "Yann De Champlain",
    variationCad: 996.44,
    titresCad: 169_164.64,
    cashCad: 537.94,
    totalCad: 169_702.59,
  },
  valerie: {
    accountNumber: "5L3APB3",
    owner: "Valerie Degrandpre",
    variationCad: 367.44,
    titresCad: 68_909.1,
    cashCad: 126.85,
    totalCad: 69_035.95,
  },
  consolidated: {
    /** Total affiché Disnat (arrondi consolidé). */
    variationCad: 1_363.89,
    titresCad: 238_073.75,
    cashCad: 664.79,
    totalCad: 238_738.54,
  },
} as const;

const REF = DESJARDINS_2024_04_30;

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
        positionRow(yannKey, REF.yann.owner, 412.18, 70_000),
        positionRow(yannKey, REF.yann.owner, 584.26, 99_164.64),
      ],
    ],
    [
      valKey,
      [
        positionRow(valKey, REF.valerie.owner, 152.44, 30_000),
        positionRow(valKey, REF.valerie.owner, 215.0, 38_909.1),
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
    sessionGainsByAccount: marketOpen
      ? {}
      : {
          [yannKey]: [
            {
              date: REF.asOf,
              gainCad: REF.yann.variationCad,
              priorCad: REF.yann.titresCad - REF.yann.variationCad,
            },
          ],
          [valKey]: [
            {
              date: REF.asOf,
              gainCad: REF.valerie.variationCad,
              priorCad: REF.valerie.titresCad - REF.valerie.variationCad,
            },
          ],
        },
    sessionDataHealth: {
      ok: true,
      message: null,
      persistedDays: marketOpen ? 0 : 1,
      firstDate: marketOpen ? null : REF.asOf,
      lastDate: marketOpen ? null : REF.asOf,
    },
    performanceSnapshots: null,
    cashFlows: [],
    accountCashLedgers: {},
    holdings: [],
    enrichedHoldings: [],
    dailyCloses: {},
    usdToCad: REF.usdToCad,
    usdToCadDate: REF.asOf,
    usdCadRateByDate: {},
    availableYears: [2024],
    quotesAsOf: `${REF.asOf}T20:00:00.000Z`,
    asOfNow: marketOpen ? `${REF.asOf}T15:00:00` : `${REF.asOf}T22:00:00`,
  };
}

/** Somme arrondie des variations par compte (logique app). */
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

/** Variation agrégée par titulaire. */
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
