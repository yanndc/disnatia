import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sessionGainFromPriorQuantity } from "./performance-session-gains";

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
