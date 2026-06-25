import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { logRecoverableServerIssue } from "@/lib/logging/recoverable-server-log";
import { parseIsoDateLocal } from "./daily-close-key";
import { PERFORMANCE_CALC_VERSION } from "./performance-calc-version";
import {
  computeAllPeriodResults,
} from "./performance-indicator-logic";
import type {
  PerformanceFilterState,
  PerformanceIndicatorPayload,
  PerformancePeriodId,
  PerformancePeriodResult,
  PerformanceSnapshotsBundle,
} from "./performance-indicator-types";
import {
  performanceScopeKey,
  standardPerformanceScopeFilters,
} from "./performance-snapshot-scope";

function rowFromResult(
  sessionDate: string,
  scopeKey: string,
  filters: Pick<PerformanceFilterState, "preset" | "owner">,
  result: PerformancePeriodResult,
) {
  return {
    id: randomUUID(),
    sessionDate: parseIsoDateLocal(sessionDate),
    calcVersion: PERFORMANCE_CALC_VERSION,
    periodId: result.periodId,
    scopeKey,
    owner: filters.owner,
    scopePreset: filters.preset,
    label: result.label,
    shortLabel: result.shortLabel,
    gainCad: result.gainCad,
    gainPct: result.gainPct,
    currentCad: result.currentCad,
    baselineCad: result.baselineCad,
    baselineDate: result.baselineDate,
    periodStart: result.periodStart,
    periodEnd: result.periodEnd ?? sessionDate,
    method: result.method,
    accountsIncluded: result.accountsIncluded,
    accountsWithBaseline: result.accountsWithBaseline,
    incomplete: result.incomplete,
    annualized: result.annualized,
    note: result.note,
    computedAt: new Date(),
  };
}

function resultFromRow(row: {
  periodId: string;
  label: string;
  shortLabel: string;
  gainCad: number | null;
  gainPct: number | null;
  currentCad: number;
  baselineCad: number | null;
  baselineDate: string | null;
  periodStart: string | null;
  periodEnd: string;
  method: string;
  accountsIncluded: number;
  accountsWithBaseline: number;
  incomplete: boolean;
  annualized: boolean;
  note: string | null;
}): PerformancePeriodResult {
  return {
    periodId: row.periodId as PerformancePeriodId,
    label: row.label,
    shortLabel: row.shortLabel,
    gainCad: row.gainCad,
    gainPct: row.gainPct,
    currentCad: row.currentCad,
    baselineCad: row.baselineCad,
    baselineDate: row.baselineDate,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    method: row.method as PerformancePeriodResult["method"],
    accountsIncluded: row.accountsIncluded,
    accountsWithBaseline: row.accountsWithBaseline,
    incomplete: row.incomplete,
    annualized: row.annualized,
    note: row.note,
  };
}

/** Persiste les indicateurs standard pour une séance (idempotent). */
export async function persistPerformanceSnapshots(
  payload: PerformanceIndicatorPayload,
  sessionDate: string,
): Promise<{ rowsWritten: number; scopeCount: number }> {
  const scopes = standardPerformanceScopeFilters(payload);
  const rows: ReturnType<typeof rowFromResult>[] = [];

  for (const scope of scopes) {
    const scopeKey = performanceScopeKey(scope);
    const filters: PerformanceFilterState = {
      ...scope,
      activePeriod: "day",
    };
    const results = computeAllPeriodResults(payload, filters);
    for (const result of results) {
      rows.push(rowFromResult(sessionDate, scopeKey, scope, result));
    }
  }

  await prisma.portfolioPerformanceSnapshot.deleteMany({
    where: {
      sessionDate: parseIsoDateLocal(sessionDate),
      calcVersion: PERFORMANCE_CALC_VERSION,
    },
  });

  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await prisma.portfolioPerformanceSnapshot.createMany({
      data: rows.slice(i, i + chunkSize),
    });
  }

  return { rowsWritten: rows.length, scopeCount: scopes.length };
}

/** Charge les snapshots pour la séance et la version courante. */
export async function loadPerformanceSnapshots(
  sessionDate: string,
): Promise<PerformanceSnapshotsBundle | null> {
  const rows = await prisma.portfolioPerformanceSnapshot.findMany({
    where: {
      sessionDate: parseIsoDateLocal(sessionDate),
      calcVersion: PERFORMANCE_CALC_VERSION,
    },
    orderBy: [{ scopeKey: "asc" }, { periodId: "asc" }],
  });

  if (rows.length === 0) return null;

  const byScopeKey: Record<string, PerformancePeriodResult[]> = {};
  for (const row of rows) {
    const bucket = byScopeKey[row.scopeKey] ?? [];
    bucket.push(resultFromRow(row));
    byScopeKey[row.scopeKey] = bucket;
  }

  return {
    calcVersion: PERFORMANCE_CALC_VERSION,
    sessionDate,
    byScopeKey,
  };
}

/** Crée les snapshots manquants pour la séance (prod : pas de CLI requise). */
export async function maybePersistPerformanceSnapshots(
  payload: PerformanceIndicatorPayload,
  sessionDate: string,
): Promise<PerformanceSnapshotsBundle | null> {
  const existing = await loadPerformanceSnapshots(sessionDate);
  if (existing) return existing;
  if (!payload.sessionDataHealth.ok) return null;

  try {
    await persistPerformanceSnapshots(payload, sessionDate);
    return await loadPerformanceSnapshots(sessionDate);
  } catch (cause) {
    logRecoverableServerIssue("[performance] maybePersistPerformanceSnapshots", cause);
    return null;
  }
}
