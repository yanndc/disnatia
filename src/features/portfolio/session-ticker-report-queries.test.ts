import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PerformanceIndicatorPayload } from "./performance-indicator-types";
import { sumPersistedSessionGainCad } from "./session-ticker-report-queries";

function minimalPayload(
  sessionGainsByAccount: PerformanceIndicatorPayload["sessionGainsByAccount"],
): PerformanceIndicatorPayload {
  return {
    accounts: [
      { accountKey: "A1|CAD", owner: "X", currency: "CAD", isExternal: false },
      { accountKey: "A2|CAD", owner: "Y", currency: "CAD", isExternal: false },
    ],
    sessionGainsByAccount,
  } as PerformanceIndicatorPayload;
}

describe("sumPersistedSessionGainCad", () => {
  it("somme les comptes Disnat pour la séance", () => {
    const payload = minimalPayload({
      "A1|CAD": [{ date: "2026-06-05", gainCad: 100, priorCad: 10_000 }],
      "A2|CAD": [{ date: "2026-06-05", gainCad: 250, priorCad: 20_000 }],
    });
    assert.equal(
      sumPersistedSessionGainCad(payload, "2026-06-05", ["A1|CAD", "A2|CAD"]),
      350,
    );
  });

  it("retourne null si aucune donnée persistée", () => {
    const payload = minimalPayload({});
    assert.equal(
      sumPersistedSessionGainCad(payload, "2026-06-05", ["A1|CAD"]),
      null,
    );
  });
});
