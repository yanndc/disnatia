import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isCommonMarketHoliday,
  isEquityMarketSessionOpen,
  isTradingDayIso,
  previousTradingDayIso,
} from "./equity-session";

describe("isCommonMarketHoliday", () => {
  test("reconnaît les congés fixes (observés si week-end)", () => {
    assert.equal(isCommonMarketHoliday("2026-01-01"), true); // Jour de l'An (jeudi)
    assert.equal(isCommonMarketHoliday("2026-12-25"), true); // Noël (vendredi)
    assert.equal(isCommonMarketHoliday("2027-01-01"), true); // vendredi
    assert.equal(isCommonMarketHoliday("2028-01-01"), false); // samedi → observé le 2027-12-31
    assert.equal(isCommonMarketHoliday("2027-12-31"), true); // vendredi précédent (observé)
  });

  test("reconnaît le Vendredi saint (calculé via Pâques)", () => {
    // Pâques 2026 = 5 avril → Vendredi saint = 3 avril.
    assert.equal(isCommonMarketHoliday("2026-04-03"), true);
    assert.equal(isCommonMarketHoliday("2026-04-06"), false); // lundi normal
  });

  test("reconnaît la Fête du Travail (1er lundi de septembre)", () => {
    assert.equal(isCommonMarketHoliday("2026-09-07"), true);
    assert.equal(isCommonMarketHoliday("2026-09-14"), false);
  });

  test("un jour ordinaire n'est pas un congé", () => {
    assert.equal(isCommonMarketHoliday("2026-03-17"), false);
  });
});

describe("isTradingDayIso avec congés", () => {
  test("un congé boursier commun n'est pas un jour de séance même en semaine", () => {
    assert.equal(isTradingDayIso("2026-12-25"), false);
    assert.equal(isTradingDayIso("2026-04-03"), false);
  });

  test("un jour de semaine ordinaire reste un jour de séance", () => {
    assert.equal(isTradingDayIso("2026-08-17"), true);
  });
});

describe("isEquityMarketSessionOpen avec congés", () => {
  test("marché fermé un jour férié même pendant les heures normales", () => {
    assert.equal(isEquityMarketSessionOpen(new Date("2026-12-25T15:00:00-05:00")), false);
  });

  test("marché ouvert un jour ouvré ordinaire aux heures normales", () => {
    assert.equal(isEquityMarketSessionOpen(new Date("2026-08-17T15:00:00-04:00")), true);
  });
});

describe("previousTradingDayIso avec congés", () => {
  test("saute Noël pour trouver le jour ouvré précédent", () => {
    // 2026-12-25 = vendredi (Noël). Le jour ouvré précédent est le 2026-12-24 (jeudi).
    assert.equal(previousTradingDayIso("2026-12-25", 1), "2026-12-24");
  });
});
