import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  nativeToPerformanceCad,
  sessionGainFromPriorQuantity,
} from "./performance-session-gains";

describe("nativeToPerformanceCad", () => {
  test("convertit USD en CAD avec le taux du payload", () => {
    assert.equal(nativeToPerformanceCad(10_000, "USD", 1.4), 14_000);
    assert.equal(nativeToPerformanceCad(10_000, "CAD", 1.4), 10_000);
  });
});

describe("sessionGainFromPriorQuantity", () => {
  test("achat le jour J → qty veille = 0, pas de gain fictif", () => {
    const hit = sessionGainFromPriorQuantity(0, 52, 48);
    assert.equal(hit.gainNative, 0);
    assert.equal(hit.priorNative, 0);
  });

  test("position stable → gain = qty × Δ clôture", () => {
    const hit = sessionGainFromPriorQuantity(100, 52, 48);
    assert.equal(hit.gainNative, 400);
    assert.equal(hit.priorNative, 4_800);
  });
});
