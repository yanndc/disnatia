import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  accountDayTitresPnL,
  aggregateDayTitresForSubset,
} from "@/app/(dashboard)/comptes/comptes-accounts-logic";
import { computePeriodResult } from "./performance-indicator-logic";
import {
  DESJARDINS_2026_04_30,
  desjardinsAccountKey,
  desjardinsPerformancePayload,
  desjardinsPositionsByAccountKey,
  ownerVariationCad,
  sumAccountVariationsCad,
} from "./fixtures/desjardins-2026-04-30.fixture";

const REF = DESJARDINS_2026_04_30;

const filtersAll = {
  preset: "disnat" as const,
  owner: null,
  includedAccountKeys: [],
  excludedAccountKeys: [],
  selectedYear: 2026,
};

function withinCent(actual: number, expected: number, label: string) {
  const a = Math.round(actual * 100) / 100;
  const e = Math.round(expected * 100) / 100;
  assert.ok(
    Math.abs(a - e) <= 0.01,
    `${label}: ${a} vs ${e}`,
  );
}

function filtersForOwner(owner: string) {
  return { ...filtersAll, owner };
}

describe("Desjardins 2026-04-30 — référence capture", () => {
  test("totaux portefeuille (titres, liquidités, valeur)", () => {
    withinCent(
      REF.yann.titresCad + REF.valerie.titresCad,
      REF.consolidated.titresCad,
      "titres",
    );
    withinCent(
      REF.yann.cashCad + REF.valerie.cashCad,
      REF.consolidated.cashCad,
      "liquidités",
    );
    withinCent(
      REF.yann.totalCad + REF.valerie.totalCad,
      REF.consolidated.totalCad,
      "valeur totale",
    );
  });

  test("variation par titulaire = capture Disnat", () => {
    const payload = desjardinsPerformancePayload();
    assert.equal(
      ownerVariationCad(payload, REF.yann.owner),
      REF.yann.variationCad,
    );
    assert.equal(
      ownerVariationCad(payload, REF.valerie.owner),
      REF.valerie.variationCad,
    );
  });

  test("variation consolidée Disnat (1371,17 $)", () => {
    assert.equal(REF.consolidated.variationCad, 1_371.17);
    const payload = desjardinsPerformancePayload();
    const summed = sumAccountVariationsCad(payload);
    assert.equal(summed, REF.yann.variationCad + REF.valerie.variationCad);
    assert.ok(
      Math.abs(summed - REF.consolidated.variationCad) <= 0.01,
      `écart max 1¢ vs total Disnat (${summed} vs ${REF.consolidated.variationCad})`,
    );
  });
});

describe("Desjardins 2026-04-30 — positions → accountDayTitresPnL", () => {
  test("Σ P&L titres par compte = variation Disnat", () => {
    const byKey = desjardinsPositionsByAccountKey();

    for (const [person, expected] of [
      [REF.yann, REF.yann.variationCad] as const,
      [REF.valerie, REF.valerie.variationCad] as const,
    ]) {
      const key = desjardinsAccountKey(person.accountNumber);
      const rows = byKey.get(key) ?? [];
      const state = accountDayTitresPnL(rows);
      withinCent(state.sum, expected, person.owner);
      assert.equal(state.incomplete, false);
      assert.equal(
        state.priorCloseTitresValue,
        person.titresCad - person.variationCad,
      );
    }
  });
});

describe("Desjardins 2026-04-30 — Performance dynamique (jour)", () => {
  test("séance ouverte → live-quotes, total titulaires", () => {
    const payload = desjardinsPerformancePayload({ marketOpen: true });

    const yann = computePeriodResult(
      payload,
      filtersForOwner(REF.yann.owner),
      "day",
    );
    const valerie = computePeriodResult(
      payload,
      filtersForOwner(REF.valerie.owner),
      "day",
    );
    const all = computePeriodResult(payload, filtersAll, "day");

    assert.equal(yann.method, "live-quotes");
    assert.equal(yann.gainCad, REF.yann.variationCad);
    assert.equal(valerie.gainCad, REF.valerie.variationCad);
    assert.equal(all.gainCad, REF.yann.variationCad + REF.valerie.variationCad);
    assert.equal(all.gainCad, 1_371.17);
  });

  test("séance fermée → session-chain persistée", () => {
    const payload = desjardinsPerformancePayload({ marketOpen: false });
    const day = computePeriodResult(payload, filtersAll, "day");

    assert.equal(day.method, "session-chain");
    assert.equal(day.gainCad, REF.yann.variationCad + REF.valerie.variationCad);
    assert.equal(day.periodStart, REF.asOf);
    assert.equal(day.periodEnd, REF.asOf);
  });
});

describe("Desjardins 2026-04-30 — agrégation comptes (page Comptes)", () => {
  test("aggregateDayTitresForSubset reproduit le total", () => {
    const positionsByKey = desjardinsPositionsByAccountKey();
    const byKey = new Map(
      [...positionsByKey.entries()].map(([key, rows]) => [
        key,
        accountDayTitresPnL(rows),
      ]),
    );
    const yannKey = desjardinsAccountKey(REF.yann.accountNumber);
    const valKey = desjardinsAccountKey(REF.valerie.accountNumber);

    const agg = aggregateDayTitresForSubset(
      [
        { accountKey: yannKey } as Parameters<typeof aggregateDayTitresForSubset>[0][number],
        { accountKey: valKey } as Parameters<typeof aggregateDayTitresForSubset>[0][number],
      ],
      byKey,
    );
    assert.equal(agg.sum, REF.yann.variationCad + REF.valerie.variationCad);
    withinCent(
      agg.priorCloseTitresValue ?? 0,
      REF.consolidated.titresCad - (REF.yann.variationCad + REF.valerie.variationCad),
      "valeur titres veille",
    );
  });
});
