/**
 * Regroupe des symboles distincts qui répliquent le même indice (ex. SPY + VFV, QQQ + XQQ)
 * pour les KPI concentration / plus grosses positions.
 */

import {
  standardizeDisnatTickerMarketDots,
  stripDisnatListingDenominationHyphens,
} from "@/lib/market/disnat-ticker";

export type TickerIndexGroup = {
  id: string;
  label: string;
  members: readonly string[];
};

export const TICKER_INDEX_GROUPS: readonly TickerIndexGroup[] = [
  {
    id: "idx-sp500",
    label: "S&P 500",
    members: ["SPY", "VFV", "VOO", "IVV", "XUS", "ZSP"],
  },
  {
    id: "idx-ndx100",
    label: "Nasdaq-100",
    members: ["QQQ", "XQQ", "X11", "HXQ", "ZQQ", "QQC"],
  },
] as const;

const memberToMeta = new Map<string, { groupId: string; groupLabel: string }>();
for (const g of TICKER_INDEX_GROUPS) {
  for (const m of g.members) {
    memberToMeta.set(m, { groupId: g.id, groupLabel: g.label });
  }
}

/** Aligné sur la notation Disnat (XQQ.C, XQQ-C-C, etc.) avant lookup dans les groupes. */
export function normalizeTickerForAggregationGroup(raw: string): string {
  let t = standardizeDisnatTickerMarketDots(raw.trim());
  t = t.replace(/\.(TO|CN|V)$/i, "");
  return stripDisnatListingDenominationHyphens(t);
}

export function resolveAggregationGroupMeta(rawTicker: string): {
  mapKey: string;
  groupLabel: string | null;
  token: string;
} {
  const token = normalizeTickerForAggregationGroup(rawTicker);
  const hit = memberToMeta.get(token);
  if (hit) {
    return { mapKey: hit.groupId, groupLabel: hit.groupLabel, token };
  }
  return { mapKey: token, groupLabel: null, token };
}

export function formatAggregatedTickerLabel(row: {
  tickers: Set<string>;
  groupLabel: string | null;
}): string {
  const list = [...row.tickers].sort();
  if (list.length === 0) return "?";
  if (list.length === 1) return list[0]!;
  if (row.groupLabel) return `${row.groupLabel} (${list.join(" · ")})`;
  return list.join(" · ");
}
