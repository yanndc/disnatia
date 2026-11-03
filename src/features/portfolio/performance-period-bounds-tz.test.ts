/**
 * Les bornes de période doivent être **identiques quel que soit le fuseau du process**
 * (Vercel = UTC, navigateur = America/Toronto). Avant correction, `ytd.start` valait
 * 2025-12-31 et `baselineLookup` 2025-12-29 sous TZ=UTC (décalage d'un jour).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { resolvePeriodBounds } from "./performance-indicator-logic";

const PERIODS = [
  "day",
  "yesterday",
  "month",
  "month3",
  "year",
  "year3",
  "ytd",
  "all",
] as const;

const AS_OF = "2026-06-12T15:00:00";
const EARLIEST = "2024-03-21";

function boundsInProcess(): Record<string, unknown> {
  const now = new Date(AS_OF);
  const out: Record<string, unknown> = {};
  for (const period of PERIODS) {
    out[period] = resolvePeriodBounds(period, now, 2026, EARLIEST);
  }
  return out;
}

function boundsInChildTz(tz: string): Record<string, unknown> {
  const script = `
(async () => {
  const { resolvePeriodBounds } = await import('./src/features/portfolio/performance-indicator-logic.ts');
  const now = new Date(${JSON.stringify(AS_OF)});
  const out = {};
  for (const period of ${JSON.stringify(PERIODS)}) {
    out[period] = resolvePeriodBounds(period, now, 2026, ${JSON.stringify(EARLIEST)});
  }
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
`;
  const result = spawnSync(process.execPath, ["--import", "tsx", "-e", script], {
    cwd: process.cwd(),
    env: { ...process.env, TZ: tz },
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `échec du calcul sous TZ=${tz} : ${result.stderr?.slice(0, 800)}`,
  );
  const lines = (result.stdout ?? "").trim().split(/\r?\n/);
  const json = lines[lines.length - 1] ?? "{}";
  return JSON.parse(json) as Record<string, unknown>;
}

describe("resolvePeriodBounds — invariance fuseau", () => {
  test("bornes identiques en TZ=UTC et TZ=America/Toronto", () => {
    const local = boundsInProcess();
    const utc = boundsInChildTz("UTC");
    const toronto = boundsInChildTz("America/Toronto");

    assert.deepEqual(utc, local, "TZ=UTC doit produire les mêmes bornes que le process local");
    assert.deepEqual(
      toronto,
      local,
      "TZ=America/Toronto doit produire les mêmes bornes que le process local",
    );
  });

  test("bornes calendrier exactes (AAJ, 3 mois, 3 ans)", () => {
    const now = new Date(AS_OF);
    assert.deepEqual(resolvePeriodBounds("ytd", now, 2026, EARLIEST), {
      start: "2026-01-01",
      end: "2026-06-12",
      baselineLookup: "2025-12-31",
    });
    assert.deepEqual(resolvePeriodBounds("month3", now, 2026, EARLIEST), {
      start: "2026-03-12",
      end: "2026-06-12",
      baselineLookup: "2026-03-11",
    });
    assert.deepEqual(resolvePeriodBounds("year3", now, 2026, EARLIEST), {
      start: "2023-06-12",
      end: "2026-06-12",
      baselineLookup: "2023-06-09",
    });
  });

  test("29 février : année bissextile → 28 février (pas de dérive)", () => {
    const leap = new Date("2024-02-29T15:00:00");
    const bounds = resolvePeriodBounds("year", leap, 2024, null);
    assert.equal(bounds.start, "2023-02-28");
  });

  test("selectedYear pilote l'AAJ d'une année passée (filtre plus mort)", () => {
    const now = new Date("2026-06-12T15:00:00");
    assert.deepEqual(resolvePeriodBounds("ytd", now, 2025, null), {
      start: "2025-01-01",
      end: "2025-12-31",
      baselineLookup: "2024-12-31",
    });
    // Année courante : bornes tronquées à la séance de référence.
    assert.deepEqual(resolvePeriodBounds("ytd", now, 2026, null), {
      start: "2026-01-01",
      end: "2026-06-12",
      baselineLookup: "2025-12-31",
    });
  });
});
