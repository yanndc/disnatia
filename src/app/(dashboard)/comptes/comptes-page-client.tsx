"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { RefreshQuotesButton } from "@/features/portfolio/refresh-quotes-button";
import type { EnrichedPosition } from "@/features/portfolio/live-enrichment";
import { formatCurrency, formatNumber, normalizeCurrency } from "@/lib/utils";
import type { AccountWithStats } from "./comptes-types";
import {
  RECON_COLUMNS_STORAGE_KEY,
  aggregateByCurrency,
  aggregateDayTitresForSubset,
  accountDriftTitresCad,
  consolidatedDayTitresCadState,
  driftCellClass,
  emptyDayTitresState,
  ownerConsolidatedCad,
  ownerDriftNetCad,
  scaleUsdTitresDayStateToCad,
  sum,
  type AccountDayTitresPnLState,
} from "./comptes-accounts-logic";

function dayTitresSignedClass(amount: number) {
  if (amount > 0) return "text-emerald-700";
  if (amount < 0) return "text-red-600";
  return "text-slate-700";
}

function DayTitresPnLTd(props: {
  state: AccountDayTitresPnLState;
  currency: string;
  isUsd?: boolean;
  usdToCad?: number | null;
  showCadEquivalent?: boolean;
  emphasize?: boolean;
}) {
  const {
    state,
    currency,
    isUsd = false,
    usdToCad,
    showCadEquivalent = false,
    emphasize,
  } = props;
  if (!state.hasTitresProjetes) {
    return (
      <td
        className={`px-4 py-2 text-right tabular-nums text-slate-400 ${emphasize ? "font-semibold" : ""}`}
      >
        —
      </td>
    );
  }
  if (state.sum === null) {
    return (
      <td
        className={`px-4 py-2 text-right tabular-nums text-slate-400 ${emphasize ? "font-semibold" : ""}`}
        title="Somme partielle : cotation jour absente sur au moins une ligne"
      >
        —{state.incomplete ? " *" : ""}
      </td>
    );
  }
  const sumVal = state.sum;
  const rate = typeof usdToCad === "number" && Number.isFinite(usdToCad) ? usdToCad : null;
  return (
    <td
      className={`px-4 py-2 text-right tabular-nums ${emphasize ? "font-semibold" : ""} ${dayTitresSignedClass(sumVal)}`}
    >
      <div>
        {sumVal > 0 ? "+" : ""}
        {formatCurrency(sumVal, currency)}
        {state.incomplete ? "*" : ""}
      </div>
      {isUsd && showCadEquivalent && rate !== null ? (
        <div className="mt-0.5 text-xs font-normal text-slate-500">
          ≈ {sumVal > 0 ? "+" : ""}
          {formatCurrency(sumVal * rate, "CAD")}
        </div>
      ) : null}
    </td>
  );
}

function AmountCellUsdCad(props: {
  amount: number;
  currency: string;
  isUsd: boolean;
  usdToCad: number;
  showCad: boolean;
  emphasize?: boolean;
}) {
  const { amount, currency, isUsd, usdToCad, showCad, emphasize } = props;
  const cadEq = amount * usdToCad;

  return (
    <td
      className={`px-4 py-2 text-right text-slate-700 ${emphasize ? "font-semibold text-slate-950" : ""}`}
    >
      <div>{formatCurrency(amount, currency)}</div>
      {isUsd && showCad ? (
        <div className="mt-0.5 text-xs font-normal text-slate-500">
          ≈ {formatCurrency(cadEq, "CAD")}
        </div>
      ) : null}
      {currency === "USD" && !showCad ? (
        <div className="mt-0.5 text-xs text-slate-400">Taux CAD indispo.</div>
      ) : null}
    </td>
  );
}

