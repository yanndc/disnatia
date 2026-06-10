import type {
  PerformanceFilterState,
  PerformanceIndicatorPayload,
  PerformanceScopePreset,
} from "./performance-indicator-types";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";

const SCOPE_SEP = "\u001f";

/** Clé stable pour une combinaison preset / titulaire / comptes inclus-exclus. */
export function performanceScopeKey(
  filters: Pick<
    PerformanceFilterState,
    "preset" | "owner" | "includedAccountKeys" | "excludedAccountKeys"
  >,
): string {
  const inc = [...filters.includedAccountKeys].sort().join(SCOPE_SEP);
  const exc = [...filters.excludedAccountKeys].sort().join(SCOPE_SEP);
  return `${filters.preset}${SCOPE_SEP}${filters.owner ?? ""}${SCOPE_SEP}${inc}${SCOPE_SEP}${exc}`;
}

/** Portées standard snapshotées au rebuild (tout + Disnat × chaque titulaire). */
export function standardPerformanceScopeFilters(
  payload: PerformanceIndicatorPayload,
): Pick<
  PerformanceFilterState,
  "preset" | "owner" | "includedAccountKeys" | "excludedAccountKeys" | "selectedYear"
>[] {
  const asOf = new Date(payload.asOfNow);
  const currentYear = asOf.getFullYear();
  const selectedYear = payload.availableYears.includes(currentYear)
    ? currentYear
    : (payload.availableYears[0] ?? currentYear);
  const owners = uniquePortfolioOwners(payload.accounts.map((a) => a.owner));
  const presets: PerformanceScopePreset[] = ["all", "disnat"];
  const scopes: Pick<
    PerformanceFilterState,
    "preset" | "owner" | "includedAccountKeys" | "excludedAccountKeys" | "selectedYear"
  >[] = [];

  for (const preset of presets) {
    scopes.push({
      preset,
      owner: null,
      includedAccountKeys: [],
      excludedAccountKeys: [],
      selectedYear,
    });
    for (const owner of owners) {
      scopes.push({
        preset,
        owner,
        includedAccountKeys: [],
        excludedAccountKeys: [],
        selectedYear,
      });
    }
  }

  return scopes;
}