function OwnerAccountsTableFooter({
  ownerAccounts,
  usdToCad,
  dayTitresByAccountKey,
  showRecon,
}: {
  ownerAccounts: AccountWithStats[];
  usdToCad: number | null;
  dayTitresByAccountKey: Map<string, AccountDayTitresPnLState>;
  showRecon: boolean;
}) {
  const cadAgg = aggregateByCurrency(ownerAccounts, "CAD");
  const usdAgg = aggregateByCurrency(ownerAccounts, "USD");
  const hasCad = cadAgg.subset.length > 0;
  const hasUsd = usdAgg.subset.length > 0;
  const showSplit = hasCad && hasUsd;
  const cons = ownerConsolidatedCad(ownerAccounts, usdToCad);
  const driftNetCad = ownerDriftNetCad(ownerAccounts, usdToCad);
  const rowMuted = "border-t border-slate-200 bg-slate-50/90 font-medium text-slate-900";
  const rowTotal =
    "border-t-2 border-slate-300 bg-white/80 font-semibold text-slate-950";

  function subtotalRow(
    label: string,
    agg: ReturnType<typeof aggregateByCurrency>,
    currency: "CAD" | "USD",
  ) {
    if (agg.subset.length === 0) return null;
    const cur = currency;
    const isUsd = cur === "USD" && usdToCad != null;
    const rate = usdToCad ?? 1;
    const titresDayAgg = aggregateDayTitresForSubset(agg.subset, dayTitresByAccountKey);
    return (
      <tr key={`sub-${currency}`} className={rowMuted}>
        <td className="px-4 py-2 text-slate-800">{label}</td>
        <td className="px-4 py-2 font-mono text-slate-400">—</td>
        <td className="px-4 py-2">
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
            {currency}
          </span>
        </td>
        <AmountCellUsdCad
          amount={agg.cash}
          currency={cur}
          isUsd={isUsd}
          usdToCad={rate}
          showCad={isUsd}
        />
        {showRecon ? (
          <AmountCellUsdCad
            amount={agg.market}
            currency={cur}
            isUsd={isUsd}
            usdToCad={rate}
            showCad={isUsd}
          />
        ) : null}
        {showRecon ? (
          <td className="px-4 py-2 text-right tabular-nums text-slate-700">
            {agg.reconstructedMarketValue === null ? (
              <span className="text-slate-400">—</span>
            ) : (
              formatCurrency(agg.reconstructedMarketValue, cur)
            )}
          </td>
        ) : null}
        <DayTitresPnLTd
          state={titresDayAgg}
          currency={cur}
          isUsd={isUsd}
          usdToCad={usdToCad}
          showCadEquivalent={isUsd}
        />
        {showRecon ? (
          <td className={`px-4 py-2 text-right tabular-nums ${driftCellClass(agg.driftTitresVsSnapshot)}`}>
            {agg.driftTitresVsSnapshot === null ? (
              "—"
            ) : (
              <>
                {agg.driftTitresVsSnapshot > 0 ? "+" : ""}
                {formatCurrency(agg.driftTitresVsSnapshot, cur)}
              </>
            )}
          </td>
        ) : null}
        <AmountCellUsdCad
          amount={agg.total}
          currency={cur}
          isUsd={isUsd}
          usdToCad={rate}
          showCad={isUsd}
          emphasize
        />
        {showRecon ? (
          <td className="px-4 py-2 text-right tabular-nums text-slate-600">{agg.txCount}</td>
        ) : null}
        <td className="px-4 py-2 text-right text-xs text-slate-500">
          {agg.lastTxDate ? agg.lastTxDate.toLocaleDateString("fr-CA") : "—"}
        </td>
      </tr>
    );
  }

  const rows: ReactNode[] = [];

  if (showSplit) {
    const rowCad = subtotalRow("Sous-total CAD", cadAgg, "CAD");
    const rowUsd = subtotalRow("Sous-total USD", usdAgg, "USD");
    if (rowCad) rows.push(rowCad);
    if (rowUsd) rows.push(rowUsd);
    const consTitresDay = consolidatedDayTitresCadState(
      cadAgg.subset,
      usdAgg.subset,
      dayTitresByAccountKey,
      usdToCad,
    );
    if (usdToCad != null && cons.encaisse != null) {
      rows.push(
        <tr key="consolidated" className={rowTotal}>
          <td className="px-4 py-2">
            Portefeuille (CAD)
            <span className="mt-0.5 block text-xs font-normal text-slate-500">
              équivalent CAD (taux du jour)
            </span>
          </td>
          <td className="px-4 py-2 font-mono text-slate-400">—</td>
          <td className="px-4 py-2">
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
              CAD
            </span>
          </td>
          <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-950">
            {formatCurrency(cons.encaisse, "CAD")}
          </td>
          {showRecon ? (
            <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-950">
              {formatCurrency(cons.titresFichier!, "CAD")}
            </td>
          ) : null}
          {showRecon ? (
            <td className="px-4 py-2 text-right tabular-nums">
              {cons.titresRecon === null ? (
                <span className="text-slate-400">—</span>
              ) : (
                formatCurrency(cons.titresRecon, "CAD")
              )}
            </td>
          ) : null}
          <DayTitresPnLTd state={consTitresDay} currency="CAD" emphasize />
          {showRecon ? (
            <td
              className={`px-4 py-2 text-right tabular-nums ${driftCellClass(driftNetCad)}`}
            >
              {driftNetCad === null ? (
                "—"
              ) : (
                <>
                  {driftNetCad > 0 ? "+" : ""}
                  {formatCurrency(driftNetCad, "CAD")}
                </>
              )}
            </td>
          ) : null}
          <td className="px-4 py-2 text-right tabular-nums text-base font-semibold text-slate-950">
            {formatCurrency(cons.total!, "CAD")}
          </td>
          {showRecon ? (
            <td className="px-4 py-2 text-right tabular-nums text-slate-600">
              {sum(ownerAccounts.map((a) => a.txCount))}
            </td>
          ) : null}
          <td className="px-4 py-2 text-right text-xs text-slate-500">
            {ownerAccounts.reduce<Date | null>((latest, a) => {
              const d = a.lastTxDate;
              if (!d) return latest;
              if (!latest || d.getTime() > latest.getTime()) return d;
              return latest;
            }, null)?.toLocaleDateString("fr-CA") ?? "—"}
          </td>
        </tr>,
      );
    }
  } else if (hasCad) {
    const row = subtotalRow("Total CAD", cadAgg, "CAD");
    if (row) rows.push(row);
  } else if (hasUsd) {
    const row = subtotalRow("Total USD", usdAgg, "USD");
    if (row) rows.push(row);
  }

  if (rows.length === 0) return null;

  return <tfoot>{rows}</tfoot>;
}

export type ComptesPageClientProps = {
  accounts: AccountWithStats[];
  ownerSectionsSorted: [string, AccountWithStats[]][];
  cadEncaisse: number;
  cadTitres: number;
  cadTotal: number;
  usdEncaisseCad: number | null;
  usdTitresCad: number | null;
  usdTotalCad: number | null;
  consEncaisse: number | null;
  consTitres: number | null;
  consTotal: number | null;
  totalsBlocCadTitresDay: AccountDayTitresPnLState;
  totalsBlocUsdTitresDayCadEquiv: AccountDayTitresPnLState;
  totalsBlocPortfolioTitresDayCad: AccountDayTitresPnLState;
  dayTitresRecord: Record<string, AccountDayTitresPnLState>;
  usdToCad: number | null;
  fx: { rateDate: Date; usdToCad: number } | null;
  driftNetCad: number | null;
  driftTop: { acc: AccountWithStats; driftCad: number } | null;
  driftTopShareAbs: number | null;
  singleDominant: boolean;
  canShowDriftBanner: boolean;
};

export function ComptesPageClient(props: ComptesPageClientProps) {
  const {
    accounts,
    ownerSectionsSorted,
    cadEncaisse,
    cadTitres,
    cadTotal,
    usdEncaisseCad,
    usdTitresCad,
    usdTotalCad,
    consEncaisse,
    consTitres,
    consTotal,
    totalsBlocCadTitresDay,
    totalsBlocUsdTitresDayCadEquiv,
    totalsBlocPortfolioTitresDayCad,
    dayTitresRecord,
    usdToCad,
    fx,
    driftNetCad,
    driftTop,
    driftTopShareAbs,
    singleDominant,
    canShowDriftBanner,
  } = props;

  const dayTitresByAccountKey = new Map<string, AccountDayTitresPnLState>(
    Object.entries(dayTitresRecord),
  );

  const [showRecon, setShowRecon] = useState(false);
  const [storedReady, setStoredReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECON_COLUMNS_STORAGE_KEY);
      setShowRecon(raw === "1" || raw === "true");
    } catch {
      setShowRecon(false);
    }
    setStoredReady(true);
  }, []);

  const persist = useCallback((next: boolean) => {
    setShowRecon(next);
    try {
      localStorage.setItem(RECON_COLUMNS_STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-slate-500">Tableau de bord</p>
            <h2 className="text-2xl font-semibold text-slate-950">Comptes</h2>
            <p className="mt-1 text-sm text-slate-500">
              {accounts.length} compte{accounts.length > 1 ? "s" : ""} · colonnes{" "}
              <span className="font-medium text-slate-700">Disnat / local / écart</span> et{" "}
              <span className="font-medium text-slate-700">nb d&apos;opérations</span> — active
              l&apos;interrupteur <span className="font-medium text-slate-700">Réconciliation</span>.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-medium text-slate-700" id="recon-toggle-label">
                Réconciliation
              </span>
              <Switch
                checked={showRecon}
                disabled={!storedReady}
                onCheckedChange={persist}
                aria-labelledby="recon-toggle-label"
              />
            </div>
            <RefreshQuotesButton />
          </div>
        </div>

        {showRecon && canShowDriftBanner && driftNetCad !== null && usdToCad !== null ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
            <p>
              <span className="text-slate-500">Écart Disnat net (CAD) : </span>
              <span className="font-semibold tabular-nums text-slate-900">
                {driftNetCad > 0 ? "+" : ""}
                {formatCurrency(driftNetCad, "CAD")}
              </span>
            </p>
            {driftTop ? (
              <p className="mt-1 text-xs text-slate-600">
                Plus gros écart :{" "}
                <span className="font-mono text-slate-800">
                  {driftTop.acc.accountNumber ?? driftTop.acc.accountKey}
                </span>{" "}
                ({driftTop.acc.accountType ?? "—"}, {driftTop.acc.currency}) →{" "}
                <span className="tabular-nums font-medium">
                  {driftTop.driftCad > 0 ? "+" : ""}
                  {formatCurrency(driftTop.driftCad, "CAD")}
                </span>
                {driftTopShareAbs != null ? (
                  <>
                    {" "}
                    · {formatNumber(driftTopShareAbs, 0)} % des écarts (valeur absolue)
                  </>
                ) : null}
                {singleDominant ? (
                  <span className="ml-1 font-medium text-amber-800">
                    — presque tout vient de ce compte.
                  </span>
                ) : driftTopShareAbs != null && driftTopShareAbs < 85 ? (
                  <span className="ml-1 text-slate-500">— plusieurs comptes comptent.</span>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : showRecon && driftNetCad === null && accounts.some((a) => a.driftTitresVsSnapshot !== null) ? (
          <p className="mt-2 text-xs text-amber-800">
            Taux USD→CAD manquant : écart total en CAD non calculable.
          </p>
        ) : null}

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Totaux · CAD
          </p>
          {usdToCad == null || fx == null ? (
            <p className="mt-2 text-sm text-amber-800">
              Taux USD→CAD indisponible : les montants consolidés en CAD ne peuvent pas être
              calculés. Les comptes en US restent affichés en dollars US seulement.
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              Taux du{" "}
              <time dateTime={fx.rateDate.toISOString().slice(0, 10)}>
                {fx.rateDate.toLocaleDateString("fr-CA")}
              </time>{" "}
              : 1 USD = {formatNumber(fx.usdToCad, 5)} CAD
            </p>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[22rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="pb-2 pr-3 font-medium" />
                  <th className="pb-2 px-2 text-right font-medium">Encaisse</th>
                  {showRecon ? (
                    <th className="pb-2 px-2 text-right font-medium">Disnat</th>
                  ) : null}
                  <th className="pb-2 px-2 text-right font-medium">Jour</th>
                  <th className="pb-2 pl-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                <tr>
                  <td className="py-2 pr-3 font-medium text-slate-600">Comptes CAD</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatCurrency(cadEncaisse, "CAD")}
                  </td>
                  {showRecon ? (
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatCurrency(cadTitres, "CAD")}
                    </td>
                  ) : null}
                  <DayTitresPnLTd state={totalsBlocCadTitresDay} currency="CAD" />
                  <td className="pl-2 py-2 text-right tabular-nums font-medium">
                    {formatCurrency(cadTotal, "CAD")}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium text-slate-600">
                    Comptes USD
                    {usdToCad != null ? (
                      <span className="mt-0.5 block text-xs font-normal normal-case text-slate-400">
                        converti au taux du jour
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {usdEncaisseCad != null ? (
                      formatCurrency(usdEncaisseCad, "CAD")
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  {showRecon ? (
                    <td className="px-2 py-2 text-right tabular-nums">
                      {usdTitresCad != null ? (
                        formatCurrency(usdTitresCad, "CAD")
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  ) : null}
                  <DayTitresPnLTd state={totalsBlocUsdTitresDayCadEquiv} currency="CAD" />
                  <td className="pl-2 py-2 text-right tabular-nums font-medium">
                    {usdTotalCad != null ? (
                      formatCurrency(usdTotalCad, "CAD")
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
                <tr className="border-t border-slate-300 bg-white/70 font-semibold text-slate-950">
                  <td className="py-2 pr-3">Total en CAD</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {consEncaisse != null ? (
                      formatCurrency(consEncaisse, "CAD")
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  {showRecon ? (
                    <td className="px-2 py-2 text-right tabular-nums">
                      {consTitres != null ? formatCurrency(consTitres, "CAD") : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  ) : null}
                  <DayTitresPnLTd
                    state={totalsBlocPortfolioTitresDayCad}
                    currency="CAD"
                    emphasize
                  />
                  <td className="pl-2 py-2 text-right tabular-nums text-base">
                    {consTotal != null ? formatCurrency(consTotal, "CAD") : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {ownerSectionsSorted.map(([owner, ownerAccounts]) => (
        <Card key={owner}>
          <CardHeader>
            <CardTitle className="text-base">{owner}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">N° compte</th>
                    <th className="px-4 py-2">Devise</th>
                    <th className="px-4 py-2 text-right">Encaisse</th>
                    {showRecon ? <th className="px-4 py-2 text-right">Disnat</th> : null}
                    {showRecon ? <th className="px-4 py-2 text-right">Local</th> : null}
                    <th className="px-4 py-2 text-right">Jour</th>
                    {showRecon ? <th className="px-4 py-2 text-right">Écart Disnat</th> : null}
                    <th className="px-4 py-2 text-right">Total</th>
                    {showRecon ? (
                      <th className="px-4 py-2 text-right" title="Nombre de lignes d’opérations importées (pas la quantité de titres)">
                        Nb op.
                      </th>
                    ) : null}
                    <th className="px-4 py-2 text-right">Dernière</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ownerAccounts.map((acc) => {
                    const cur = normalizeCurrency(acc.currency);
                    const isUsd = cur === "USD" && usdToCad != null;
                    return (
                      <tr key={acc.accountKey} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-medium text-slate-800">
                          {acc.accountType ?? "—"}
                        </td>
                        <td className="px-4 py-2 font-mono text-slate-600">
                          {acc.accountNumber ?? "—"}
                        </td>
                        <td className="px-4 py-2">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                            {acc.currency}
                          </span>
                        </td>
                        <AmountCellUsdCad
                          amount={acc.cashValue}
                          currency={cur}
                          isUsd={isUsd}
                          usdToCad={usdToCad ?? 1}
                          showCad={isUsd}
                        />
                        {showRecon ? (
                          <AmountCellUsdCad
                            amount={acc.marketValue}
                            currency={cur}
                            isUsd={isUsd}
                            usdToCad={usdToCad ?? 1}
                            showCad={isUsd}
                          />
                        ) : null}
                        {showRecon ? (
                          <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                            {acc.reconstructedMarketValue === null ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              formatCurrency(acc.reconstructedMarketValue, cur)
                            )}
                          </td>
                        ) : null}
                        <DayTitresPnLTd
                          state={
                            dayTitresByAccountKey.get(acc.accountKey) ?? emptyDayTitresState()
                          }
                          currency={cur}
                          isUsd={isUsd}
                          usdToCad={usdToCad}
                          showCadEquivalent={isUsd}
                        />
                        {showRecon ? (
                          <td
                            className={`px-4 py-2 text-right tabular-nums ${
                              acc.driftTitresVsSnapshot === null
                                ? "text-slate-400"
                                : Math.abs(acc.driftTitresVsSnapshot) > 500
                                  ? "font-medium text-amber-700"
                                  : "text-slate-700"
                            }`}
                          >
                            {acc.driftTitresVsSnapshot === null ? (
                              "—"
                            ) : (
                              <>
                                {acc.driftTitresVsSnapshot > 0 ? "+" : ""}
                                {formatCurrency(acc.driftTitresVsSnapshot, cur)}
                              </>
                            )}
                          </td>
                        ) : null}
                        <AmountCellUsdCad
                          amount={acc.totalValue}
                          currency={cur}
                          isUsd={isUsd}
                          usdToCad={usdToCad ?? 1}
                          showCad={isUsd}
                          emphasize
                        />
                        {showRecon ? (
                          <td className="px-4 py-2 text-right text-slate-500">
                            {acc.txCount > 0 ? (
                              <Link
                                href={`/transactions?accountKey=${encodeURIComponent(acc.accountKey)}`}
                                className="text-slate-700 underline-offset-2 hover:underline"
                              >
                                {acc.txCount}
                              </Link>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        ) : null}
                        <td className="px-4 py-2 text-right text-xs text-slate-400">
                          {acc.lastTxDate
                            ? acc.lastTxDate.toLocaleDateString("fr-CA")
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <OwnerAccountsTableFooter
                  ownerAccounts={ownerAccounts}
                  usdToCad={usdToCad}
                  dayTitresByAccountKey={dayTitresByAccountKey}
                  showRecon={showRecon}
                />
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
